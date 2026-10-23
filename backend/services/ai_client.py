"""Optional OpenAI-compatible AI, speech-to-text, and text-to-speech client.

Only standard-library HTTP (httpx) is used, so no vendor SDK is required. The
API key never leaves the server. Tests inject an in-memory fake via
``app.extensions["ai_client"]`` and never call a real provider.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from config import Settings


class AIError(Exception):
    """A safe, client-facing AI failure with a stable code."""

    def __init__(self, message: str, *, status: int = 502, code: str = "ai_error") -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code

    def as_dict(self) -> dict:
        return {"error": self.code, "message": self.message}


def _extract_json(text: str) -> dict[str, Any]:
    """Parse JSON even when a provider wraps it in prose or code fences."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise AIError(
                "The AI provider returned a response that was not valid JSON.",
                code="ai_invalid_response",
            ) from None
        try:
            value = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError:
            raise AIError(
                "The AI provider returned a response that was not valid JSON.",
                code="ai_invalid_response",
            ) from None
    if not isinstance(value, dict):
        raise AIError(
            "The AI provider returned an unexpected response shape.",
            code="ai_invalid_response",
        )
    return value


class AIClient:
    """OpenAI-compatible chat, transcription, and speech endpoints."""

    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None) -> None:
        self.settings = settings
        self._client = httpx.Client(
            timeout=httpx.Timeout(settings.ai_timeout_seconds, connect=10.0),
            transport=transport,
        )

    # ------------------------------------------------------------------ helpers

    @property
    def configured(self) -> bool:
        return self.settings.ai_configured

    def _require_configured(self) -> None:
        if not self.configured:
            raise AIError(
                "AI provider is not configured. Set AI_API_KEY (and optionally "
                "AI_BASE_URL / AI_MODEL) on the server, or point AI_BASE_URL at a "
                "local OpenAI-compatible server.",
                status=503,
                code="ai_not_configured",
            )

    def _url(self, path: str) -> str:
        return f"{self.settings.ai_base_url.rstrip('/')}/{path.lstrip('/')}"

    def _headers(self) -> dict[str, str]:
        key = self.settings.ai_api_key_value
        return {"Authorization": f"Bearer {key}"} if key else {}

    def _post(self, path: str, **kwargs: Any) -> httpx.Response:
        self._require_configured()
        try:
            response = self._client.post(self._url(path), headers=self._headers(), **kwargs)
        except httpx.TimeoutException:
            raise AIError(
                "The AI provider timed out. Try again or increase AI_TIMEOUT_SECONDS.",
                status=504,
                code="ai_timeout",
            ) from None
        except httpx.RequestError:
            raise AIError(
                "The AI provider could not be reached.",
                status=502,
                code="ai_unreachable",
            ) from None

        if response.status_code in {401, 403}:
            raise AIError(
                "The AI provider rejected the configured credentials.",
                status=502,
                code="ai_auth_failed",
            )
        if response.status_code == 429:
            raise AIError(
                "The AI provider is rate-limiting requests. Try again shortly.",
                status=429,
                code="ai_provider_rate_limited",
            )
        if response.status_code >= 400:
            raise AIError(
                f"The AI provider returned an error (HTTP {response.status_code}).",
                status=502,
                code="ai_provider_error",
            )
        return response

    # --------------------------------------------------------------------- chat

    def chat_text(self, system: str, user: str) -> str:
        self._require_configured()
        payload = {
            "model": self.settings.ai_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": self.settings.ai_temperature,
            "max_tokens": self.settings.ai_max_output_tokens,
        }
        response = self._post("/chat/completions", json=payload)
        try:
            body = response.json()
            content = body["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise AIError(
                "The AI provider returned an unexpected chat response.",
                code="ai_invalid_response",
            ) from None
        if not isinstance(content, str) or not content.strip():
            raise AIError(
                "The AI provider returned an empty answer.",
                code="ai_invalid_response",
            )
        return content.strip()

    def chat_json(self, system: str, user: str) -> dict[str, Any]:
        self._require_configured()
        payload = {
            "model": self.settings.ai_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": self.settings.ai_temperature,
            "max_tokens": self.settings.ai_max_output_tokens,
        }
        response = self._post("/chat/completions", json=payload)
        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise AIError(
                "The AI provider returned an unexpected chat response.",
                code="ai_invalid_response",
            ) from None
        if not isinstance(content, str):
            raise AIError(
                "The AI provider returned an unexpected chat response.",
                code="ai_invalid_response",
            )
        return _extract_json(content)

    # ------------------------------------------------------------ speech (STT)

    def transcribe(self, data: bytes, filename: str, content_type: str) -> str:
        self._require_configured()
        if not data:
            raise AIError("The uploaded audio was empty.", status=400, code="invalid_audio")
        files = {"file": (filename or "audio.webm", data, content_type or "application/octet-stream")}
        form = {"model": self.settings.ai_stt_model}
        response = self._post("/audio/transcriptions", data=form, files=files)
        try:
            body = response.json()
            text = body.get("text")
        except ValueError:
            raise AIError(
                "The speech-to-text provider returned an unexpected response.",
                code="ai_invalid_response",
            ) from None
        if not isinstance(text, str) or not text.strip():
            raise AIError(
                "The speech-to-text provider returned no text.",
                code="ai_empty_transcript",
            )
        return text.strip()

    # ------------------------------------------------------------ speech (TTS)

    def speak(self, text: str, voice: str | None = None) -> tuple[bytes, str]:
        self._require_configured()
        payload = {
            "model": self.settings.ai_tts_model,
            "voice": voice or self.settings.ai_tts_voice,
            "input": text,
        }
        response = self._post("/audio/speech", json=payload)
        content_type = response.headers.get("Content-Type", "audio/mpeg")
        if not response.content:
            raise AIError(
                "The text-to-speech provider returned empty audio.",
                code="ai_invalid_response",
            )
        return response.content, content_type

    def close(self) -> None:
        self._client.close()
