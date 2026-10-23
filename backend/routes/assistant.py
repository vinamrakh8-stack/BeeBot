"""AI assistant endpoints: grounded chat, transcription, and speech.

These are application endpoints. They are not Bee endpoints and never proxy raw
Bee data anywhere except the configured AI provider, using only the context
retrieved for the signed-in operator.
"""

from __future__ import annotations

from io import BytesIO

from flask import Blueprint, g, jsonify, request, send_file

from api_utils import ApiError, dump, json_body
from models import utcnow
from schemas import ChatOut, TranscriptOut
from security import (
    check_ai_rate_limit,
    get_ai_client,
    get_db,
    get_settings,
    login_required,
)
from services.context_service import prompt_block, retrieve

bp = Blueprint("assistant", __name__, url_prefix="/api/assistant")

_SYSTEM_PROMPT = """You are Bee Voice+, a careful personal assistant inside the
user's dashboard. Answer ONLY from the CONTEXT records supplied below.

Rules:
1. Every factual claim about the user's conversations, tasks, memories, meetings,
   or learning material must be supported by a context record.
2. Cite supporting records with their labels, for example [S1] or [S2].
3. If the context is missing, insufficient, or conflicting, say so plainly and
   ask a short clarifying question. Do not invent history, names, dates, quotes,
   or citations.
4. Distinguish what a record says from your own general suggestion. Label general
   suggestions as suggestions.
5. Be concise and use plain language. Never claim to have performed an action;
   you are answering a question from stored records."""


def _clean_text(value, field: str, *, maximum: int) -> str:
    if not isinstance(value, str):
        raise ApiError(f"`{field}` must be a string.", code="invalid_parameter")
    text = value.strip()
    if not text:
        raise ApiError(f"`{field}` is required.", code="invalid_parameter")
    if len(text) > maximum:
        raise ApiError(
            f"`{field}` is limited to {maximum} characters.", code="invalid_parameter"
        )
    return text


@bp.get("/status")
@login_required
def assistant_status():
    settings = get_settings()
    payload = settings.ai_public_summary()
    payload["retrieval"] = {
        "mode": "keyword",
        "embeddings": False,
        "note": (
            "Grounded keyword retrieval over stored records. Semantic embeddings "
            "are not enabled because no embedding provider or vector store is configured."
        ),
    }
    return jsonify(payload)


@bp.post("/chat")
@login_required
def assistant_chat():
    body = json_body()
    message = _clean_text(body.get("message"), "message", maximum=2000)
    settings = get_settings()
    max_sources = settings.ai_max_context_sources

    sources = retrieve(
        get_db(),
        g.current_user.id,
        message,
        limit=max_sources,
    )

    if not sources:
        return jsonify(
            dump(
                ChatOut(
                    answer=(
                        "I could not find any stored conversation, summary, memory, "
                        "task, meeting, or learning record that matches that question. "
                        "Try mentioning a person, project, or date. I will not invent "
                        "personal history when there is no source."
                    ),
                    sources=[],
                    grounded=False,
                    clarification_needed=True,
                    model=None,
                    generated_at=utcnow(),
                )
            )
        )

    client = get_ai_client()
    check_ai_rate_limit()
    system = _SYSTEM_PROMPT
    user = (
        "CONTEXT RECORDS\n"
        f"{prompt_block(sources)}\n\n"
        f"QUESTION\n{message}\n\n"
        "Answer from the records above. Cite [S#] labels. If they do not contain "
        "the answer, ask for clarification instead of guessing."
    )
    answer = client.chat_text(system, user)

    return jsonify(
        dump(
            ChatOut(
                answer=answer,
                sources=[source.as_dict() for source in sources],
                grounded=True,
                clarification_needed=False,
                model=settings.ai_model,
                generated_at=utcnow(),
            )
        )
    )


@bp.post("/transcribe")
@login_required
def assistant_transcribe():
    settings = get_settings()
    upload = request.files.get("audio")
    if upload is None:
        raise ApiError(
            "Attach recorded audio as the `audio` multipart field.",
            code="invalid_audio",
        )
    data = upload.read()
    if not data:
        raise ApiError("The uploaded audio was empty.", code="invalid_audio")
    if len(data) > settings.ai_max_audio_bytes:
        raise ApiError(
            f"Audio uploads are limited to {settings.ai_max_audio_bytes} bytes.",
            status=413,
            code="audio_too_large",
        )
    content_type = upload.mimetype or "application/octet-stream"
    if not (content_type.startswith("audio/") or content_type == "application/octet-stream"):
        raise ApiError(
            "The uploaded file must be audio.", status=415, code="invalid_audio_type"
        )

    check_ai_rate_limit()
    client = get_ai_client()
    text = client.transcribe(data, upload.filename or "audio.webm", content_type)
    return jsonify(dump(TranscriptOut(text=text, model=settings.ai_stt_model)))


@bp.post("/speak")
@login_required
def assistant_speak():
    settings = get_settings()
    body = json_body()
    text = _clean_text(body.get("text"), "text", maximum=2000)
    voice = body.get("voice")
    if voice is not None:
        voice = _clean_text(voice, "voice", maximum=64)

    check_ai_rate_limit()
    client = get_ai_client()
    audio, content_type = client.speak(text, voice)
    response = send_file(
        BytesIO(audio),
        mimetype=content_type or "audio/mpeg",
        as_attachment=False,
        download_name="speech.mp3",
    )
    response.headers["Cache-Control"] = "no-store"
    return response
