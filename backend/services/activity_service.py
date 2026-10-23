"""Activity timeline derived from already-synced records.

Bee exposes a change feed for sync but no documented global activity endpoint,
so this merges the entities we store instead of inventing one.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Conversation, DailySummary, Fact, Todo
from schemas import ActivityItem


def _snippet(text: str | None, fallback: str, limit: int = 160) -> str:
    if not text:
        return fallback
    cleaned = " ".join(text.split())
    return cleaned if len(cleaned) <= limit else cleaned[: limit - 1] + "…"


def collect_activity(db: Session, owner_id: int, limit: int = 20) -> list[ActivityItem]:
    items: list[ActivityItem] = []

    conversations = db.execute(
        select(Conversation)
        .where(Conversation.owner_id == owner_id, Conversation.deleted.is_(False))
        .order_by(Conversation.start_time.desc())
        .limit(limit)
    ).scalars().all()
    for row in conversations:
        items.append(
            ActivityItem(
                kind="conversation",
                bee_id=row.bee_id,
                title=_snippet(row.short_summary or row.summary, f"Conversation {row.bee_id}"),
                subtitle=row.device_type,
                occurred_at=row.start_time or row.bee_created_at,
            )
        )

    summaries = db.execute(
        select(DailySummary)
        .where(DailySummary.owner_id == owner_id, DailySummary.deleted.is_(False))
        .order_by(DailySummary.day.desc())
        .limit(limit)
    ).scalars().all()
    for row in summaries:
        label = row.day.isoformat() if row.day else f"#{row.bee_id}"
        items.append(
            ActivityItem(
                kind="daily",
                bee_id=row.bee_id,
                title=_snippet(row.short_summary or row.summary, f"Daily summary {label}"),
                subtitle=f"Daily summary · {label}",
                occurred_at=row.day_time or row.bee_created_at,
            )
        )

    facts = db.execute(
        select(Fact)
        .where(Fact.owner_id == owner_id)
        .order_by(Fact.bee_created_at.desc())
        .limit(limit)
    ).scalars().all()
    for row in facts:
        items.append(
            ActivityItem(
                kind="fact",
                bee_id=row.bee_id,
                title=_snippet(row.text, f"Memory {row.bee_id}"),
                subtitle="Learned memory" if row.confirmed else "Pending memory",
                occurred_at=row.bee_created_at,
            )
        )

    todos = db.execute(
        select(Todo)
        .where(Todo.owner_id == owner_id)
        .order_by(Todo.bee_created_at.desc())
        .limit(limit)
    ).scalars().all()
    for row in todos:
        items.append(
            ActivityItem(
                kind="todo",
                bee_id=row.bee_id,
                title=_snippet(row.text, f"Task {row.bee_id}"),
                subtitle="Completed" if row.completed else "Open task",
                occurred_at=row.bee_created_at,
            )
        )

    items.sort(key=lambda item: item.occurred_at or datetime.min, reverse=True)
    return items[:limit]
