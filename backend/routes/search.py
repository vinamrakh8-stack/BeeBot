"""Server-side search across Bee data.

Keyword mode uses Bee's BM25 index and can scope to conversations, daily
summaries or facts. Neural mode is conversation-only, as documented.
"""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from api_utils import ApiError, int_arg
from security import get_client, login_required
from services import bee_service

bp = Blueprint("search", __name__, url_prefix="/api/search")

FILTERS = {"all", "conversations", "daily", "facts"}
SORTS = {"relevance", "mostRecent"}
MODES = {"keyword", "neural"}


@bp.get("")
@bp.get("/")
@login_required
def search():
    query = (request.args.get("q") or "").strip()
    if not query:
        raise ApiError("Provide a search query with `q`.", code="invalid_parameter")
    if len(query) > 500:
        raise ApiError("Search queries are limited to 500 characters.", code="invalid_parameter")

    mode = request.args.get("mode", "keyword")
    filter_by = request.args.get("filter", "all")
    sort_by = request.args.get("sort", "relevance")
    if mode not in MODES:
        raise ApiError("`mode` must be keyword or neural.", code="invalid_parameter")
    if filter_by not in FILTERS:
        raise ApiError(
            "`filter` must be all, conversations, daily or facts.", code="invalid_parameter"
        )
    if sort_by not in SORTS:
        raise ApiError("`sort` must be relevance or mostRecent.", code="invalid_parameter")

    since = int_arg("since", 0, minimum=0, maximum=2**53) or None
    until = int_arg("until", 0, minimum=0, maximum=2**53) or None

    payload = bee_service.search(
        get_client(),
        query,
        mode=mode,
        filter_by=filter_by,
        sort_by=sort_by,
        limit=int_arg("limit", 20, minimum=1, maximum=100),
        since=since,
        until=until,
    )
    return jsonify(payload)
