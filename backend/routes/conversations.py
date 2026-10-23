"""Conversation history and detail."""

from __future__ import annotations

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, or_, select

from api_utils import ApiError, dump, page_payload, pagination
from models import Conversation, utcnow
from schemas import ConversationDetailOut, ConversationOut
from security import get_client, get_db, login_required
from services.bee_errors import BeeError, BeeNotFound, BeeNotConfigured
from services.normalize import conversation_values

bp = Blueprint("conversations", __name__, url_prefix="/api/conversations")


@bp.get("")
@bp.get("/")
@login_required
def list_conversations():
    limit, offset = pagination()
    query = request.args.get("q", "").strip()
    db = get_db()

    filters = [Conversation.owner_id == g.current_user.id, Conversation.deleted.is_(False)]
    if query:
        needle = f"%{query}%"
        filters.append(
            or_(
                Conversation.short_summary.ilike(needle),
                Conversation.summary.ilike(needle),
            )
        )

    total = db.execute(select(func.count()).select_from(Conversation).where(*filters)).scalar_one()
    rows = (
        db.execute(
            select(Conversation)
            .where(*filters)
            .order_by(
                func.coalesce(Conversation.start_time, Conversation.bee_created_at).desc(),
                Conversation.bee_id.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )

    return jsonify(
        page_payload([ConversationOut.model_validate(row) for row in rows], total, limit, offset)
    )


@bp.get("/<int:bee_id>")
@login_required
def get_conversation(bee_id: int):
    db = get_db()
    row = db.execute(
        select(Conversation).where(
            Conversation.owner_id == g.current_user.id, Conversation.bee_id == bee_id
        )
    ).scalar_one_or_none()

    if row is None:
        raise ApiError("Conversation not found.", status=404, code="not_found")

    stale = False
    try:
        raw = get_client().conversation(bee_id)
    except BeeNotConfigured:
        raise
    except BeeNotFound:
        row.deleted = True
        db.commit()
        raise ApiError(
            "Conversation no longer exists in Bee.", status=404, code="not_found"
        ) from None
    except BeeError:
        # Cached copy with an explicit staleness flag beats a blank page.
        stale = True
    else:
        if raw:
            for key, value in conversation_values(raw).items():
                setattr(row, key, value)
            row.deleted = False
            row.synced_at = utcnow()
            db.commit()
            db.refresh(row)

    detail = ConversationDetailOut.model_validate(row)
    if stale:
        detail = detail.model_copy(update={"stale": True})
    return jsonify(dump(detail))
