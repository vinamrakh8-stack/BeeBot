"""Learning coach routes: study notes, flashcards, quizzes, and progress."""

from __future__ import annotations

from flask import Blueprint, g, jsonify, request
from sqlalchemy import delete, func, select

from api_utils import ApiError, dump, int_arg, json_body, page_payload
from models import LearningItem, LearningSet, utcnow
from schemas import LearningDetailOut, LearningItemOut, LearningSetOut
from security import (
    check_ai_rate_limit,
    get_ai_client,
    get_db,
    login_required,
)
from services.learning_service import generate_learning
from services.source_service import get_conversation

bp = Blueprint("learning", __name__, url_prefix="/api/learning")

_KINDS = {"flashcard", "quiz"}
_STATUSES = {"new", "review", "mastered"}


def _clean_text(value, field: str, *, maximum: int = 1000, required: bool = True) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str) or (required and not value.strip()):
        raise ApiError(f"`{field}` is required.", code="invalid_parameter")
    text = value.strip()
    if len(text) > maximum:
        raise ApiError(
            f"`{field}` is limited to {maximum} characters.", code="invalid_parameter"
        )
    return text or None


def _clean_goals(value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ApiError("`goals` must be a list of strings.", code="invalid_parameter")
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise ApiError("`goals` must be a list of strings.", code="invalid_parameter")
        text = item.strip()[:300]
        if text and text not in out:
            out.append(text)
        if len(out) >= 10:
            break
    return out


def _clean_revision_plan(value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ApiError("`revision_plan` must be a list of strings.", code="invalid_parameter")
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise ApiError(
                "`revision_plan` must be a list of strings.", code="invalid_parameter"
            )
        text = item.strip()[:300]
        if text and text not in out:
            out.append(text)
        if len(out) >= 14:
            break
    return out


def _get_set(set_id: int) -> LearningSet:
    row = get_db().execute(
        select(LearningSet).where(
            LearningSet.id == set_id,
            LearningSet.owner_id == g.current_user.id,
            LearningSet.deleted_at.is_(None),
        )
    ).scalar_one_or_none()
    if row is None:
        raise ApiError("Learning set not found.", status=404, code="not_found")
    return row


def _get_item(item_id: int) -> LearningItem:
    row = get_db().execute(
        select(LearningItem)
        .join(LearningSet, LearningSet.id == LearningItem.set_id)
        .where(
            LearningItem.id == item_id,
            LearningSet.owner_id == g.current_user.id,
            LearningSet.deleted_at.is_(None),
        )
    ).scalar_one_or_none()
    if row is None:
        raise ApiError("Learning item not found.", status=404, code="not_found")
    return row


def _detail(row: LearningSet) -> dict:
    db = get_db()
    items = (
        db.execute(
            select(LearningItem)
            .where(LearningItem.set_id == row.id)
            .order_by(LearningItem.kind.asc(), LearningItem.id.asc())
        )
        .scalars()
        .all()
    )
    payload = LearningDetailOut.model_validate(
        {
            **LearningSetOut.model_validate(row).model_dump(),
            "items": [LearningItemOut.model_validate(item) for item in items],
            "item_count": len(items),
        }
    )
    return dump(payload)


@bp.get("")
@bp.get("/")
@login_required
def list_sets():
    limit = int_arg("limit", 25, minimum=1, maximum=100)
    offset = int_arg("offset", 0, minimum=0, maximum=1_000_000)
    filters = [LearningSet.owner_id == g.current_user.id, LearningSet.deleted_at.is_(None)]

    db = get_db()
    total = db.execute(
        select(func.count()).select_from(LearningSet).where(*filters)
    ).scalar_one()
    rows = (
        db.execute(
            select(LearningSet)
            .where(*filters)
            .order_by(LearningSet.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )
    counts = dict(
        db.execute(
            select(LearningItem.set_id, func.count())
            .join(LearningSet, LearningSet.id == LearningItem.set_id)
            .where(LearningSet.owner_id == g.current_user.id)
            .group_by(LearningItem.set_id)
        ).all()
    )
    items = [
        LearningSetOut.model_validate(
            {
                **LearningSetOut.model_validate(row).model_dump(),
                "item_count": int(counts.get(row.id, 0)),
            }
        )
        for row in rows
    ]
    return jsonify(page_payload(items, total, limit, offset))


@bp.post("")
@bp.post("/")
@login_required
def create_set():
    body = json_body()
    title = _clean_text(body.get("title"), "title", maximum=255)
    goals = _clean_goals(body.get("goals"))
    revision_plan = _clean_revision_plan(body.get("revision_plan"))
    notes = _clean_text(body.get("notes"), "notes", maximum=20_000, required=False)
    conversation_id = body.get("conversation_id")
    if conversation_id is not None and not isinstance(conversation_id, int):
        raise ApiError("`conversation_id` must be an integer.", code="invalid_parameter")

    db = get_db()
    conversation = None
    if conversation_id is not None:
        conversation = get_conversation(db, g.current_user.id, conversation_id)

    row = LearningSet(
        owner_id=g.current_user.id,
        title=title,
        source_kind="conversation" if conversation else "manual",
        conversation_id=conversation.id if conversation else None,
        conversation_bee_id=conversation.bee_id if conversation else None,
        notes=notes,
        goals=goals or None,
        revision_plan=revision_plan or None,
        ai_generated=False,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return jsonify(_detail(row)), 201


@bp.get("/<int:set_id>")
@login_required
def get_set(set_id: int):
    return jsonify(_detail(_get_set(set_id)))


@bp.patch("/<int:set_id>")
@login_required
def update_set(set_id: int):
    row = _get_set(set_id)
    body = json_body()
    if not body:
        raise ApiError("Provide at least one field to update.", code="invalid_parameter")
    if "title" in body:
        row.title = _clean_text(body.get("title"), "title", maximum=255)
    if "notes" in body:
        row.notes = _clean_text(body.get("notes"), "notes", maximum=20_000, required=False)
    if "goals" in body:
        row.goals = _clean_goals(body.get("goals")) or None
    if "revision_plan" in body:
        row.revision_plan = _clean_revision_plan(body.get("revision_plan")) or None
    row.updated_at = utcnow()
    db = get_db()
    db.commit()
    db.refresh(row)
    return jsonify(_detail(row))


@bp.delete("/<int:set_id>")
@login_required
def delete_set(set_id: int):
    row = _get_set(set_id)
    row.deleted_at = utcnow()
    row.updated_at = utcnow()
    get_db().commit()
    return jsonify({"deleted": True, "id": set_id})


@bp.post("/<int:set_id>/items")
@login_required
def create_item(set_id: int):
    row = _get_set(set_id)
    body = json_body()
    kind = body.get("kind", "flashcard")
    if kind not in _KINDS:
        raise ApiError("`kind` must be flashcard or quiz.", code="invalid_parameter")
    question = _clean_text(body.get("question"), "question", maximum=1000)
    answer = _clean_text(body.get("answer"), "answer", maximum=2000)
    explanation = _clean_text(
        body.get("explanation"), "explanation", maximum=1000, required=False
    )

    db = get_db()
    item = LearningItem(
        set_id=row.id,
        kind=kind,
        question=question,
        answer=answer,
        explanation=explanation,
        status="new",
        reviews=0,
        ai_generated=False,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(item)
    row.updated_at = utcnow()
    db.commit()
    db.refresh(item)
    return jsonify(dump(LearningItemOut.model_validate(item))), 201


@bp.patch("/items/<int:item_id>")
@login_required
def update_item(item_id: int):
    item = _get_item(item_id)
    body = json_body()
    if not body:
        raise ApiError("Provide at least one field to update.", code="invalid_parameter")

    if "kind" in body:
        if body.get("kind") not in _KINDS:
            raise ApiError("`kind` must be flashcard or quiz.", code="invalid_parameter")
        item.kind = body["kind"]
    if "question" in body:
        item.question = _clean_text(body.get("question"), "question", maximum=1000)
    if "answer" in body:
        item.answer = _clean_text(body.get("answer"), "answer", maximum=2000)
    if "explanation" in body:
        item.explanation = _clean_text(
            body.get("explanation"), "explanation", maximum=1000, required=False
        )
    if "status" in body:
        status = body.get("status")
        if status not in _STATUSES:
            raise ApiError(
                "`status` must be new, review, or mastered.", code="invalid_parameter"
            )
        item.status = status
        item.last_reviewed_at = utcnow()
    if "reviews" in body:
        reviews = body.get("reviews")
        if not isinstance(reviews, int) or isinstance(reviews, bool) or reviews < 0:
            raise ApiError("`reviews` must be a non-negative integer.", code="invalid_parameter")
        item.reviews = reviews

    item.updated_at = utcnow()
    db = get_db()
    set_row = db.get(LearningSet, item.set_id)
    if set_row is not None:
        set_row.updated_at = utcnow()
    db.commit()
    db.refresh(item)
    return jsonify(dump(LearningItemOut.model_validate(item)))


@bp.delete("/items/<int:item_id>")
@login_required
def delete_item(item_id: int):
    item = _get_item(item_id)
    db = get_db()
    set_row = db.get(LearningSet, item.set_id)
    db.delete(item)
    if set_row is not None:
        set_row.updated_at = utcnow()
    db.commit()
    return jsonify({"deleted": True, "id": item_id})


@bp.post("/<int:set_id>/generate")
@login_required
def generate_set(set_id: int):
    row = _get_set(set_id)
    if row.conversation_id is None:
        raise ApiError(
            "This learning set has no linked conversation. Add items manually or "
            "create a set from a conversation.",
            code="insufficient_source",
        )
    db = get_db()
    conversation = get_conversation(db, g.current_user.id, row.conversation_id)
    check_ai_rate_limit()
    generated = generate_learning(get_ai_client(), conversation)

    row.notes = generated["notes"]
    row.goals = generated["goals"] or None
    row.revision_plan = generated["revision_plan"] or None
    row.ai_generated = True
    row.updated_at = utcnow()

    # Replace only previously AI-generated items; user-created/edited items are
    # preserved. This makes regeneration idempotent without discarding manual work.
    db.execute(
        delete(LearningItem).where(
            LearningItem.set_id == row.id, LearningItem.ai_generated.is_(True)
        )
    )
    for kind, group in (("flashcard", generated["flashcards"]), ("quiz", generated["quiz"])):
        for entry in group:
            db.add(
                LearningItem(
                    set_id=row.id,
                    kind=kind,
                    question=entry["question"],
                    answer=entry["answer"],
                    explanation=entry["explanation"],
                    status="new",
                    reviews=0,
                    ai_generated=True,
                    created_at=utcnow(),
                    updated_at=utcnow(),
                )
            )
    db.commit()
    db.refresh(row)
    return jsonify(_detail(row))
