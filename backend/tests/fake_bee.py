"""In-memory stand-in for Bee's documented /v1 API, used only by tests.

Mirrors the wire shapes documented at docs.bee.computer/docs/api and the Bee
CLI's parsers: list envelopes are ``{<key>, next_cursor, timezone}`` and
timestamps are epoch milliseconds.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

START_MS = 1_770_000_000_000  # 2026-02-02T02:40:00Z

# The real list endpoint returns a projection, not the full conversation.
CONVERSATION_LIST_FIELDS = ("id", "start_time", "end_time", "created_at", "summary", "state")


def conversation_summary(record: dict) -> dict:
    return {field: record.get(field) for field in CONVERSATION_LIST_FIELDS}


def _page(items: list[dict], request: httpx.Request) -> tuple[list[dict], str | None]:
    params = request.url.params
    try:
        limit = max(1, int(params.get("limit", "50")))
    except ValueError:
        limit = 50
    cursor = params.get("cursor")
    start = int(cursor) if cursor and cursor.isdigit() else 0
    page = items[start : start + limit]
    next_cursor = str(start + limit) if start + limit < len(items) else None
    return page, next_cursor


class FakeBee:
    def __init__(self) -> None:
        self.conversations: dict[int, dict[str, Any]] = {}
        self.daily: dict[int, dict[str, Any]] = {}
        self.facts: dict[int, dict[str, Any]] = {}
        self.todos: dict[int, dict[str, Any]] = {}

        self.changes_payload: dict[str, Any] = {
            "facts": [],
            "todos": [],
            "dailies": [],
            "conversations": [],
            "journals": [],
            "insights": [],
        }
        self.queued_failures: list[dict[str, Any]] = []
        self.requests: list[httpx.Request] = []
        self.changes_cursors: list[str | None] = []
        self.todo_updates: list[tuple[int, dict[str, Any]]] = []

    # ------------------------------------------------------------------ seeding

    def add_conversation(
        self,
        bee_id: int,
        summary: str = "A conversation",
        *,
        short_summary: str | None = None,
        start_offset: int = 0,
        state: str = "processed",
    ) -> dict[str, Any]:
        record = {
            "id": bee_id,
            "uuid": f"uuid-{bee_id}",
            "start_time": START_MS + start_offset,
            "end_time": START_MS + start_offset + 600_000,
            "device_type": "ios",
            "state": state,
            "created_at": START_MS + start_offset,
            "updated_at": START_MS + start_offset,
            "summary": summary,
            "short_summary": short_summary or summary,
            "primary_location": {
                "address": "1 Test Street",
                "latitude": 37.77,
                "longitude": -122.42,
                "created_at": START_MS,
            },
            "suggested_links": [{"url": "https://example.com/ref", "created_at": START_MS}],
            "transcriptions": [
                {
                    "id": bee_id * 10,
                    "realtime": False,
                    "utterances": [
                        {
                            "id": bee_id * 100,
                            "realtime": False,
                            "start": START_MS + start_offset,
                            "end": START_MS + start_offset + 1_000,
                            "spoken_at": START_MS + start_offset,
                            "text": "Hello there",
                            "speaker": "speaker_1",
                            "created_at": START_MS + start_offset,
                        }
                    ],
                }
            ],
        }
        self.conversations[bee_id] = record
        return record

    def add_daily(self, bee_id: int, day: str, summary: str = "A day") -> dict[str, Any]:
        record = {
            "id": bee_id,
            "date": day,
            "date_time": START_MS,
            "short_summary": summary,
            "summary": f"{summary} — detail",
            "email_summary": None,
            "calendar_summary": None,
            "conversations_count": 2,
            "locations": [
                {"id": 1, "address": "1 Test Street", "latitude": 37.77, "longitude": -122.42}
            ],
            "created_at": START_MS,
        }
        self.daily[bee_id] = record
        return record

    def add_fact(self, bee_id: int, text: str, *, confirmed: bool = True) -> dict[str, Any]:
        record = {
            "id": bee_id,
            "text": text,
            "tags": ["test"],
            "created_at": START_MS,
            "confirmed": confirmed,
        }
        self.facts[bee_id] = record
        return record

    def add_todo(self, bee_id: int, text: str, *, completed: bool = False) -> dict[str, Any]:
        record = {
            "id": bee_id,
            "text": text,
            "completed": completed,
            "alarm_at": None,
            "created_at": START_MS,
        }
        self.todos[bee_id] = record
        return record

    def fail_next(self, path_prefix: str, status: int, times: int = 1) -> None:
        self.queued_failures.append({"prefix": path_prefix, "status": status, "times": times})

    # ---------------------------------------------------------------- transport

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path

        for failure in self.queued_failures:
            if failure["times"] > 0 and path.startswith(failure["prefix"]):
                failure["times"] -= 1
                return httpx.Response(failure["status"], json={"error": "injected_failure"})

        if path == "/v1/me" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "id": 7,
                    "name": "Test Operator",
                    "email": "operator@example.com",
                    "timezone": "UTC",
                },
            )

        if path == "/v1/changes" and request.method == "GET":
            cursor = request.url.params.get("cursor")
            self.changes_cursors.append(cursor)
            if cursor == "old-cursor":
                return httpx.Response(400, json={"error": "cursor_too_old"})
            payload = dict(self.changes_payload)
            payload["next_cursor"] = f"cur-{len(self.changes_cursors)}"
            return httpx.Response(200, json=payload)

        if path == "/v1/conversations" and request.method == "GET":
            items = [
                conversation_summary(record)
                for record in sorted(
                    self.conversations.values(), key=lambda item: item["id"], reverse=True
                )
            ]
            page, next_cursor = _page(items, request)
            return httpx.Response(
                200,
                json={"conversations": page, "next_cursor": next_cursor, "timezone": "UTC"},
            )

        if path.startswith("/v1/conversations/") and request.method == "GET":
            bee_id = int(path.rsplit("/", 1)[1])
            record = self.conversations.get(bee_id)
            if record is None:
                return httpx.Response(404, json={"error": "not_found"})
            return httpx.Response(200, json={"conversation": record, "timezone": "UTC"})

        if path == "/v1/daily" and request.method == "GET":
            items = sorted(self.daily.values(), key=lambda item: item["date"], reverse=True)
            page, next_cursor = _page(items, request)
            return httpx.Response(
                200,
                json={"daily_summaries": page, "next_cursor": next_cursor, "timezone": "UTC"},
            )

        if path.startswith("/v1/daily/") and request.method == "GET":
            bee_id = int(path.rsplit("/", 1)[1])
            record = self.daily.get(bee_id)
            if record is None:
                return httpx.Response(404, json={"error": "not_found"})
            return httpx.Response(200, json={"daily_summary": record, "timezone": "UTC"})

        if path == "/v1/facts" and request.method == "GET":
            confirmed = request.url.params.get("confirmed")
            items = list(self.facts.values())
            if confirmed == "true":
                items = [item for item in items if item["confirmed"]]
            elif confirmed == "false":
                items = [item for item in items if not item["confirmed"]]
            items.sort(key=lambda item: item["id"], reverse=True)
            page, next_cursor = _page(items, request)
            return httpx.Response(
                200, json={"facts": page, "next_cursor": next_cursor, "timezone": "UTC"}
            )

        if path.startswith("/v1/facts/") and request.method == "GET":
            bee_id = int(path.rsplit("/", 1)[1])
            record = self.facts.get(bee_id)
            if record is None:
                return httpx.Response(404, json={"error": "not_found"})
            return httpx.Response(200, json={"fact": record, "timezone": "UTC"})

        if path == "/v1/todos" and request.method == "GET":
            items = sorted(self.todos.values(), key=lambda item: item["id"], reverse=True)
            page, next_cursor = _page(items, request)
            return httpx.Response(
                200, json={"todos": page, "next_cursor": next_cursor, "timezone": "UTC"}
            )

        if path.startswith("/v1/todos/") and request.method in {"GET", "PUT"}:
            bee_id = int(path.rsplit("/", 1)[1])
            record = self.todos.get(bee_id)
            if record is None:
                return httpx.Response(404, json={"error": "not_found"})
            if request.method == "PUT":
                body = json.loads(request.content or b"{}")
                self.todo_updates.append((bee_id, body))
                if "completed" in body:
                    record["completed"] = bool(body["completed"])
                if "text" in body:
                    record["text"] = body["text"]
            return httpx.Response(200, json={"todo": record, "timezone": "UTC"})

        if path == "/v1/search/conversations" and request.method == "POST":
            body = json.loads(request.content or b"{}")
            query = str(body.get("query", "")).lower()
            results = [
                {
                    "id": record["id"],
                    "start_time": record["start_time"],
                    "summary": record["summary"],
                    "short_summary": record["short_summary"],
                }
                for record in self.conversations.values()
                if query in str(record.get("summary", "")).lower()
            ]
            return httpx.Response(200, json={"results": results, "total": len(results)})

        if path == "/v1/search/conversations/neural" and request.method == "POST":
            body = json.loads(request.content or b"{}")
            query = str(body.get("query", "")).lower()
            results = [
                {"id": record["id"], "summary": record["summary"]}
                for record in self.conversations.values()
                if query in str(record.get("summary", "")).lower()
            ]
            return httpx.Response(200, json={"results": results, "total": len(results)})

        return httpx.Response(404, json={"error": "unknown_path", "path": path})
