"""Deterministic in-memory AI fake for tests. No network calls are made."""

from __future__ import annotations

from services.ai_client import AIError


class FakeAI:
    configured = True

    def __init__(self) -> None:
        self.text_response = "Grounded answer [S1]."
        self.json_response: dict = {}
        self.transcribe_response = "hello bee"
        self.speak_response = (b"ID3fake-mp3", "audio/mpeg")
        self.calls: list[tuple] = []
        self.fail_with: AIError | None = None

    def chat_text(self, system: str, user: str) -> str:
        self.calls.append(("chat_text", system, user))
        if self.fail_with is not None:
            raise self.fail_with
        return self.text_response

    def chat_json(self, system: str, user: str) -> dict:
        self.calls.append(("chat_json", system, user))
        if self.fail_with is not None:
            raise self.fail_with
        return self.json_response

    def transcribe(self, data: bytes, filename: str, content_type: str) -> str:
        self.calls.append(("transcribe", filename, content_type))
        if self.fail_with is not None:
            raise self.fail_with
        return self.transcribe_response

    def speak(self, text: str, voice: str | None = None):
        self.calls.append(("speak", text, voice))
        if self.fail_with is not None:
            raise self.fail_with
        return self.speak_response
