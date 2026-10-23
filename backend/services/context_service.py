"""Owner-scoped context retrieval for grounded chat and global local search.

The Phase 2 implementation deliberately uses portable SQL keyword matching
(SQLite and MySQL) and ranks in Python. No embeddings are generated because no
embedding provider or vector store is configured. This keeps the feature honest
and fully functional without external services.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from models import Conversation, DailySummary, Fact, LearningSet, Meeting, Todo, utcnow

_STOPWORDS = {
    "about",
    "after",
    "again",
    "also",
    "and",
    "any",
    "are",
    "been",
    "before",
    "but",
    "can",
    "could",
    "did",
    "does",
    "for",
    "from",
    "had",
    "has",
    "have",
    "how",
    "into",
    "its",
    "just",
    "like",
    "make",
    "many",
    "more",
    "most",
    "not",
    "now",
    "our",
    "out",
    "over",
    "please",
    "should",
    "some",
    "such",
    "than",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "was",
    "were",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "will",
    "with",
    "would",
    "you",
    "your",
}

_KINDS = {
    "conversation",
    "daily_summary",
    "memory",
    "task",
    "meeting",
    "learning",
}
KINDS = _KINDS


@dataclass
class ContextSource:
    kind: str
    ref: str
    source_id: int
    title: str
    snippet: str
    occurred_at: datetime | None
    route: str
    verified: bool = True
    score: float = 0.0
    metadata: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "ref": self.ref,
            "id": self.source_id,
            "title": self.title,
            "snippet": self.snippet,
            "occurred_at": (
                self.occurred_at.replace(tzinfo=None).isoformat(timespec="seconds") + "Z"
                if self.occurred_at
                else None
            ),
            "route": self.route,
            "verified": self.verified,
            "score": round(self.score, 3),
            "metadata": self.metadata,
        }


def tokenize(query: str) -> list[str]:
    terms = re.findall(r"[a-zA-Z0-9][a-zA-Z0-9'-]{2,}", (query or "").lower())
    unique: list[str] = []
    for term in terms:
        term = term.strip("'-")
        if len(term) < 3 or term in _STOPWORDS or term in unique:
            continue
        unique.append(term)
        if len(unique) >= 8:
            break
    return unique


def _snippet(*values: str | None, limit: int = 320) -> str:
    for value in values:
        if value and value.strip():
            text = re.sub(r"\s+", " ", value).strip()
            return text[:limit] + ("…" if len(text) > limit else "")
    return ""


def _score(terms: list[str], *values: str | None, occurred_at: datetime | None) -> float:
    haystack = " ".join(value or "" for value in values).lower()
    score = 0.0
    for term in terms:
        score += haystack.count(term) * 2.0
    if occurred_at is not None:
        age_days = max(0.0, (utcnow() - occurred_at).total_seconds() / 86_400)
        score += max(0.0, 3.0 - age_days / 45.0)
    return score


def _term_filter(columns: Iterable, terms: list[str]):
    patterns = [f"%{term}%" for term in terms]
    return or_(*[column.ilike(pattern) for column in columns for pattern in patterns])


def retrieve(
    db: Session,
    owner_id: int,
    query: str = "",
    *,
    limit: int = 8,
    kinds: set[str] | None = None,
) -> list[ContextSource]:
    """Return the most relevant owner-scoped records for a query.

    A truly empty query returns recent records so browsing still works. A
    non-empty query that contains no searchable terms (for example ``???``)
    returns nothing: returning recent records would ground an answer on
    unrelated data. A record is never returned for another owner.
    """
    terms = tokenize(query)
    if query.strip() and not terms:
        return []
    allowed = (kinds or _KINDS) & _KINDS
    results: list[ContextSource] = []

    if "conversation" in allowed:
        stmt = select(Conversation).where(
            Conversation.owner_id == owner_id, Conversation.deleted.is_(False)
        )
        if terms:
            stmt = stmt.where(
                _term_filter(
                    (Conversation.short_summary, Conversation.summary), terms
                )
            )
        stmt = stmt.order_by(Conversation.start_time.desc()).limit(60)
        for row in db.execute(stmt).scalars():
            title = _snippet(row.short_summary, limit=90) or f"Conversation {row.bee_id}"
            snippet = _snippet(row.summary, row.short_summary)
            results.append(
                ContextSource(
                    kind="conversation",
                    ref=f"conversation:{row.id}",
                    source_id=row.bee_id,
                    title=title,
                    snippet=snippet,
                    occurred_at=row.start_time,
                    route=f"/conversations/{row.bee_id}",
                    score=_score(
                        terms,
                        row.short_summary,
                        row.summary,
                        occurred_at=row.start_time,
                    ),
                    metadata={"bee_id": row.bee_id},
                )
            )

    if "daily_summary" in allowed:
        stmt = select(DailySummary).where(
            DailySummary.owner_id == owner_id, DailySummary.deleted.is_(False)
        )
        if terms:
            stmt = stmt.where(
                _term_filter(
                    (DailySummary.short_summary, DailySummary.summary), terms
                )
            )
        stmt = stmt.order_by(DailySummary.day_time.desc()).limit(40)
        for row in db.execute(stmt).scalars():
            title = (
                f"Daily summary {row.day.isoformat()}"
                if row.day
                else f"Daily summary {row.bee_id}"
            )
            results.append(
                ContextSource(
                    kind="daily_summary",
                    ref=f"daily:{row.bee_id}",
                    source_id=row.bee_id,
                    title=title,
                    snippet=_snippet(row.summary, row.short_summary),
                    occurred_at=row.day_time,
                    route="/daily",
                    score=_score(
                        terms,
                        row.short_summary,
                        row.summary,
                        occurred_at=row.day_time,
                    ),
                    metadata={"bee_id": row.bee_id, "day": row.day.isoformat() if row.day else None},
                )
            )

    if "memory" in allowed:
        stmt = select(Fact).where(Fact.owner_id == owner_id, Fact.deleted_at.is_(None))
        if terms:
            stmt = stmt.where(_term_filter((Fact.text,), terms))
        stmt = stmt.order_by(Fact.updated_at.desc()).limit(60)
        for row in db.execute(stmt).scalars():
            results.append(
                ContextSource(
                    kind="memory",
                    ref=f"memory:{row.bee_id}",
                    source_id=row.bee_id,
                    title="Personal memory",
                    snippet=_snippet(row.text),
                    occurred_at=row.bee_created_at or row.created_at,
                    route="/memory",
                    verified=not row.ai_generated,
                    score=_score(
                        terms,
                        row.text,
                        occurred_at=row.bee_created_at or row.created_at,
                    ),
                    metadata={
                        "bee_id": row.bee_id,
                        "origin": row.origin,
                        "confirmed": row.confirmed,
                    },
                )
            )

    if "task" in allowed:
        stmt = select(Todo).where(Todo.owner_id == owner_id, Todo.deleted_at.is_(None))
        if terms:
            stmt = stmt.where(_term_filter((Todo.text,), terms))
        stmt = stmt.order_by(Todo.updated_at.desc()).limit(60)
        for row in db.execute(stmt).scalars():
            results.append(
                ContextSource(
                    kind="task",
                    ref=f"task:{row.bee_id}",
                    source_id=row.bee_id,
                    title="Task",
                    snippet=_snippet(row.text),
                    occurred_at=row.due_at or row.bee_created_at or row.created_at,
                    route="/tasks",
                    verified=not row.ai_generated,
                    score=_score(
                        terms,
                        row.text,
                        occurred_at=row.due_at or row.bee_created_at or row.created_at,
                    ),
                    metadata={
                        "bee_id": row.bee_id,
                        "completed": row.completed,
                        "origin": row.origin,
                    },
                )
            )

    if "meeting" in allowed:
        stmt = select(Meeting).where(
            Meeting.owner_id == owner_id, Meeting.deleted_at.is_(None)
        )
        if terms:
            stmt = stmt.where(_term_filter((Meeting.title, Meeting.summary), terms))
        stmt = stmt.order_by(Meeting.meeting_at.desc(), Meeting.created_at.desc()).limit(40)
        for row in db.execute(stmt).scalars():
            results.append(
                ContextSource(
                    kind="meeting",
                    ref=f"meeting:{row.id}",
                    source_id=row.id,
                    title=row.title,
                    snippet=_snippet(row.summary),
                    occurred_at=row.meeting_at or row.created_at,
                    route=f"/meetings/{row.id}",
                    verified=not row.ai_generated,
                    score=_score(
                        terms,
                        row.title,
                        row.summary,
                        occurred_at=row.meeting_at or row.created_at,
                    ),
                    metadata={
                        "conversation_bee_id": row.conversation_bee_id,
                        "ai_generated": row.ai_generated,
                    },
                )
            )

    if "learning" in allowed:
        stmt = select(LearningSet).where(
            LearningSet.owner_id == owner_id, LearningSet.deleted_at.is_(None)
        )
        if terms:
            stmt = stmt.where(_term_filter((LearningSet.title, LearningSet.notes), terms))
        stmt = stmt.order_by(LearningSet.updated_at.desc()).limit(40)
        for row in db.execute(stmt).scalars():
            results.append(
                ContextSource(
                    kind="learning",
                    ref=f"learning:{row.id}",
                    source_id=row.id,
                    title=row.title,
                    snippet=_snippet(row.notes),
                    occurred_at=row.created_at,
                    route=f"/learning/{row.id}",
                    verified=True,
                    score=_score(
                        terms, row.title, row.notes, occurred_at=row.created_at
                    ),
                    metadata={"conversation_bee_id": row.conversation_bee_id},
                )
            )

    results.sort(
        key=lambda item: (
            item.score,
            item.occurred_at.timestamp() if item.occurred_at else 0,
        ),
        reverse=True,
    )
    return results[: max(1, min(limit, 50))]


def prompt_block(sources: list[ContextSource]) -> str:
    lines: list[str] = []
    for index, source in enumerate(sources, start=1):
        when = (
            source.occurred_at.replace(tzinfo=None).isoformat(timespec="seconds") + "Z"
            if source.occurred_at
            else "date unknown"
        )
        lines.append(
            f"[S{index}] type={source.kind} id={source.source_id} date={when} "
            f"title={source.title!r}\n{source.snippet}"
        )
    return "\n\n".join(lines)
