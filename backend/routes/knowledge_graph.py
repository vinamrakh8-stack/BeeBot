"""Knowledge graph API."""

from __future__ import annotations

import re

from flask import Blueprint, g, jsonify, request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from api_utils import ApiError, dump, int_arg, json_body
from models import KnowledgeEdge, utcnow
from schemas import GraphEdgeOut, GraphOut
from security import get_db, login_required
from services.graph_service import ALLOWED_TYPES, build_graph, filter_graph, validate_ref

bp = Blueprint("knowledge_graph", __name__, url_prefix="/api/knowledge-graph")


@bp.get("")
@bp.get("/")
@login_required
def get_graph():
    raw_types = request.args.get("types", "")
    types = None
    if raw_types:
        requested = {item.strip() for item in raw_types.split(",") if item.strip()}
        unknown = requested - ALLOWED_TYPES
        if unknown:
            raise ApiError(
                f"Unsupported graph type(s): {', '.join(sorted(unknown))}.",
                code="invalid_parameter",
            )
        types = requested
    query = request.args.get("q", "").strip()
    if len(query) > 200:
        raise ApiError("`q` is limited to 200 characters.", code="invalid_parameter")
    int_arg("limit", 400, minimum=1, maximum=1000)  # validates the parameter

    nodes, edges = build_graph(get_db(), g.current_user.id)
    nodes, edges = filter_graph(nodes, edges, query=query, types=types)
    return jsonify(
        dump(
            GraphOut(
                nodes=nodes,
                edges=edges,
                generated_at=utcnow(),
                note=(
                    "Derived nodes and edges come only from stored records. Participant "
                    "nodes are source speaker labels, not verified real-world identities. "
                    "Stored edges were explicitly confirmed by the operator."
                ),
            )
        )
    )


@bp.post("/edges")
@login_required
def create_edge():
    body = json_body()
    from_ref = body.get("from_ref")
    to_ref = body.get("to_ref")
    if not isinstance(from_ref, str) or not isinstance(to_ref, str):
        raise ApiError("`from_ref` and `to_ref` are required.", code="invalid_parameter")
    from_ref = from_ref.strip()
    to_ref = to_ref.strip()
    if from_ref == to_ref:
        raise ApiError("An edge needs two different nodes.", code="invalid_parameter")

    relation = body.get("relation", "related_to")
    if not isinstance(relation, str) or not relation.strip():
        raise ApiError("`relation` must be a non-empty string.", code="invalid_parameter")
    relation = re.sub(r"\s+", "_", relation.strip())[:64]
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", relation):
        raise ApiError(
            "`relation` may contain letters, numbers, underscores, and hyphens.",
            code="invalid_parameter",
        )

    confidence = body.get("confidence", 1.0)
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        raise ApiError("`confidence` must be a number between 0 and 1.", code="invalid_parameter")
    confidence = max(0.0, min(1.0, float(confidence)))

    db = get_db()
    nodes, _ = build_graph(db, g.current_user.id)
    if validate_ref(nodes, from_ref) is None:
        raise ApiError("`from_ref` was not found.", status=404, code="not_found")
    if validate_ref(nodes, to_ref) is None:
        raise ApiError("`to_ref` was not found.", status=404, code="not_found")

    from_type = from_ref.split(":", 1)[0]
    to_type = to_ref.split(":", 1)[0]
    row = KnowledgeEdge(
        owner_id=g.current_user.id,
        from_type=from_type,
        from_ref=from_ref,
        to_type=to_type,
        to_ref=to_ref,
        relation=relation,
        confidence=confidence,
        created_at=utcnow(),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(
            "That relationship already exists.", status=409, code="duplicate_edge"
        ) from None
    db.refresh(row)

    payload = GraphEdgeOut(
        id=f"stored:{row.id}",
        source=row.from_ref,
        target=row.to_ref,
        relation=row.relation,
        derived=False,
        confidence=row.confidence,
        source_ref=f"knowledge_edge:{row.id}",
        label=row.relation.replace("_", " "),
    )
    return jsonify(dump(payload)), 201


@bp.delete("/edges/<int:edge_id>")
@login_required
def delete_edge(edge_id: int):
    db = get_db()
    row = db.execute(
        select(KnowledgeEdge).where(
            KnowledgeEdge.id == edge_id, KnowledgeEdge.owner_id == g.current_user.id
        )
    ).scalar_one_or_none()
    if row is None:
        raise ApiError("Relationship not found.", status=404, code="not_found")
    db.delete(row)
    db.commit()
    return jsonify({"deleted": True, "id": edge_id})
