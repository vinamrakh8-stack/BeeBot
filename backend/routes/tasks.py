"""Tasks and commitments.

Bee-sourced tasks keep the documented write-through completion path. User and
AI-extracted tasks are local (negative bee_id) and never claim to be Bee data.
"""

from __future__ import annotations

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, select

from api_utils import (
    ApiError,
    dump,
    int_arg,
    json_body,
    page_payload,
    parse_datetime,
    path_int,
)
from models import Todo, utcnow
from schemas import TodoOut
from security import (
    check_ai_rate_limit,
    get_ai_client,
    get_client,
    get_db,
    get_settings,
    login_required,
)
from services.memory_service import add_tombstone, next_local_bee_id
from services.normalize import todo_values
from services.source_service import get_conversation, get_conversation_by_bee_id
from services.task_service import (
    extract_candidates,
    find_duplicate,
    make_dedupe_key,
)

bp = Blueprint("tasks", __name__, url_prefix="/api/tasks")


def _clean_text(value, *, maximum: int = 1000) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ApiError("`text` is required.", code="invalid_parameter")
    text = value.strip()
    if len(text) > maximum:
        raise ApiError(
            f"`text` is limited to {maximum} characters.", code="invalid_parameter"
        )
    return text


def _get_todo(bee_id: int) -> Todo:
    row = get_db().execute(
        select(Todo).where(
            Todo.owner_id == g.current_user.id,
            Todo.bee_id == bee_id,
            Todo.deleted_at.is_(None),
        )
    ).scalar_one_or_none()
    if row is None:
        raise ApiError("Task not found.", status=404, code="not_found")
    return row


def _duplicate_response(existing: Todo):
    return (
        jsonify(
            {
                "error": "duplicate_task",
                "message": "An equivalent task already exists.",
                "existing": dump(TodoOut.model_validate(existing)),
            }
        ),
        409,
    )


def _serialize_candidate(candidate: dict) -> dict:
    payload = dict(candidate)
    due = payload.get("due_at")
    if due is not None:
        payload["due_at"] = due.replace(tzinfo=None).isoformat(timespec="seconds") + "Z"
    return payload


@bp.get("")
@bp.get("/")
@login_required
def list_tasks():
    limit = int_arg("limit", 25, minimum=1, maximum=100)
    offset = int_arg("offset", 0, minimum=0, maximum=1_000_000)
    status_filter = request.args.get("status", "all")
    if status_filter not in {"all", "open", "completed"}:
        raise ApiError("`status` must be one of: all, open, completed.", code="invalid_parameter")
    origin = request.args.get("origin", "all")
    if origin not in {"all", "bee", "user", "ai"}:
        raise ApiError(
            "`origin` must be one of: all, bee, user, ai.", code="invalid_parameter"
        )

    db = get_db()
    filters = [Todo.owner_id == g.current_user.id, Todo.deleted_at.is_(None)]
    if status_filter == "open":
        filters.append(Todo.completed.is_(False))
    elif status_filter == "completed":
        filters.append(Todo.completed.is_(True))
    if origin != "all":
        filters.append(Todo.origin == origin)

    total = db.execute(select(func.count()).select_from(Todo).where(*filters)).scalar_one()
    rows = (
        db.execute(
            select(Todo)
            .where(*filters)
            .order_by(
                Todo.completed.asc(),
                func.coalesce(
                    Todo.due_at, Todo.postponed_until, Todo.alarm_at, Todo.created_at
                ).desc(),
                Todo.bee_id.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )

    return jsonify(
        page_payload([TodoOut.model_validate(row) for row in rows], total, limit, offset)
    )


@bp.post("")
@bp.post("/")
@login_required
def create_task():
    body = json_body()
    text = _clean_text(body.get("text"))
    completed = body.get("completed", False)
    if not isinstance(completed, bool):
        raise ApiError("`completed` must be a boolean.", code="invalid_parameter")

    due_at = parse_datetime(body.get("due_at"), "due_at")
    source_conversation_id = body.get("source_conversation_id")
    if source_conversation_id is not None and not isinstance(source_conversation_id, int):
        raise ApiError(
            "`source_conversation_id` must be an integer.", code="invalid_parameter"
        )
    source_bee_id = body.get("source_bee_id")
    if source_bee_id is not None and not isinstance(source_bee_id, int):
        raise ApiError("`source_bee_id` must be an integer.", code="invalid_parameter")
    source_excerpt = body.get("source_excerpt")
    if source_excerpt is not None:
        if not isinstance(source_excerpt, str):
            raise ApiError("`source_excerpt` must be a string.", code="invalid_parameter")
        source_excerpt = source_excerpt.strip()[:1000] or None

    db = get_db()
    if source_conversation_id is not None:
        get_conversation(db, g.current_user.id, source_conversation_id)
    elif source_bee_id is not None:
        conversation = get_conversation_by_bee_id(db, g.current_user.id, source_bee_id)
        source_conversation_id = conversation.id

    dedupe_key = make_dedupe_key(source_conversation_id, text)
    existing = find_duplicate(db, g.current_user.id, dedupe_key)
    if existing is not None:
        return _duplicate_response(existing)

    row = Todo(
        owner_id=g.current_user.id,
        bee_id=next_local_bee_id(db, Todo, g.current_user.id),
        text=text,
        completed=completed,
        origin="user",
        source_conversation_id=source_conversation_id,
        source_excerpt=source_excerpt,
        due_at=due_at,
        ai_generated=False,
        dedupe_key=dedupe_key,
        approved=True,
        created_at=utcnow(),
        updated_at=utcnow(),
        synced_at=utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return jsonify(dump(TodoOut.model_validate(row))), 201


@bp.post("/extract")
@login_required
def extract_tasks():
    body = json_body()
    conversation_id = body.get("conversation_id")
    bee_id = body.get("bee_id")
    if conversation_id is not None and not isinstance(conversation_id, int):
        raise ApiError("`conversation_id` must be an integer.", code="invalid_parameter")
    if bee_id is not None and not isinstance(bee_id, int):
        raise ApiError("`bee_id` must be an integer.", code="invalid_parameter")
    if conversation_id is None and bee_id is None:
        raise ApiError(
            "Provide `conversation_id` (local) or `bee_id` (Bee conversation id).",
            code="invalid_parameter",
        )

    db = get_db()
    conversation = (
        get_conversation(db, g.current_user.id, conversation_id)
        if conversation_id is not None
        else get_conversation_by_bee_id(db, g.current_user.id, bee_id)
    )
    check_ai_rate_limit()
    candidates = extract_candidates(get_ai_client(), conversation)
    for candidate in candidates:
        candidate["duplicate"] = (
            find_duplicate(db, g.current_user.id, candidate["dedupe_key"]) is not None
        )
    return jsonify(
        {
            "candidates": [_serialize_candidate(candidate) for candidate in candidates],
            "persisted": False,
            "model": get_settings().ai_model,
            "source": {
                "conversation_id": conversation.id,
                "bee_id": conversation.bee_id,
                "route": f"/conversations/{conversation.bee_id}",
            },
        }
    )


@bp.patch("/<bee_id>")
@login_required
def update_task(bee_id: str):
    bee_id = path_int(bee_id, "bee_id")
    body = json_body()
    row = _get_todo(bee_id)
    db = get_db()

    allowed = {
        "completed",
        "text",
        "due_at",
        "postponed_until",
        "source_excerpt",
        "approved",
    }
    unknown = set(body) - allowed
    if unknown:
        raise ApiError(
            f"Unsupported field(s): {', '.join(sorted(unknown))}.",
            code="invalid_parameter",
        )
    if not body:
        raise ApiError("Provide at least one field to update.", code="invalid_parameter")

    if "completed" in body and not isinstance(body["completed"], bool):
        raise ApiError("`completed` must be a boolean.", code="invalid_parameter")
    if "approved" in body and not isinstance(body["approved"], bool):
        raise ApiError("`approved` must be a boolean.", code="invalid_parameter")

    # Documented Bee write path: completing a Bee task is written through before
    # any local mutation, so a failure never looks like success. Pure completion
    # requests do not change the task's provenance.
    if row.bee_id > 0 and row.origin == "bee" and set(body) <= {"completed"}:
        completed = body.get("completed")
        if not isinstance(completed, bool):
            raise ApiError("`completed` must be a boolean.", code="invalid_parameter")
        raw = get_client().update_todo_completed(bee_id, completed)
        if raw:
            for key, value in todo_values(raw).items():
                setattr(row, key, value)
        else:
            row.completed = completed
        row.synced_at = utcnow()
        db.commit()
        db.refresh(row)
        return jsonify(dump(TodoOut.model_validate(row)))

    # Any other edit of a Bee task becomes a local correction; tombstone the Bee
    # id so the next sync does not overwrite it.
    if row.bee_id > 0 and row.origin == "bee":
        add_tombstone(db, g.current_user.id, "todo", row.bee_id)
        row.origin = "user"
        row.ai_generated = False

    if "approved" in body:
        row.approved = body["approved"]
    if "text" in body:
        row.text = _clean_text(body.get("text"))
    if "due_at" in body:
        row.due_at = parse_datetime(body.get("due_at"), "due_at")
    if "postponed_until" in body:
        row.postponed_until = parse_datetime(body.get("postponed_until"), "postponed_until")
    if "completed" in body:
        row.completed = body["completed"]
        if body["completed"]:
            row.postponed_until = None
    if "source_excerpt" in body:
        value = body.get("source_excerpt")
        if value is not None and not isinstance(value, str):
            raise ApiError("`source_excerpt` must be a string.", code="invalid_parameter")
        row.source_excerpt = (
            value.strip()[:1000] if isinstance(value, str) and value.strip() else None
        )

    if "text" in body or row.dedupe_key is None:
        row.dedupe_key = make_dedupe_key(row.source_conversation_id, row.text)
        duplicate = find_duplicate(
            db, g.current_user.id, row.dedupe_key, exclude_bee_id=row.bee_id
        )
        if duplicate is not None:
            return _duplicate_response(duplicate)

    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return jsonify(dump(TodoOut.model_validate(row)))


@bp.delete("/<bee_id>")
@login_required
def delete_task(bee_id: str):
    bee_id = path_int(bee_id, "bee_id")
    row = _get_todo(bee_id)
    db = get_db()
    if row.bee_id > 0:
        add_tombstone(db, g.current_user.id, "todo", row.bee_id)
    db.delete(row)
    db.commit()
    return jsonify({"deleted": True, "bee_id": bee_id})
