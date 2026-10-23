"""Personal memory: Bee facts plus user-created and AI-extracted candidates.

Bee-sourced facts remain the source of truth until the user edits or deletes
one. Either action creates a tombstone so the next sync cannot silently
recreate it.
"""

from __future__ import annotations

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, select

from api_utils import (
    ApiError,
    dump,
    json_body,
    page_payload,
    pagination,
    path_int,
    provenance,
)
from models import Fact, utcnow
from schemas import FactOut
from security import (
    check_ai_rate_limit,
    get_ai_client,
    get_db,
    get_settings,
    login_required,
)
from services.memory_service import (
    add_tombstone,
    extract_candidates,
    next_local_bee_id,
    normalize_text,
)
from services.source_service import (
    conversation_bee_ids,
    get_conversation,
    get_conversation_by_bee_id,
)

bp = Blueprint("memories", __name__, url_prefix="/api/memories")


def _clean_text(value, field: str = "text", *, maximum: int = 1000) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ApiError(f"`{field}` is required.", code="invalid_parameter")
    text = value.strip()
    if len(text) > maximum:
        raise ApiError(
            f"`{field}` is limited to {maximum} characters.", code="invalid_parameter"
        )
    return text


def _clean_tags(value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ApiError("`tags` must be a list of strings.", code="invalid_parameter")
    tags: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise ApiError("`tags` must be a list of strings.", code="invalid_parameter")
        tag = item.strip()
        if tag and tag not in tags:
            tags.append(tag[:48])
    if len(tags) > 8:
        raise ApiError("At most 8 tags are allowed.", code="invalid_parameter")
    return tags


def _get_fact(bee_id: int) -> Fact:
    row = get_db().execute(
        select(Fact).where(
            Fact.owner_id == g.current_user.id,
            Fact.bee_id == bee_id,
            Fact.deleted_at.is_(None),
        )
    ).scalar_one_or_none()
    if row is None:
        raise ApiError("Memory not found.", status=404, code="not_found")
    return row


def _serialize_many(db, owner_id: int, rows: list[Fact]) -> list[dict]:
    """Serialise memories with the Bee id of their source conversation.

    Local records store the surrogate conversation id; the UI needs the Bee id
    to link back to the `/conversations/:beeId` route.
    """
    bee_ids = conversation_bee_ids(
        db, owner_id, [row.source_conversation_id for row in rows]
    )
    payloads: list[dict] = []
    for row in rows:
        payload = dump(FactOut.model_validate(row))
        payload["source_conversation_bee_id"] = (
            bee_ids.get(row.source_conversation_id)
            if row.source_conversation_id is not None
            else None
        )
        payloads.append(payload)
    return payloads


def _serialize(db, owner_id: int, row: Fact) -> dict:
    return _serialize_many(db, owner_id, [row])[0]


@bp.get("")
@bp.get("/")
@login_required
def list_memories():
    limit, offset = pagination()
    confirmed = request.args.get("confirmed", "all")
    if confirmed not in {"all", "true", "false"}:
        raise ApiError(
            "`confirmed` must be one of: all, true, false.", code="invalid_parameter"
        )
    origin = request.args.get("origin", "all")
    if origin not in {"all", "bee", "user", "ai"}:
        raise ApiError(
            "`origin` must be one of: all, bee, user, ai.", code="invalid_parameter"
        )

    db = get_db()
    filters = [Fact.owner_id == g.current_user.id, Fact.deleted_at.is_(None)]
    if confirmed == "true":
        filters.append(Fact.confirmed.is_(True))
    elif confirmed == "false":
        filters.append(Fact.confirmed.is_(False))
    if origin != "all":
        filters.append(Fact.origin == origin)

    query = request.args.get("q", "").strip()
    if query:
        filters.append(Fact.text.ilike(f"%{query}%"))

    total = db.execute(select(func.count()).select_from(Fact).where(*filters)).scalar_one()
    rows = (
        db.execute(
            select(Fact)
            .where(*filters)
            .order_by(
                func.coalesce(Fact.bee_created_at, Fact.created_at).desc(),
                Fact.bee_id.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )

    return jsonify(
        page_payload(
            _serialize_many(db, g.current_user.id, list(rows)), total, limit, offset
        )
    )


@bp.post("")
@bp.post("/")
@login_required
def create_memory():
    body = json_body()
    text = _clean_text(body.get("text"))
    tags = _clean_tags(body.get("tags"))
    confirmed = body.get("confirmed", True)
    if not isinstance(confirmed, bool):
        raise ApiError("`confirmed` must be a boolean.", code="invalid_parameter")
    origin, ai_generated = provenance(body)

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

    row = Fact(
        owner_id=g.current_user.id,
        bee_id=next_local_bee_id(db, Fact, g.current_user.id),
        text=text,
        tags=tags or None,
        confirmed=confirmed,
        origin=origin,
        source_kind="conversation" if source_conversation_id else "manual",
        source_conversation_id=source_conversation_id,
        source_excerpt=source_excerpt,
        ai_generated=ai_generated,
        created_at=utcnow(),
        updated_at=utcnow(),
        synced_at=utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return jsonify(_serialize(db, g.current_user.id, row)), 201


@bp.patch("/<bee_id>")
@login_required
def update_memory(bee_id: str):
    bee_id = path_int(bee_id, "bee_id")
    body = json_body()
    row = _get_fact(bee_id)
    db = get_db()

    changed = False
    if "text" in body:
        row.text = _clean_text(body.get("text"))
        changed = True
    if "tags" in body:
        row.tags = _clean_tags(body.get("tags")) or None
        changed = True
    if "confirmed" in body:
        if not isinstance(body.get("confirmed"), bool):
            raise ApiError("`confirmed` must be a boolean.", code="invalid_parameter")
        row.confirmed = body["confirmed"]
        changed = True
    if "source_excerpt" in body:
        value = body.get("source_excerpt")
        if value is not None and not isinstance(value, str):
            raise ApiError("`source_excerpt` must be a string.", code="invalid_parameter")
        row.source_excerpt = value.strip()[:1000] if isinstance(value, str) and value.strip() else None
        changed = True

    if not changed:
        raise ApiError("Provide at least one field to update.", code="invalid_parameter")

    # Editing a Bee-sourced memory makes it a local correction and tombstones the
    # Bee id so sync does not overwrite it on the next run.
    if row.bee_id > 0:
        add_tombstone(db, g.current_user.id, "fact", row.bee_id)
        row.origin = "user"
        row.ai_generated = False

    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return jsonify(_serialize(db, g.current_user.id, row))


@bp.delete("/<bee_id>")
@login_required
def delete_memory(bee_id: str):
    bee_id = path_int(bee_id, "bee_id")
    row = _get_fact(bee_id)
    db = get_db()
    if row.bee_id > 0:
        add_tombstone(db, g.current_user.id, "fact", row.bee_id)
    db.delete(row)
    db.commit()
    return jsonify({"deleted": True, "bee_id": bee_id})


@bp.post("/extract")
@login_required
def extract_memories():
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
    existing = db.execute(
        select(Fact.text).where(
            Fact.owner_id == g.current_user.id, Fact.deleted_at.is_(None)
        )
    ).scalars()
    existing_texts = {normalize_text(text) for text in existing if text}

    check_ai_rate_limit()
    candidates = extract_candidates(
        db, get_ai_client(), conversation, existing_texts=existing_texts
    )
    return jsonify(
        {
            "candidates": candidates,
            "persisted": False,
            "model": get_settings().ai_model,
            "source": {
                "conversation_id": conversation.id,
                "bee_id": conversation.bee_id,
                "route": f"/conversations/{conversation.bee_id}",
            },
        }
    )
