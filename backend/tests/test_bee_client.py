from __future__ import annotations

import json

import httpx
import pytest

from services.bee_client import BeeClient
from services.bee_errors import (
    BeeAuthError,
    BeeCapabilityError,
    BeeCursorTooOld,
    BeeNotFound,
    BeeRateLimit,
    BeeUnavailable,
)


def make_client(settings, handler) -> BeeClient:
    return BeeClient(settings, transport=httpx.MockTransport(handler))


def test_maps_401_to_auth_error(settings):
    client = make_client(settings, lambda request: httpx.Response(401, json={"error": "unauthorized"}))
    with pytest.raises(BeeAuthError):
        client.me()


def test_maps_test_user_required_to_capability_error(settings):
    client = make_client(
        settings, lambda request: httpx.Response(403, json={"error": "test_user_required"})
    )
    with pytest.raises(BeeCapabilityError) as excinfo:
        client.changes(None)
    assert "test users" in excinfo.value.message


def test_maps_404(settings):
    client = make_client(settings, lambda request: httpx.Response(404, json={"error": "not_found"}))
    with pytest.raises(BeeNotFound):
        client.conversation(1)


def test_maps_cursor_too_old(settings):
    client = make_client(
        settings, lambda request: httpx.Response(400, json={"error": "cursor_too_old"})
    )
    with pytest.raises(BeeCursorTooOld):
        client.changes("stale")


def test_retries_then_reports_unavailable(settings, monkeypatch):
    monkeypatch.setattr("services.bee_client.time.sleep", lambda *args, **kwargs: None)
    calls = {"count": 0}

    def handler(request):
        calls["count"] += 1
        return httpx.Response(503, json={"error": "down"})

    with pytest.raises(BeeUnavailable):
        make_client(settings, handler).me()

    assert calls["count"] == settings.bee_max_retries + 1


def test_rate_limit_exhaustion_raises_rate_limit_error(settings, monkeypatch):
    monkeypatch.setattr("services.bee_client.time.sleep", lambda *args, **kwargs: None)
    client = make_client(
        settings, lambda request: httpx.Response(429, headers={"retry-after": "0"}, json={})
    )
    with pytest.raises(BeeRateLimit):
        client.me()


def test_paginate_follows_next_cursor(settings):
    seen: list[str | None] = []

    def handler(request):
        cursor = request.url.params.get("cursor")
        seen.append(cursor)
        if cursor is None:
            return httpx.Response(200, json={"facts": [{"id": 1}], "next_cursor": "p2"})
        return httpx.Response(200, json={"facts": [{"id": 2}], "next_cursor": None})

    page = make_client(settings, handler).paginate("/v1/facts", "facts")
    assert [item["id"] for item in page.items] == [1, 2]
    assert seen == [None, "p2"]
    assert page.truncated is False


def test_search_sends_documented_body(settings):
    captured: dict = {}

    def handler(request):
        captured.update(json.loads(request.content))
        return httpx.Response(200, json={"results": [], "total": 0})

    make_client(settings, handler).search(
        "roadmap", limit=7, filter_by="facts", sort_by="mostRecent"
    )
    assert captured["query"] == "roadmap"
    assert captured["limit"] == 7
    assert captured["filter"] == "facts"
    assert captured["sortBy"] == "mostRecent"
