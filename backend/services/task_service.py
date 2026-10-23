"""Task extraction and duplicate detection helpers."""

from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, time, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Conversation, Todo
from services.ai_client import AIClient
from services.source_service import conversation_text

_TASK_SYSTEM = """You extract candidate tasks from an authorized conversation.
Return strict JSON:
{"candidates":[{"text":"...","due_at":null,"confidence":0.0,"excerpt":"..."}]}

Rules:
- Only include commitments, follow-ups, deadlines, or action items explicitly
  supported by the conversation.
- `text` should be a short, actionable task. Do not invent an owner.
- `due_at` must be an ISO-8601 date or datetime ONLY when the conversation states
  it. Otherwise use null. Do not guess a deadline.
- `excerpt` must be a short verbatim quote supporting the task.
- Return at most 8 candidates. Return {"candidates":[]} if nothing is supported."""


def normalize_task_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", value.lower())).strip()


def make_dedupe_key(source_conversation_id: int | None, text: str) -> str:
    normalized = normalize_task_text(text)
    digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:32]
    return f"{source_conversation_id or 'manual'}:{digest}"


def find_duplicate(
    db: Session, owner_id: int, dedupe_key: str, *, exclude_bee_id: int | None = None
) -> Todo | None:
    stmt = select(Todo).where(
        Todo.owner_id == owner_id,
        Todo.dedupe_key == dedupe_key,
        Todo.deleted_at.is_(None),
    )
    if exclude_bee_id is not None:
        stmt = stmt.where(Todo.bee_id != exclude_bee_id)
    return db.execute(stmt).scalars().first()


def _parse_due(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except ValueError:
        pass
    try:
        day = date.fromisoformat(raw[:10])
    except ValueError:
        return None
    return datetime.combine(day, time(9, 0))


def _confidence(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.5
    return max(0.0, min(1.0, float(value)))


def extract_candidates(
    ai: AIClient, conversation: Conversation
) -> list[dict]:
    text = conversation_text(conversation)
    if not text:
        from api_utils import ApiError

        raise ApiError(
            "This conversation has no summary or transcript to extract tasks from.",
            code="insufficient_source",
        )

    result = ai.chat_json(
        _TASK_SYSTEM,
        f"Conversation id: {conversation.bee_id}\n\n{text}",
    )
    raw_candidates = result.get("candidates")
    if not isinstance(raw_candidates, list):
        return []

    candidates: list[dict] = []
    seen: set[str] = set()
    for raw in raw_candidates[:8]:
        if not isinstance(raw, dict):
            continue
        text_value = raw.get("text")
        if not isinstance(text_value, str) or not text_value.strip():
            continue
        clean = text_value.strip()[:1000]
        normalized = normalize_task_text(clean)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        candidates.append(
            {
                "text": clean,
                "due_at": _parse_due(raw.get("due_at")),
                "confidence": _confidence(raw.get("confidence")),
                "excerpt": (
                    raw.get("excerpt").strip()[:500]
                    if isinstance(raw.get("excerpt"), str)
                    else None
                ),
                "source_kind": "conversation",
                "source_conversation_id": conversation.id,
                "conversation_bee_id": conversation.bee_id,
                "dedupe_key": make_dedupe_key(conversation.id, clean),
                "duplicate": False,
            }
        )
    return candidates
