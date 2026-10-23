"""Personal memory helpers: local ids, tombstones, and AI candidate extraction."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models import Conversation, Fact, SyncTombstone, utcnow
from services.ai_client import AIClient
from services.source_service import conversation_text

_MEMORY_SYSTEM = """You extract candidate personal memories from an authorized
conversation. Return strict JSON with this shape:
{"candidates":[{"text":"...","tags":["..."],"confidence":0.0,"excerpt":"..."}]}

Rules:
- Only include facts, preferences, decisions, or project context explicitly
  supported by the conversation text.
- Do not infer sensitive traits (health, religion, politics, ethnicity,
  sexuality) unless the user explicitly stated them and they are necessary.
- Do not invent names, dates, or commitments.
- `excerpt` must be a short verbatim quote from the conversation that supports
  the candidate. If no verbatim quote exists, omit the candidate.
- Return at most 8 candidates. Return {"candidates":[]} if nothing is supported."""


def next_local_bee_id(db: Session, model, owner_id: int) -> int:
    """Allocate a negative surrogate id for a local record.

    The Phase 1 schema requires a non-null unique ``(owner_id, bee_id)``. Local
    records use negative values, which can never collide with real Bee ids.
    """
    current = db.execute(
        select(func.min(model.bee_id)).where(model.owner_id == owner_id)
    ).scalar()
    return min(0, int(current or 0)) - 1


def add_tombstone(db: Session, owner_id: int, entity: str, source_id: int) -> None:
    existing = db.execute(
        select(SyncTombstone).where(
            SyncTombstone.owner_id == owner_id,
            SyncTombstone.entity == entity,
            SyncTombstone.source_id == source_id,
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(
            SyncTombstone(
                owner_id=owner_id,
                entity=entity,
                source_id=source_id,
                deleted_at=utcnow(),
            )
        )
    else:
        existing.deleted_at = utcnow()


def is_tombstoned(db: Session, owner_id: int, entity: str, source_id: int) -> bool:
    return (
        db.execute(
            select(SyncTombstone.id).where(
                SyncTombstone.owner_id == owner_id,
                SyncTombstone.entity == entity,
                SyncTombstone.source_id == source_id,
            )
        ).first()
        is not None
    )


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", value.lower())).strip()


def _clean_tags(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    tags: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip() and item.strip() not in tags:
            tags.append(item.strip()[:48])
        if len(tags) >= 8:
            break
    return tags


def _as_confidence(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.5
    return max(0.0, min(1.0, float(value)))


def extract_candidates(
    db: Session,
    ai: AIClient,
    conversation: Conversation,
    *,
    existing_texts: set[str] | None = None,
) -> list[dict]:
    text = conversation_text(conversation)
    if not text:
        from api_utils import ApiError

        raise ApiError(
            "This conversation has no summary or transcript to extract from.",
            code="insufficient_source",
        )

    result = ai.chat_json(
        _MEMORY_SYSTEM,
        f"Conversation id: {conversation.bee_id}\n\n{text}",
    )
    raw_candidates = result.get("candidates")
    if not isinstance(raw_candidates, list):
        return []

    existing = existing_texts or set()
    candidates: list[dict] = []
    seen: set[str] = set()
    for raw in raw_candidates[:8]:
        if not isinstance(raw, dict):
            continue
        text_value = raw.get("text")
        if not isinstance(text_value, str) or not text_value.strip():
            continue
        clean = text_value.strip()[:1000]
        normalized = normalize_text(clean)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        candidates.append(
            {
                "text": clean,
                "tags": _clean_tags(raw.get("tags")),
                "confidence": _as_confidence(raw.get("confidence")),
                "excerpt": (
                    raw.get("excerpt").strip()[:500]
                    if isinstance(raw.get("excerpt"), str)
                    else None
                ),
                "source_kind": "conversation",
                "source_conversation_id": conversation.id,
                "conversation_bee_id": conversation.bee_id,
                "duplicate": normalized in existing,
            }
        )
    return candidates
