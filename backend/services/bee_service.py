"""Higher-level Bee operations used by the HTTP routes."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from api_utils import dump
from config import Settings
from services.bee_client import BeeClient
from services.bee_errors import BeeError
from services.sync_service import get_sync_status, is_running

_ALLOWED_PRIMITIVES = (str, int, float, bool, type(None))
_BLOCKED_KEYS = {"token", "access_token", "refresh_token", "secret", "password"}


def safe_account(payload: dict[str, Any]) -> dict[str, Any]:
    """Only primitive profile fields; never nested blobs or credentials."""
    safe: dict[str, Any] = {}
    for key, value in payload.items():
        if len(safe) >= 20:
            break
        if not isinstance(value, _ALLOWED_PRIMITIVES) or key.lower() in _BLOCKED_KEYS:
            continue
        if isinstance(value, str) and len(value) > 200:
            continue
        safe[key] = value
    return safe


def connection_status(
    db: Session,
    client: BeeClient,
    settings: Settings,
    owner_id: int,
    *,
    running: bool = False,
) -> dict[str, Any]:
    """A truthful connection report: unreachable is never shown as connected."""
    account: dict[str, Any] | None = None
    reachable = False
    error: str | None = None

    if not settings.bee_configured:
        error = (
            "Bee credentials are not configured on the server. Set BEE_TOKEN, or "
            "run `bee proxy` and set BEE_API_MODE=proxy."
        )
    else:
        try:
            account = safe_account(client.me())
            reachable = True
        except BeeError as exc:
            error = exc.message

    return {
        "configured": settings.bee_configured,
        "mode": settings.bee_api_mode,
        "base_url": settings.bee_base_url,
        "reachable": reachable,
        "account": account,
        "error": error,
        "sync": dump(get_sync_status(db, owner_id, running=running)),
    }


def status_is_running(lock) -> bool:
    return is_running(lock)


def search(
    client: BeeClient,
    query: str,
    *,
    mode: str,
    filter_by: str,
    sort_by: str,
    limit: int,
    since: int | None = None,
    until: int | None = None,
) -> dict[str, Any]:
    if mode == "neural":
        payload = client.neural_search(query, limit=limit, since=since, until=until)
        scope = "conversations"
    else:
        payload = client.search(
            query,
            limit=limit,
            filter_by=filter_by,
            sort_by=sort_by,
            since=since,
            until=until,
        )
        scope = filter_by

    raw_results = payload.get("results")
    results = (
        [item for item in raw_results if isinstance(item, dict)]
        if isinstance(raw_results, list)
        else []
    )
    total = payload.get("total")

    return {
        "query": query,
        "mode": mode,
        "filter": scope,
        "results": results,
        "total": total if isinstance(total, int) else None,
    }
