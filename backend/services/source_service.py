"""Helpers for turning authorized stored records into source text.

Only records already synced for the signed-in operator are read. Nothing here
calls Bee or another network service.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from api_utils import ApiError
from models import Conversation


def get_conversation(db: Session, owner_id: int, conversation_id: int) -> Conversation:
    row = db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.owner_id == owner_id,
            Conversation.deleted.is_(False),
        )
    ).scalar_one_or_none()
    if row is None:
        raise ApiError("Conversation not found.", status=404, code="not_found")
    return row


def get_conversation_by_bee_id(
    db: Session, owner_id: int, bee_id: int
) -> Conversation:
    row = db.execute(
        select(Conversation).where(
            Conversation.bee_id == bee_id,
            Conversation.owner_id == owner_id,
            Conversation.deleted.is_(False),
        )
    ).scalar_one_or_none()
    if row is None:
        raise ApiError("Conversation not found.", status=404, code="not_found")
    return row


def conversation_bee_ids(
    db: Session, owner_id: int, local_ids: Iterable[int | None]
) -> dict[int, int]:
    """Map local conversation ids to Bee conversation ids for this owner.

    Local records store the surrogate key in ``source_conversation_id`` while
    every conversation route uses the Bee id. One batched lookup keeps list
    endpoints free of per-row queries.
    """
    ids = {int(value) for value in local_ids if isinstance(value, int)}
    if not ids:
        return {}
    rows = db.execute(
        select(Conversation.id, Conversation.bee_id).where(
            Conversation.owner_id == owner_id,
            Conversation.id.in_(ids),
        )
    ).all()
    return {int(local): int(bee) for local, bee in rows}


def conversation_text(conversation: Conversation, *, max_chars: int = 14_000) -> str:
    parts: list[str] = []
    if conversation.short_summary:
        parts.append(f"Short summary:\n{conversation.short_summary}")
    if conversation.summary:
        parts.append(f"Summary:\n{conversation.summary}")

    transcriptions = conversation.transcriptions
    if isinstance(transcriptions, list) and transcriptions:
        lines: list[str] = []

        def add_line(item: dict) -> None:
            text = item.get("text") or item.get("transcript") or item.get("content")
            if not isinstance(text, str) or not text.strip():
                return
            speaker = item.get("speaker") or item.get("speaker_label") or item.get("name")
            prefix = f"{speaker}: " if isinstance(speaker, str) and speaker.strip() else ""
            lines.append(prefix + text.strip())

        for item in transcriptions:
            if isinstance(item, str):
                lines.append(item.strip())
                continue
            if not isinstance(item, dict):
                continue
            utterances = item.get("utterances")
            if isinstance(utterances, list) and utterances:
                for utterance in utterances:
                    if isinstance(utterance, dict):
                        add_line(utterance)
                continue
            add_line(item)
        if lines:
            parts.append("Transcript:\n" + "\n".join(lines))

    text = "\n\n".join(parts).strip()
    if len(text) > max_chars:
        text = text[:max_chars] + "\n[truncated]"
    return text


def speaker_labels(conversation: Conversation) -> list[str]:
    transcriptions = conversation.transcriptions
    if not isinstance(transcriptions, list):
        return []
    labels: list[str] = []

    def add_label(item: dict) -> None:
        speaker = item.get("speaker") or item.get("speaker_label") or item.get("name")
        if isinstance(speaker, str) and speaker.strip() and speaker.strip() not in labels:
            labels.append(speaker.strip())

    for item in transcriptions:
        if not isinstance(item, dict):
            continue
        utterances = item.get("utterances")
        if isinstance(utterances, list) and utterances:
            for utterance in utterances:
                if isinstance(utterance, dict):
                    add_label(utterance)
            continue
        add_label(item)
    return labels
