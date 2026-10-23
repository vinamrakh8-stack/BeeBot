"""Dashboard overview aggregate."""

from __future__ import annotations

from datetime import datetime, timezone

from flask import Blueprint, current_app, g, jsonify
from sqlalchemy import func, select

from api_utils import dump
from models import Conversation, DailySummary, Fact, Todo
from schemas import (
    ConversationOut,
    DailySummaryOut,
    FactOut,
    OverviewOut,
    TodoOut,
)
from security import get_db, login_required
from services.activity_service import collect_activity
from services.sync_service import get_sync_status, is_running

bp = Blueprint("overview", __name__, url_prefix="/api/overview")


def _count(db, model, *filters) -> int:
    return db.execute(select(func.count()).select_from(model).where(*filters)).scalar_one()


@bp.get("")
@bp.get("/")
@login_required
def overview():
    db = get_db()
    owner_id = g.current_user.id

    counts = {
        "conversations": _count(
            db, Conversation, Conversation.owner_id == owner_id, Conversation.deleted.is_(False)
        ),
        "daily_summaries": _count(
            db, DailySummary, DailySummary.owner_id == owner_id, DailySummary.deleted.is_(False)
        ),
        "facts": _count(db, Fact, Fact.owner_id == owner_id),
        "todos_open": _count(db, Todo, Todo.owner_id == owner_id, Todo.completed.is_(False)),
        "todos_completed": _count(db, Todo, Todo.owner_id == owner_id, Todo.completed.is_(True)),
    }

    today = datetime.now(timezone.utc).date()
    today_summary = db.execute(
        select(DailySummary).where(
            DailySummary.owner_id == owner_id,
            DailySummary.deleted.is_(False),
            DailySummary.day == today,
        )
    ).scalar_one_or_none()
    if today_summary is None:
        today_summary = db.execute(
            select(DailySummary)
            .where(DailySummary.owner_id == owner_id, DailySummary.deleted.is_(False))
            .order_by(DailySummary.day.desc(), DailySummary.bee_id.desc())
            .limit(1)
        ).scalar_one_or_none()

    recent_conversations = db.execute(
        select(Conversation)
        .where(Conversation.owner_id == owner_id, Conversation.deleted.is_(False))
        .order_by(
            func.coalesce(Conversation.start_time, Conversation.bee_created_at).desc(),
            Conversation.bee_id.desc(),
        )
        .limit(5)
    ).scalars().all()

    open_todos = db.execute(
        select(Todo)
        .where(Todo.owner_id == owner_id, Todo.completed.is_(False))
        .order_by(func.coalesce(Todo.alarm_at, Todo.bee_created_at).desc(), Todo.bee_id.desc())
        .limit(5)
    ).scalars().all()

    recent_facts = db.execute(
        select(Fact)
        .where(Fact.owner_id == owner_id)
        .order_by(Fact.bee_created_at.desc(), Fact.bee_id.desc())
        .limit(5)
    ).scalars().all()

    payload = OverviewOut(
        counts=counts,
        sync=get_sync_status(
            db, owner_id, running=is_running(current_app.extensions["bee_sync_lock"])
        ),
        today_summary=DailySummaryOut.model_validate(today_summary) if today_summary else None,
        recent_conversations=[ConversationOut.model_validate(row) for row in recent_conversations],
        open_todos=[TodoOut.model_validate(row) for row in open_todos],
        recent_facts=[FactOut.model_validate(row) for row in recent_facts],
        recent_activity=collect_activity(db, owner_id, limit=8),
    )
    return jsonify(dump(payload))
