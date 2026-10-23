"""Meeting assistant routes.

Meetings are built from already-authorized conversations. The app never records
audio and never claims that Bee supports meeting recording.
"""

from __future__ import annotations

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, select

from api_utils import ApiError, dump, int_arg, json_body, page_payload, parse_datetime
from models import Meeting, utcnow
from schemas import MeetingOut
from security import (
    check_ai_rate_limit,
    get_ai_client,
    get_db,
    login_required,
)
from services.meeting_service import display_participants, generate_summary
from services.source_service import get_conversation

bp = Blueprint("meetings", __name__, url_prefix="/api/meetings")


def _clean_title(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ApiError("`title` is required.", code="invalid_parameter")
    title = value.strip()
    if len(title) > 255:
        raise ApiError("`title` is limited to 255 characters.", code="invalid_parameter")
    return title


def _clean_participants(value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ApiError("`participants` must be a list of strings.", code="invalid_parameter")
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise ApiError(
                "`participants` must be a list of strings.", code="invalid_parameter"
            )
        text = item.strip()[:80]
        if text and text not in out:
            out.append(text)
    return out[:20]


def _clean_string_list(value, field: str, *, maximum: int = 15, length: int = 500) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ApiError(f"`{field}` must be a list of strings.", code="invalid_parameter")
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise ApiError(f"`{field}` must be a list of strings.", code="invalid_parameter")
        text = item.strip()[:length]
        if text and text not in out:
            out.append(text)
        if len(out) >= maximum:
            break
    return out


def _clean_action_items(value) -> list[dict]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ApiError("`action_items` must be a list.", code="invalid_parameter")
    out: list[dict] = []
    for item in value:
        if isinstance(item, str):
            text = item.strip()[:500]
            if text:
                out.append({"text": text, "due_at": None})
        elif isinstance(item, dict):
            text = item.get("text")
            due = item.get("due_at")
            if not isinstance(text, str) or not text.strip():
                continue
            out.append(
                {
                    "text": text.strip()[:500],
                    "due_at": due.strip()[:64] if isinstance(due, str) and due.strip() else None,
                }
            )
        else:
            raise ApiError("`action_items` entries must be strings or objects.", code="invalid_parameter")
        if len(out) >= 15:
            break
    return out


def _get_meeting(meeting_id: int) -> Meeting:
    row = get_db().execute(
        select(Meeting).where(
            Meeting.id == meeting_id,
            Meeting.owner_id == g.current_user.id,
            Meeting.deleted_at.is_(None),
        )
    ).scalar_one_or_none()
    if row is None:
        raise ApiError("Meeting not found.", status=404, code="not_found")
    return row


def _serialize(row: Meeting) -> dict:
    return dump(MeetingOut.model_validate(row))


@bp.get("")
@bp.get("/")
@login_required
def list_meetings():
    limit = int_arg("limit", 25, minimum=1, maximum=100)
    offset = int_arg("offset", 0, minimum=0, maximum=1_000_000)
    query = request.args.get("q", "").strip()

    filters = [Meeting.owner_id == g.current_user.id, Meeting.deleted_at.is_(None)]
    if query:
        filters.append(
            (Meeting.title.ilike(f"%{query}%")) | (Meeting.summary.ilike(f"%{query}%"))
        )

    db = get_db()
    total = db.execute(select(func.count()).select_from(Meeting).where(*filters)).scalar_one()
    rows = (
        db.execute(
            select(Meeting)
            .where(*filters)
            .order_by(Meeting.meeting_at.desc(), Meeting.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )
    return jsonify(page_payload([MeetingOut.model_validate(row) for row in rows], total, limit, offset))


@bp.post("")
@bp.post("/")
@login_required
def create_meeting():
    body = json_body()
    db = get_db()

    conversation_id = body.get("conversation_id")
    if conversation_id is not None and not isinstance(conversation_id, int):
        raise ApiError("`conversation_id` must be an integer.", code="invalid_parameter")

    conversation = None
    if conversation_id is not None:
        conversation = get_conversation(db, g.current_user.id, conversation_id)

    title_value = body.get("title")
    if conversation is not None:
        default_title = (
            (conversation.short_summary or "").strip()
            or f"Conversation {conversation.bee_id}"
        )
        title = _clean_title(title_value) if isinstance(title_value, str) and title_value.strip() else default_title[:255]
    else:
        title = _clean_title(title_value)

    meeting_at = parse_datetime(body.get("meeting_at"), "meeting_at")
    if meeting_at is None and conversation is not None:
        meeting_at = conversation.start_time

    participants = _clean_participants(body.get("participants"))
    if conversation is not None and not participants:
        participants = display_participants(conversation)

    summary = body.get("summary")
    if summary is not None and not isinstance(summary, str):
        raise ApiError("`summary` must be a string.", code="invalid_parameter")

    row = Meeting(
        owner_id=g.current_user.id,
        conversation_id=conversation.id if conversation else None,
        conversation_bee_id=conversation.bee_id if conversation else None,
        title=title,
        meeting_at=meeting_at,
        participants=participants or None,
        summary=summary.strip()[:8000] if isinstance(summary, str) and summary.strip() else None,
        key_points=None,
        decisions=None,
        action_items=None,
        source_kind="conversation" if conversation else "manual",
        ai_generated=False,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return jsonify(_serialize(row)), 201


@bp.get("/<int:meeting_id>")
@login_required
def get_meeting(meeting_id: int):
    return jsonify(_serialize(_get_meeting(meeting_id)))


@bp.patch("/<int:meeting_id>")
@login_required
def update_meeting(meeting_id: int):
    row = _get_meeting(meeting_id)
    body = json_body()
    if not body:
        raise ApiError("Provide at least one field to update.", code="invalid_parameter")

    if "title" in body:
        row.title = _clean_title(body.get("title"))
    if "meeting_at" in body:
        row.meeting_at = parse_datetime(body.get("meeting_at"), "meeting_at")
    if "participants" in body:
        row.participants = _clean_participants(body.get("participants")) or None
    if "summary" in body:
        value = body.get("summary")
        if value is not None and not isinstance(value, str):
            raise ApiError("`summary` must be a string.", code="invalid_parameter")
        row.summary = value.strip()[:8000] if isinstance(value, str) and value.strip() else None
    if "key_points" in body:
        row.key_points = _clean_string_list(body.get("key_points"), "key_points") or None
    if "decisions" in body:
        row.decisions = _clean_string_list(body.get("decisions"), "decisions") or None
    if "action_items" in body:
        row.action_items = _clean_action_items(body.get("action_items")) or None

    row.updated_at = utcnow()
    db = get_db()
    db.commit()
    db.refresh(row)
    return jsonify(_serialize(row))


@bp.delete("/<int:meeting_id>")
@login_required
def delete_meeting(meeting_id: int):
    row = _get_meeting(meeting_id)
    row.deleted_at = utcnow()
    row.updated_at = utcnow()
    get_db().commit()
    return jsonify({"deleted": True, "id": meeting_id})


@bp.post("/<int:meeting_id>/generate")
@login_required
def generate_meeting(meeting_id: int):
    row = _get_meeting(meeting_id)
    if row.conversation_id is None:
        raise ApiError(
            "This meeting has no linked conversation, so there is no authorized "
            "transcript to summarize. Create a meeting from a conversation or edit "
            "the fields manually.",
            code="insufficient_source",
        )
    db = get_db()
    conversation = get_conversation(db, g.current_user.id, row.conversation_id)
    check_ai_rate_limit()
    generated = generate_summary(get_ai_client(), conversation)
    row.summary = generated["summary"]
    row.key_points = generated["key_points"] or None
    row.decisions = generated["decisions"] or None
    row.action_items = generated["action_items"] or None
    if generated["participants"]:
        row.participants = generated["participants"]
    row.ai_generated = True
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return jsonify(_serialize(row))
