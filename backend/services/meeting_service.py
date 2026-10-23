"""Meeting-summary generation from authorized transcripts/summaries."""

from __future__ import annotations

from typing import Any

from models import Conversation
from services.ai_client import AIClient
from services.source_service import conversation_text, speaker_labels

_MEETING_SYSTEM = """You summarize a meeting from an authorized conversation
transcript/summary. Return strict JSON:
{
  "summary": "...",
  "key_points": ["..."],
  "decisions": ["..."],
  "action_items": [{"text": "...", "due_at": null}]
}

Rules:
- Use ONLY the supplied text. Never invent participants, decisions, deadlines,
  or events.
- `key_points` are the main discussion points.
- `decisions` are actual decisions, not suggestions.
- `action_items` are commitments with an owner only if the text names one; put
  the owner in the text. `due_at` is ISO-8601 only when stated, else null.
- If the text is insufficient, return empty arrays and a summary that says what
  is missing. Do not guess.
- Do not include participant names; the application takes those from source
  speaker metadata."""


def display_participants(conversation: Conversation) -> list[str]:
    labels = speaker_labels(conversation)
    cleaned: list[str] = []
    for label in labels[:20]:
        pretty = label.replace("_", " ").strip()
        if pretty and pretty not in cleaned:
            cleaned.append(pretty[:80])
    return cleaned


def _clean_text(value: Any, *, maximum: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text[:maximum] if text else None


def _clean_list(value: Any, *, maximum: int = 15, item_length: int = 500) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        text = _clean_text(item, maximum=item_length)
        if text and text not in items:
            items.append(text)
        if len(items) >= maximum:
            break
    return items


def _clean_action_items(value: Any) -> list[dict]:
    if not isinstance(value, list):
        return []
    items: list[dict] = []
    seen: set[str] = set()
    for raw in value[:15]:
        text: str | None = None
        due: str | None = None
        if isinstance(raw, str):
            text = _clean_text(raw, maximum=500)
        elif isinstance(raw, dict):
            text = _clean_text(raw.get("text"), maximum=500)
            due = _clean_text(raw.get("due_at"), maximum=64)
        if not text or text in seen:
            continue
        seen.add(text)
        items.append({"text": text, "due_at": due})
    return items


def generate_summary(ai: AIClient, conversation: Conversation) -> dict:
    text = conversation_text(conversation)
    if not text:
        from api_utils import ApiError

        raise ApiError(
            "This conversation has no summary or transcript to summarize.",
            code="insufficient_source",
        )
    result = ai.chat_json(
        _MEETING_SYSTEM,
        f"Conversation id: {conversation.bee_id}\n\n{text}",
    )
    return {
        "summary": _clean_text(result.get("summary"), maximum=8000),
        "key_points": _clean_list(result.get("key_points")),
        "decisions": _clean_list(result.get("decisions")),
        "action_items": _clean_action_items(result.get("action_items")),
        "participants": display_participants(conversation),
    }
