"""Local/global search over stored records (no Bee token required)."""

from __future__ import annotations

from flask import Blueprint, g, jsonify, request

from api_utils import ApiError, int_arg
from security import get_db, login_required
from services.context_service import KINDS, retrieve

bp = Blueprint("local_search", __name__, url_prefix="/api/search/local")


@bp.get("")
@bp.get("/")
@login_required
def local_search():
    query = (request.args.get("q") or "").strip()
    if not query:
        raise ApiError("Provide a search query with `q`.", code="invalid_parameter")
    if len(query) > 500:
        raise ApiError("Search queries are limited to 500 characters.", code="invalid_parameter")
    limit = int_arg("limit", 25, minimum=1, maximum=50)

    raw_types = request.args.get("types", "")
    kinds = None
    if raw_types:
        requested = {item.strip() for item in raw_types.split(",") if item.strip()}
        unknown = requested - KINDS
        if unknown:
            raise ApiError(
                f"Unsupported search type(s): {', '.join(sorted(unknown))}.",
                code="invalid_parameter",
            )
        kinds = requested

    results = retrieve(get_db(), g.current_user.id, query, limit=limit, kinds=kinds)
    return jsonify(
        {
            "mode": "local",
            "query": query,
            "items": [source.as_dict() for source in results],
            "note": (
                "Local search reads only records already stored for this account. "
                "It searches summaries, memories, tasks, meetings, and learning notes; "
                "it does not use embeddings in this configuration."
            ),
        }
    )
