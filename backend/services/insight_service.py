"""Deterministic daily/weekly insights from authorized stored records.

No AI and no health/productivity scoring is used. Every trend is a simple
record-count comparison and is labelled as such.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from api_utils import dump
from models import (
    Conversation,
    DailySummary,
    Fact,
    LearningSet,
    Meeting,
    Todo,
    utcnow,
)
from schemas import ConversationOut, DailySummaryOut, InsightsOut, TodoOut


def period_range(period: str, anchor: date) -> tuple[datetime, datetime, datetime, datetime]:
    if period == "day":
        start_date = anchor
        end_date = anchor + timedelta(days=1)
        previous_start = anchor - timedelta(days=1)
        previous_end = start_date
    elif period == "week":
        start_date = anchor - timedelta(days=anchor.weekday())
        end_date = start_date + timedelta(days=7)
        previous_start = start_date - timedelta(days=7)
        previous_end = start_date
    else:
        raise ValueError("period must be day or week")
    start = datetime.combine(start_date, time.min)
    end = datetime.combine(end_date, time.min)
    prev_start = datetime.combine(previous_start, time.min)
    prev_end = datetime.combine(previous_end, time.min)
    return start, end, prev_start, prev_end


def _count_conversations(db: Session, owner_id: int, start: datetime, end: datetime) -> int:
    return len(
        db.execute(
            select(Conversation.id).where(
                Conversation.owner_id == owner_id,
                Conversation.deleted.is_(False),
                Conversation.start_time >= start,
                Conversation.start_time < end,
            )
        ).all()
    )


def _count_completed_tasks(db: Session, owner_id: int, start: datetime, end: datetime) -> int:
    return len(
        db.execute(
            select(Todo.id).where(
                Todo.owner_id == owner_id,
                Todo.deleted_at.is_(None),
                Todo.completed.is_(True),
                Todo.updated_at >= start,
                Todo.updated_at < end,
            )
        ).all()
    )


def _count_memories(db: Session, owner_id: int, start: datetime, end: datetime) -> int:
    return len(
        db.execute(
            select(Fact.id).where(
                Fact.owner_id == owner_id,
                Fact.deleted_at.is_(None),
                Fact.created_at >= start,
                Fact.created_at < end,
            )
        ).all()
    )


def _count_meetings(db: Session, owner_id: int, start: datetime, end: datetime) -> int:
    return len(
        db.execute(
            select(Meeting.id).where(
                Meeting.owner_id == owner_id,
                Meeting.deleted_at.is_(None),
                Meeting.meeting_at >= start,
                Meeting.meeting_at < end,
            )
        ).all()
    )


def _task_payload(row: Todo) -> dict:
    return dump(TodoOut.model_validate(row))


def build_insights(
    db: Session, owner_id: int, *, period: str = "day", anchor: date | None = None
) -> InsightsOut:
    anchor = anchor or utcnow().date()
    start, end, prev_start, prev_end = period_range(period, anchor)
    now = utcnow()

    conversations = (
        db.execute(
            select(Conversation)
            .where(
                Conversation.owner_id == owner_id,
                Conversation.deleted.is_(False),
                Conversation.start_time >= start,
                Conversation.start_time < end,
            )
            .order_by(Conversation.start_time.desc())
            .limit(15)
        )
        .scalars()
        .all()
    )

    summaries = (
        db.execute(
            select(DailySummary)
            .where(
                DailySummary.owner_id == owner_id,
                DailySummary.deleted.is_(False),
                DailySummary.day >= start.date(),
                DailySummary.day < end.date(),
            )
            .order_by(DailySummary.day.desc())
            .limit(10)
        )
        .scalars()
        .all()
    )

    completed_tasks = (
        db.execute(
            select(Todo)
            .where(
                Todo.owner_id == owner_id,
                Todo.deleted_at.is_(None),
                Todo.completed.is_(True),
                Todo.updated_at >= start,
                Todo.updated_at < end,
            )
            .order_by(Todo.updated_at.desc())
            .limit(20)
        )
        .scalars()
        .all()
    )

    pending_tasks = (
        db.execute(
            select(Todo)
            .where(
                Todo.owner_id == owner_id,
                Todo.deleted_at.is_(None),
                Todo.completed.is_(False),
            )
            .order_by(Todo.due_at.asc(), Todo.bee_id.desc())
            .limit(20)
        )
        .scalars()
        .all()
    )

    meetings = (
        db.execute(
            select(Meeting)
            .where(
                Meeting.owner_id == owner_id,
                Meeting.deleted_at.is_(None),
                Meeting.meeting_at >= start,
                Meeting.meeting_at < end,
            )
            .order_by(Meeting.meeting_at.desc())
            .limit(15)
        )
        .scalars()
        .all()
    )

    facts = (
        db.execute(
            select(Fact)
            .where(
                Fact.owner_id == owner_id,
                Fact.deleted_at.is_(None),
                Fact.created_at >= start,
                Fact.created_at < end,
            )
            .order_by(Fact.created_at.desc())
            .limit(50)
        )
        .scalars()
        .all()
    )

    learning_sets = (
        db.execute(
            select(LearningSet)
            .where(
                LearningSet.owner_id == owner_id,
                LearningSet.deleted_at.is_(None),
                LearningSet.updated_at >= start,
                LearningSet.updated_at < end,
            )
            .order_by(LearningSet.updated_at.desc())
            .limit(10)
        )
        .scalars()
        .all()
    )

    decisions: list[dict] = []
    commitments: list[dict] = []
    for meeting in meetings:
        route = f"/meetings/{meeting.id}"
        for decision in meeting.decisions or []:
            if isinstance(decision, str):
                decisions.append(
                    {
                        "text": decision,
                        "meeting_id": meeting.id,
                        "meeting_title": meeting.title,
                        "occurred_at": (
                            meeting.meeting_at.isoformat(timespec="seconds") + "Z"
                            if meeting.meeting_at
                            else None
                        ),
                        "route": route,
                        "source": "meeting",
                    }
                )
        for item in meeting.action_items or []:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                commitments.append(
                    {
                        "text": item["text"],
                        "due_at": item.get("due_at"),
                        "meeting_id": meeting.id,
                        "meeting_title": meeting.title,
                        "route": route,
                        "source": "meeting_action_item",
                    }
                )

    for task in pending_tasks:
        if task.due_at is None:
            continue
        commitments.append(
            {
                "text": task.text,
                "due_at": task.due_at.isoformat(timespec="seconds") + "Z",
                "task_bee_id": task.bee_id,
                "route": (
                    f"/conversations/{task.source_conversation_id}"
                    if task.source_conversation_id
                    else "/tasks"
                ),
                "source": "task",
            }
        )

    tag_counts: dict[str, int] = {}
    for fact in facts:
        for tag in fact.tags or []:
            if isinstance(tag, str) and tag.strip():
                key = tag.strip()
                tag_counts[key] = tag_counts.get(key, 0) + 1
    project_activity = [
        {"tag": tag, "count": count, "basis": "tags on stored memories"}
        for tag, count in sorted(tag_counts.items(), key=lambda item: item[1], reverse=True)[:10]
    ]

    current = {
        "conversations": _count_conversations(db, owner_id, start, end),
        "completed_tasks": _count_completed_tasks(db, owner_id, start, end),
        "memories": _count_memories(db, owner_id, start, end),
        "meetings": _count_meetings(db, owner_id, start, end),
    }
    previous = {
        "conversations": _count_conversations(db, owner_id, prev_start, prev_end),
        "completed_tasks": _count_completed_tasks(db, owner_id, prev_start, prev_end),
        "memories": _count_memories(db, owner_id, prev_start, prev_end),
        "meetings": _count_meetings(db, owner_id, prev_start, prev_end),
    }
    trends = []
    for key in ("conversations", "completed_tasks", "memories", "meetings"):
        delta = current[key] - previous[key]
        trends.append(
            {
                "label": key.replace("_", " ").title(),
                "current": current[key],
                "previous": previous[key],
                "delta": delta,
                "direction": "up" if delta > 0 else "down" if delta < 0 else "flat",
                "basis": "stored record counts",
            }
        )

    due_soon = [
        _task_payload(task)
        for task in pending_tasks
        if task.due_at is not None and start <= task.due_at <= now + timedelta(days=7)
    ]
    overdue = [
        _task_payload(task)
        for task in pending_tasks
        if task.due_at is not None and task.due_at < now
    ]

    counts = {
        "conversations": len(conversations),
        "daily_summaries": len(summaries),
        "completed_tasks": len(completed_tasks),
        "pending_tasks": len(pending_tasks),
        "memories": len(facts),
        "meetings": len(meetings),
        "learning_sets": len(learning_sets),
    }
    sufficient = any(counts.values())

    return InsightsOut(
        period=period,
        start=start,
        end=end,
        sufficient_data=sufficient,
        counts=counts,
        recent_summaries=[
            dump(DailySummaryOut.model_validate(row)) for row in summaries
        ],
        conversations=[
            {
                **dump(ConversationOut.model_validate(row)),
                "route": f"/conversations/{row.bee_id}",
            }
            for row in conversations
        ],
        tasks={
            "completed": [_task_payload(row) for row in completed_tasks],
            "pending": [_task_payload(row) for row in pending_tasks],
            "due_soon": due_soon,
            "overdue": overdue,
        },
        decisions=decisions,
        commitments=commitments,
        project_activity=project_activity,
        trends=trends,
        notes=(
            "Computed locally from authorized stored records. Trends are simple "
            "record-count changes, not productivity, health, or performance scores. "
            "No AI model is used for these numbers."
        ),
        generated_at=utcnow(),
    )
