"""Shared helpers for Flask routes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from flask import request

from pydantic import BaseModel


class ApiError(Exception):
    """A client-facing 4xx with a stable error code."""

    def __init__(
        self,
        message: str,
        status: int = 400,
        code: str = "bad_request",
        *,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.headers = headers or {}

    def as_dict(self) -> dict:
        return {"error": self.code, "message": self.message}


def json_body() -> dict:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ApiError("Expected a JSON object request body.")
    return payload


def int_arg(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = request.args.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ApiError(f"`{name}` must be an integer.", code="invalid_parameter") from None
    if value < minimum or value > maximum:
        raise ApiError(
            f"`{name}` must be between {minimum} and {maximum}.",
            code="invalid_parameter",
        )
    return value


def pagination() -> tuple[int, int]:
    limit = int_arg("limit", 25, minimum=1, maximum=100)
    offset = int_arg("offset", 0, minimum=0, maximum=1_000_000)
    return limit, offset


def dump(model: BaseModel) -> dict[str, Any]:
    """Serialise a response model, applying its UTC/date serialisers."""
    return model.model_dump(mode="json")


def provenance(body: dict) -> tuple[str, bool]:
    """Resolve local provenance for a created memory or task.

    Client-supplied records may only be ``user`` (typed/edited by the operator)
    or ``ai`` (an accepted extraction candidate). ``bee`` rows are created by
    sync only, so claiming it here would misrepresent the data.
    """
    origin = body.get("origin", "user")
    if origin not in {"user", "ai"}:
        raise ApiError("`origin` must be `user` or `ai`.", code="invalid_parameter")

    ai_generated = body.get("ai_generated", origin == "ai")
    if not isinstance(ai_generated, bool):
        raise ApiError("`ai_generated` must be a boolean.", code="invalid_parameter")

    if origin == "ai":
        ai_generated = True
    elif ai_generated:
        origin = "ai"
    return origin, ai_generated


def parse_datetime(value: Any, field: str) -> Any:
    """Parse an optional ISO-8601 datetime into naive UTC.

    Accepts a trailing ``Z`` and offsets. Returns ``None`` for blank input.
    """
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ApiError(f"`{field}` must be an ISO-8601 datetime string.", code="invalid_parameter")
    raw = value.strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise ApiError(
            f"`{field}` must be an ISO-8601 datetime string.", code="invalid_parameter"
        ) from None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def path_int(value: str, field: str = "id") -> int:
    """Parse a signed integer path segment (local records use negative ids)."""
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ApiError(
            f"`{field}` must be an integer.", status=404, code="not_found"
        ) from None


def page_payload(items: list[BaseModel] | list[dict], total: int, limit: int, offset: int) -> dict:
    return {
        "items": [item if isinstance(item, dict) else dump(item) for item in items],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(items) < total,
    }
