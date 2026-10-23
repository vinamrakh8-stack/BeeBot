"""Application configuration.

All Bee credentials live here (server side only). `public_summary()` is the
redacted view handed to the browser.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_PROJECT_ROOT_ENV = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    # Read the repository-root .env first, then a backend/.env override if present,
    # so `python backend/app.py` and `cd backend && python app.py` behave the same.
    model_config = SettingsConfigDict(
        env_file=(str(_PROJECT_ROOT_ENV), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # application
    app_env: Literal["development", "production", "test"] = "development"
    secret_key: str = "insecure-development-key-change-me"
    cors_origins: str = "http://localhost:5173"
    session_cookie_name: str = "bee_session"
    session_ttl_hours: int = 24 * 7
    frontend_dist: str = "../frontend/dist"
    flask_host: str = "127.0.0.1"
    flask_port: int = 5000

    # database
    database_url: str = "sqlite:///./bee_voice.db"

    # dashboard operator
    app_username: str = "operator"
    app_password_hash: str = ""

    # Development-only demo account shown on the sign-in page. Never exposed
    # when APP_ENV=production.
    demo_login_enabled: bool = True
    demo_password: str = ""

    # Bee
    bee_api_mode: Literal["token", "proxy"] = "token"
    bee_api_base_url: str = "https://api.developer.bee.amazon.dev"
    bee_proxy_url: str = "http://127.0.0.1:8787"
    bee_token: SecretStr | None = None
    bee_timeout_seconds: float = 20.0
    bee_max_retries: int = 4
    bee_sync_page_size: int = Field(default=50, ge=1, le=100)
    bee_sync_max_pages: int = Field(default=40, ge=1, le=200)
    bee_allow_mock: bool = False

    # AI provider (OpenAI-compatible HTTP API). Keys are server-side only.
    ai_provider: Literal["disabled", "openai_compatible"] = "openai_compatible"
    ai_base_url: str = "https://api.openai.com/v1"
    ai_api_key: SecretStr | None = None
    ai_model: str = "gpt-4o-mini"
    ai_timeout_seconds: float = 45.0
    ai_max_output_tokens: int = Field(default=1200, ge=64, le=8000)
    ai_temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    ai_stt_model: str = "whisper-1"
    ai_tts_model: str = "tts-1"
    ai_tts_voice: str = "alloy"
    ai_rate_limit_per_minute: int = Field(default=20, ge=1, le=600)
    ai_max_context_sources: int = Field(default=8, ge=1, le=25)
    ai_max_audio_bytes: int = Field(default=10 * 1024 * 1024, ge=1024)

    # Wake word is configurable but has no bundled local engine. Continuous
    # cloud detection is intentionally not performed. See Phase 2 docs.
    wake_word_phrase: str = "Hey Bee"
    wake_word_engine: Literal["disabled", "browser_cloud"] = "disabled"

    # Mobile companion pairing. Tokens are opaque bearer credentials stored
    # hashed in the database; the raw token is shown once and kept in the
    # phone's OS secure storage.
    mobile_token_ttl_days: int = Field(default=90, ge=1, le=365)
    mobile_pair_rate_limit_per_minute: int = Field(default=5, ge=1, le=100)

    @field_validator("bee_api_base_url", "bee_proxy_url")
    @classmethod
    def _strip_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @model_validator(mode="after")
    def _no_mock_in_production(self) -> "Settings":
        if self.app_env == "production" and self.bee_allow_mock:
            raise ValueError("BEE_ALLOW_MOCK cannot be enabled when APP_ENV=production.")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def bee_base_url(self) -> str:
        return self.bee_proxy_url if self.bee_api_mode == "proxy" else self.bee_api_base_url

    @property
    def bee_token_value(self) -> str | None:
        if self.bee_api_mode != "token" or self.bee_token is None:
            return None
        return self.bee_token.get_secret_value().strip() or None

    @property
    def bee_configured(self) -> bool:
        return bool(self.bee_proxy_url) if self.bee_api_mode == "proxy" else bool(self.bee_token_value)

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def ai_api_key_value(self) -> str | None:
        if self.ai_api_key is None:
            return None
        return self.ai_api_key.get_secret_value().strip() or None

    @property
    def ai_configured(self) -> bool:
        if self.ai_provider == "disabled":
            return False
        if self.ai_api_key_value:
            return True
        # Local OpenAI-compatible servers (Ollama, LM Studio, llama.cpp) do not
        # require a key. Never treat the public OpenAI host as keyless.
        from urllib.parse import urlparse

        host = (urlparse(self.ai_base_url).hostname or "").lower()
        return host in {"localhost", "127.0.0.1", "::1"}

    def ai_public_summary(self) -> dict:
        return {
            "provider": self.ai_provider,
            "configured": self.ai_configured,
            "base_url": self.ai_base_url,
            "model": self.ai_model,
            "stt_model": self.ai_stt_model,
            "tts_model": self.ai_tts_model,
            "tts_voice": self.ai_tts_voice,
            "timeout_seconds": self.ai_timeout_seconds,
            "max_context_sources": self.ai_max_context_sources,
            "rate_limit_per_minute": self.ai_rate_limit_per_minute,
            "max_audio_bytes": self.ai_max_audio_bytes,
            "wake_word": {
                "phrase": self.wake_word_phrase,
                "engine": self.wake_word_engine,
                "available": self.wake_word_engine != "disabled",
                "local_engine_bundled": False,
            },
        }

    @property
    def frontend_dist_path(self) -> Path:
        path = Path(self.frontend_dist)
        if not path.is_absolute():
            path = Path(__file__).resolve().parent / path
        return path.resolve()

    def public_summary(self) -> dict:
        return {
            "mode": self.bee_api_mode,
            "base_url": self.bee_base_url,
            "configured": self.bee_configured,
            "allow_mock": self.bee_allow_mock,
            "timeout_seconds": self.bee_timeout_seconds,
            "max_retries": self.bee_max_retries,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
