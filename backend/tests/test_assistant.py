from __future__ import annotations

import io

from pydantic import SecretStr

from services.ai_client import AIClient, AIError
from services.rate_limit import RateLimiter


def test_assistant_status_reports_provider_and_wake_word(auth_client):
    body = auth_client.get("/api/assistant/status").get_json()
    assert body["provider"] == "openai_compatible"
    assert body["configured"] is False
    assert body["wake_word"]["available"] is False
    assert body["retrieval"]["embeddings"] is False


def test_chat_without_context_asks_for_clarification(auth_client, fake_ai):
    response = auth_client.post(
        "/api/assistant/chat", json={"message": "What did I say about quantum bananas?"}
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["clarification_needed"] is True
    assert body["grounded"] is False
    assert body["sources"] == []
    assert fake_ai.calls == []


def test_chat_is_grounded_and_returns_sources(auth_client, fake, run_sync, fake_ai):
    fake.add_conversation(1, "Roadmap planning for Q3")
    assert run_sync(full=True).status == "success"
    fake_ai.text_response = "You discussed the Q3 roadmap [S1]."

    response = auth_client.post(
        "/api/assistant/chat", json={"message": "What did we discuss about the roadmap?"}
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["grounded"] is True
    assert body["sources"][0]["kind"] == "conversation"
    assert body["sources"][0]["route"].startswith("/conversations/")
    assert "Roadmap planning" in fake_ai.calls[0][2]


def test_chat_surfaces_provider_failure(auth_client, fake, run_sync, fake_ai):
    fake.add_conversation(1, "Roadmap planning")
    assert run_sync(full=True).status == "success"
    fake_ai.fail_with = AIError("Provider down", status=502, code="ai_unreachable")

    response = auth_client.post(
        "/api/assistant/chat", json={"message": "roadmap plans"}
    )
    assert response.status_code == 502
    assert response.get_json()["error"] == "ai_unreachable"


def test_chat_without_configured_provider_fails_honestly(app, auth_client, fake, run_sync, settings):
    fake.add_conversation(1, "Roadmap planning")
    assert run_sync(full=True).status == "success"
    app.extensions["ai_client"] = AIClient(settings)

    response = auth_client.post("/api/assistant/chat", json={"message": "roadmap plans"})
    assert response.status_code == 503
    assert response.get_json()["error"] == "ai_not_configured"


def test_ai_rate_limit(app, auth_client, fake, run_sync, fake_ai):
    fake.add_conversation(1, "Roadmap planning")
    assert run_sync(full=True).status == "success"
    app.extensions["ai_limiter"] = RateLimiter(1)

    first = auth_client.post("/api/assistant/chat", json={"message": "roadmap"})
    second = auth_client.post("/api/assistant/chat", json={"message": "roadmap"})
    assert first.status_code == 200
    assert second.status_code == 429
    assert second.headers["Retry-After"]


def test_transcribe_uses_configured_provider(auth_client, fake_ai):
    response = auth_client.post(
        "/api/assistant/transcribe",
        data={"audio": (io.BytesIO(b"fake-audio"), "clip.webm", "audio/webm")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 200
    assert response.get_json()["text"] == "hello bee"
    assert response.get_json()["model"] == "whisper-1"


def test_transcribe_requires_audio(auth_client):
    response = auth_client.post("/api/assistant/transcribe", data={})
    assert response.status_code in {400, 415}


def test_speak_returns_audio_from_provider(auth_client, fake_ai):
    response = auth_client.post("/api/assistant/speak", json={"text": "Hello"})
    assert response.status_code == 200
    assert response.mimetype == "audio/mpeg"
    assert response.data == b"ID3fake-mp3"
    assert response.headers["Cache-Control"] == "no-store"


def test_speak_validates_text(auth_client):
    assert auth_client.post("/api/assistant/speak", json={"text": ""}).status_code == 400
