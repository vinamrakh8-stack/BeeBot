"""Learning-content generation from an authorized conversation."""

from __future__ import annotations

from typing import Any

from models import Conversation
from services.ai_client import AIClient
from services.source_service import conversation_text

_LEARNING_SYSTEM = """You create study material from an authorized conversation.
Return strict JSON:
{
  "notes": "structured study notes in Markdown",
  "goals": ["..."],
  "revision_plan": ["Day 1: review the notes (20 minutes)"],
  "flashcards": [{"question":"...","answer":"...","explanation":"..."}],
  "quiz": [{"question":"...","answer":"...","explanation":"..."}]
}

Rules:
- Use ONLY the supplied conversation text. Do not add outside facts that could
  be mistaken for something the conversation said.
- Keep notes structured and traceable to the source. Do not fabricate quotes.
- Flashcards and quiz answers must be directly supported by the text.
- `revision_plan` is a short ordered study schedule. Each entry names a day or
  step and what to review. Do not promise outcomes or invent deadlines.
- Return at most 12 flashcards, 10 quiz questions, and 8 plan steps.
- If the text is too thin, return fewer items and explain the gap in `notes`."""


def _clean_text(value: Any, *, maximum: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text[:maximum] if text else None


def _clean_strings(value: Any, *, maximum: int = 10, length: int = 300) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        text = _clean_text(item, maximum=length)
        if text and text not in out:
            out.append(text)
        if len(out) >= maximum:
            break
    return out


def _clean_items(value: Any, *, maximum: int) -> list[dict]:
    if not isinstance(value, list):
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for raw in value[:maximum]:
        if not isinstance(raw, dict):
            continue
        question = _clean_text(raw.get("question"), maximum=1000)
        answer = _clean_text(raw.get("answer"), maximum=2000)
        if not question or not answer or question in seen:
            continue
        seen.add(question)
        out.append(
            {
                "question": question,
                "answer": answer,
                "explanation": _clean_text(raw.get("explanation"), maximum=1000),
            }
        )
    return out


def generate_learning(ai: AIClient, conversation: Conversation) -> dict:
    text = conversation_text(conversation)
    if not text:
        from api_utils import ApiError

        raise ApiError(
            "This conversation has no summary or transcript to build study material from.",
            code="insufficient_source",
        )
    result = ai.chat_json(
        _LEARNING_SYSTEM,
        f"Conversation id: {conversation.bee_id}\n\n{text}",
    )
    return {
        "notes": _clean_text(result.get("notes"), maximum=20_000),
        "goals": _clean_strings(result.get("goals")),
        "revision_plan": _clean_strings(result.get("revision_plan"), maximum=8),
        "flashcards": _clean_items(result.get("flashcards"), maximum=12),
        "quiz": _clean_items(result.get("quiz"), maximum=10),
    }
