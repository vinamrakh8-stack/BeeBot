"""Real-time updates.

Bee documents an SSE stream at ``GET /v1/stream``. This route forwards it; the
dashboard treats an event as a hint to refetch, so a dropped connection
degrades gracefully (EventSource reconnects on its own).

Bee's stream does not authenticate via query string. The browser authenticates
to this app with its session cookie; the server attaches the Bee credentials.
"""

from __future__ import annotations

import json

import httpx
from flask import Blueprint, Response, request

from api_utils import ApiError
from security import get_settings, login_required

bp = Blueprint("stream", __name__, url_prefix="/api/stream")


def _sse_error(message: str, status: int | None = None) -> str:
    payload: dict = {"message": message}
    if status is not None:
        payload["status"] = status
    return f"event: error\ndata: {json.dumps(payload)}\n\n"


@bp.get("")
@bp.get("/")
@login_required
def stream():
    settings = get_settings()
    if not settings.bee_configured:
        raise ApiError(
            "Bee is not configured on the server.",
            status=503,
            code="bee_not_configured",
        )

    types = request.args.get("types")
    headers = {"Accept": "text/event-stream", "Cache-Control": "no-cache"}
    token = settings.bee_token_value
    if token:
        headers["Authorization"] = f"Bearer {token}"

    url = f"{settings.bee_base_url}/v1/stream"
    params = {"types": types} if types else None

    def generate():
        timeout = httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0)
        try:
            with httpx.Client(timeout=timeout) as client:
                with client.stream("GET", url, headers=headers, params=params) as upstream:
                    if upstream.status_code >= 400:
                        yield _sse_error(
                            "Bee refused the event stream.", upstream.status_code
                        )
                        return
                    for line in upstream.iter_lines():
                        yield line + "\n"
        except httpx.HTTPError as exc:
            yield _sse_error(f"Event stream ended: {type(exc).__name__}")

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
