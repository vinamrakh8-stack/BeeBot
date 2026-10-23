"""Typed errors for the Bee integration.

Each error carries the HTTP status our own API should return, so routes never
leak raw upstream payloads to the browser.
"""

from __future__ import annotations


class BeeError(Exception):
    code = "bee_error"
    status_code = 502

    def __init__(self, message: str, *, upstream_status: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.upstream_status = upstream_status

    def as_dict(self) -> dict:
        return {
            "error": self.code,
            "message": self.message,
            "upstream_status": self.upstream_status,
        }


class BeeAuthError(BeeError):
    code = "bee_auth_failed"
    status_code = 401


class BeeCapabilityError(BeeError):
    code = "bee_capability_unavailable"
    status_code = 403


class BeeNotFound(BeeError):
    code = "bee_not_found"
    status_code = 404


class BeeRateLimit(BeeError):
    code = "bee_rate_limited"
    status_code = 429


class BeeUnavailable(BeeError):
    code = "bee_unavailable"
    status_code = 503


class BeeCursorTooOld(BeeError):
    code = "cursor_too_old"
    status_code = 409


class BeeNotConfigured(BeeError):
    code = "bee_not_configured"
    status_code = 503
