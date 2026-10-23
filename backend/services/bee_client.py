"""Bee developer API client.

Only endpoints documented at https://docs.bee.computer/docs/api are called.
Two documented transports are supported: a Bearer token against the public
endpoint, or a local ``bee proxy`` (no auth, local development only). Raw TLS
with attestation is documented but intentionally not implemented here.
"""

from __future__ import annotations

import json
import random
import time
from dataclasses import dataclass, field
from typing import Any, Iterator

import httpx

from config import Settings
from services.bee_errors import (
    BeeAuthError,
    BeeCapabilityError,
    BeeCursorTooOld,
    BeeError,
    BeeNotFound,
    BeeNotConfigured,
    BeeRateLimit,
    BeeUnavailable,
)

RETRYABLE_STATUS = {425, 429, 500, 502, 503, 504}
MAX_ERROR_SNIPPET = 300


@dataclass
class Page:
    items: list[dict] = field(default_factory=list)
    next_cursor: str | None = None
    timezone: str | None = None


@dataclass
class Paged:
    items: list[dict] = field(default_factory=list)
    next_cursor: str | None = None
    timezone: str | None = None
    truncated: bool = False


def _safe_payload(response: httpx.Response) -> dict:
    try:
        body = response.json()
    except (json.JSONDecodeError, ValueError):
        return {}
    return body if isinstance(body, dict) else {}


class BeeClient:
    def __init__(self, settings: Settings, *, transport: httpx.BaseTransport | None = None) -> None:
        self.settings = settings
        headers = {"Accept": "application/json", "User-Agent": "bee-voice-plus/0.1"}
        token = settings.bee_token_value
        if token:
            headers["Authorization"] = f"Bearer {token}"

        timeout = httpx.Timeout(settings.bee_timeout_seconds, connect=min(5.0, settings.bee_timeout_seconds))
        self._client = httpx.Client(
            base_url=settings.bee_base_url,
            headers=headers,
            timeout=timeout,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    @property
    def auth_headers(self) -> dict[str, str]:
        return dict(self._client.headers)

    def ensure_configured(self) -> None:
        if not self.settings.bee_configured:
            raise BeeNotConfigured(
                "Bee is not configured. Set BEE_TOKEN (token mode) or start "
                "`bee proxy` and set BEE_API_MODE=proxy."
            )

    def _sleep(self, attempt: int, response: httpx.Response | None) -> None:
        delay = min(0.5 * (2**attempt), 8.0) + random.uniform(0, 0.25)
        if response is not None:
            retry_after = response.headers.get("retry-after")
            if retry_after:
                try:
                    delay = max(delay, min(float(retry_after), 30.0))
                except ValueError:
                    pass
        time.sleep(delay)

    @staticmethod
    def _error_message(response: httpx.Response) -> str:
        payload = _safe_payload(response)
        for key in ("message", "error", "detail"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:MAX_ERROR_SNIPPET]
        return (response.text or "").strip()[:MAX_ERROR_SNIPPET] or f"HTTP {response.status_code}"

    def _raise_for_auth(self, response: httpx.Response) -> None:
        payload = _safe_payload(response)
        if payload.get("error") == "test_user_required":
            raise BeeCapabilityError(
                "This Bee endpoint is limited to Bee test users; the connected "
                "account is not enrolled.",
                upstream_status=response.status_code,
            )
        if response.status_code == 401:
            raise BeeAuthError(
                "Bee rejected the stored credentials. Re-authenticate the server "
                "(re-run `bee login` and refresh BEE_TOKEN, or restart `bee proxy`).",
                upstream_status=401,
            )
        raise BeeAuthError(
            f"Bee denied access to this resource: {self._error_message(response)}",
            upstream_status=response.status_code,
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        self.ensure_configured()
        attempts = 0
        max_retries = max(0, self.settings.bee_max_retries)

        while True:
            try:
                response = self._client.request(method, path, params=params, json=json_body)
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                if attempts >= max_retries:
                    raise BeeUnavailable(
                        f"Could not reach Bee at {self.settings.bee_base_url}: {type(exc).__name__}."
                    ) from exc
                self._sleep(attempts, None)
                attempts += 1
                continue

            status = response.status_code

            if status in (401, 403):
                self._raise_for_auth(response)
            if status == 404:
                raise BeeNotFound(
                    f"Bee resource not found: {self._error_message(response)}",
                    upstream_status=404,
                )
            if status == 400 and _safe_payload(response).get("error") == "cursor_too_old":
                raise BeeCursorTooOld(
                    "The sync cursor is older than Bee's 7-day window; a full re-sync is required.",
                    upstream_status=400,
                )
            if status in RETRYABLE_STATUS and attempts < max_retries:
                self._sleep(attempts, response)
                attempts += 1
                continue
            if status == 429:
                raise BeeRateLimit(
                    "Bee rate-limited this request after retries. Try again later.",
                    upstream_status=429,
                )
            if status >= 500:
                raise BeeUnavailable(
                    f"Bee returned {status} after retries: {self._error_message(response)}",
                    upstream_status=status,
                )
            if status >= 400:
                raise BeeError(
                    f"Bee rejected the request ({status}): {self._error_message(response)}",
                    upstream_status=status,
                )

            try:
                return response.json()
            except (json.JSONDecodeError, ValueError) as exc:
                raise BeeError("Bee returned a response that was not valid JSON.") from exc

    # ------------------------------------------------------------ documented API

    def me(self) -> dict:
        payload = self._request("GET", "/v1/me")
        return payload if isinstance(payload, dict) else {}

    def changes(self, cursor: str | None = None) -> dict:
        payload = self._request("GET", "/v1/changes", params={"cursor": cursor} if cursor else None)
        return payload if isinstance(payload, dict) else {}

    def page(
        self,
        path: str,
        key: str,
        *,
        limit: int | None = None,
        cursor: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> Page:
        params: dict[str, Any] = dict(extra or {})
        if limit is not None:
            params["limit"] = limit
        if cursor:
            params["cursor"] = cursor
        payload = self._request("GET", path, params=params or None)
        if not isinstance(payload, dict):
            raise BeeError("Bee returned an unexpected list payload.")
        items = payload.get(key)
        next_cursor = payload.get("next_cursor")
        timezone_name = payload.get("timezone")
        return Page(
            items=[i for i in items if isinstance(i, dict)] if isinstance(items, list) else [],
            next_cursor=next_cursor if isinstance(next_cursor, str) and next_cursor else None,
            timezone=timezone_name if isinstance(timezone_name, str) else None,
        )

    def paginate(
        self,
        path: str,
        key: str,
        *,
        cursor: str | None = None,
        page_size: int | None = None,
        max_pages: int | None = None,
        extra: dict[str, Any] | None = None,
    ) -> Paged:
        page_size = page_size or self.settings.bee_sync_page_size
        max_pages = max_pages or self.settings.bee_sync_max_pages
        items: list[dict] = []
        next_cursor = cursor
        timezone_name: str | None = None
        truncated = False

        for page_index in range(max_pages):
            page = self.page(path, key, limit=page_size, cursor=next_cursor, extra=extra)
            if page_index == 0:
                timezone_name = page.timezone
            items.extend(page.items)
            next_cursor = page.next_cursor
            if not next_cursor:
                break
        else:
            truncated = bool(next_cursor)

        return Paged(items=items, next_cursor=next_cursor, timezone=timezone_name, truncated=truncated)

    def iter_pages(
        self,
        path: str,
        key: str,
        *,
        page_size: int | None = None,
        max_pages: int | None = None,
        extra: dict[str, Any] | None = None,
    ) -> Iterator[Page]:
        page_size = page_size or self.settings.bee_sync_page_size
        max_pages = max_pages or self.settings.bee_sync_max_pages
        cursor: str | None = None
        for _ in range(max_pages):
            page = self.page(path, key, limit=page_size, cursor=cursor, extra=extra)
            yield page
            cursor = page.next_cursor
            if not cursor:
                return

    def conversation(self, bee_id: int) -> dict:
        payload = self._request("GET", f"/v1/conversations/{bee_id}")
        if isinstance(payload, dict) and isinstance(payload.get("conversation"), dict):
            return payload["conversation"]
        return payload if isinstance(payload, dict) else {}

    def daily_summary(self, bee_id: int) -> dict:
        payload = self._request("GET", f"/v1/daily/{bee_id}")
        if isinstance(payload, dict) and isinstance(payload.get("daily_summary"), dict):
            return payload["daily_summary"]
        return payload if isinstance(payload, dict) else {}

    def fact(self, bee_id: int) -> dict:
        payload = self._request("GET", f"/v1/facts/{bee_id}")
        if isinstance(payload, dict) and isinstance(payload.get("fact"), dict):
            return payload["fact"]
        return payload if isinstance(payload, dict) else {}

    def todo(self, bee_id: int) -> dict:
        payload = self._request("GET", f"/v1/todos/{bee_id}")
        if isinstance(payload, dict) and isinstance(payload.get("todo"), dict):
            return payload["todo"]
        return payload if isinstance(payload, dict) else {}

    def update_todo_completed(self, bee_id: int, completed: bool) -> dict:
        payload = self._request("PUT", f"/v1/todos/{bee_id}", json_body={"completed": completed})
        if isinstance(payload, dict) and isinstance(payload.get("todo"), dict):
            return payload["todo"]
        return payload if isinstance(payload, dict) else {}

    def search(
        self,
        query: str,
        *,
        limit: int = 20,
        filter_by: str = "all",
        sort_by: str = "relevance",
        since: int | None = None,
        until: int | None = None,
    ) -> dict:
        body: dict[str, Any] = {"query": query, "limit": limit, "filter": filter_by, "sortBy": sort_by}
        if since is not None:
            body["since"] = since
        if until is not None:
            body["until"] = until
        payload = self._request("POST", "/v1/search/conversations", json_body=body)
        return payload if isinstance(payload, dict) else {}

    def neural_search(
        self,
        query: str,
        *,
        limit: int | None = 20,
        since: int | None = None,
        until: int | None = None,
    ) -> dict:
        body: dict[str, Any] = {"query": query}
        if limit is not None:
            body["limit"] = limit
        if since is not None:
            body["since"] = since
        if until is not None:
            body["until"] = until
        payload = self._request("POST", "/v1/search/conversations/neural", json_body=body)
        return payload if isinstance(payload, dict) else {}

    def stream_url(self) -> str:
        return f"{self.settings.bee_base_url}/v1/stream"
