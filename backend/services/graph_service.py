"""Knowledge graph derived from source-linked records.

There is no separate graph database. Nodes are built from the existing tables
and edges from explicit source links (task/memory/meeting/learning -> conversation)
plus user-confirmed edges stored in ``knowledge_edges``.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import (
    Conversation,
    Fact,
    KnowledgeEdge,
    LearningSet,
    Meeting,
    Todo,
)

ALLOWED_TYPES = {"conversation", "memory", "task", "meeting", "learning", "participant"}


def _iso(value: datetime | None) -> str | None:
    return value.replace(tzinfo=None).isoformat(timespec="seconds") + "Z" if value else None


def _short(value: str | None, limit: int = 90) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    return text[:limit] + ("…" if len(text) > limit else "") if text else "Untitled"


def _participant_ref(label: str) -> str:
    normalized = re.sub(r"\s+", " ", label.strip().lower())
    digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:16]
    return f"participant:{digest}"


def build_graph(db: Session, owner_id: int) -> tuple[list[dict], list[dict]]:
    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    conversations = (
        db.execute(
            select(Conversation)
            .where(Conversation.owner_id == owner_id, Conversation.deleted.is_(False))
            .order_by(Conversation.start_time.desc())
            .limit(300)
        )
        .scalars()
        .all()
    )
    conversation_by_id = {}
    for row in conversations:
        conversation_by_id[row.id] = row
        ref = f"conversation:{row.id}"
        nodes[ref] = {
            "id": ref,
            "type": "conversation",
            "label": _short(row.short_summary) or f"Conversation {row.bee_id}",
            "route": f"/conversations/{row.bee_id}",
            "verified": True,
            "source": "Bee conversation",
            "metadata": {
                "bee_id": row.bee_id,
                "start_time": _iso(row.start_time),
                "state": row.state,
            },
        }

    facts = (
        db.execute(
            select(Fact)
            .where(Fact.owner_id == owner_id, Fact.deleted_at.is_(None))
            .order_by(Fact.updated_at.desc())
            .limit(300)
        )
        .scalars()
        .all()
    )
    for row in facts:
        ref = f"memory:{row.bee_id}"
        nodes[ref] = {
            "id": ref,
            "type": "memory",
            "label": _short(row.text),
            "route": "/memory",
            "verified": not row.ai_generated,
            "source": "Bee fact" if row.origin == "bee" else "Local memory",
            "metadata": {
                "origin": row.origin,
                "confirmed": row.confirmed,
                "ai_generated": row.ai_generated,
                "source_conversation_id": row.source_conversation_id,
            },
        }
        if row.source_conversation_id in conversation_by_id:
            edges.append(
                {
                    "id": f"derived:memory:{row.bee_id}:conversation:{row.source_conversation_id}",
                    "source": ref,
                    "target": f"conversation:{row.source_conversation_id}",
                    "relation": "extracted_from",
                    "derived": True,
                    "confidence": 1.0,
                    "source_ref": f"memory:{row.bee_id}",
                    "label": "extracted from",
                }
            )

    todos = (
        db.execute(
            select(Todo)
            .where(Todo.owner_id == owner_id, Todo.deleted_at.is_(None))
            .order_by(Todo.updated_at.desc())
            .limit(300)
        )
        .scalars()
        .all()
    )
    for row in todos:
        ref = f"task:{row.bee_id}"
        nodes[ref] = {
            "id": ref,
            "type": "task",
            "label": _short(row.text),
            "route": "/tasks",
            "verified": not row.ai_generated,
            "source": "Bee todo" if row.origin == "bee" else "Local task",
            "metadata": {
                "completed": row.completed,
                "origin": row.origin,
                "due_at": _iso(row.due_at),
                "source_conversation_id": row.source_conversation_id,
            },
        }
        if row.source_conversation_id in conversation_by_id:
            edges.append(
                {
                    "id": f"derived:task:{row.bee_id}:conversation:{row.source_conversation_id}",
                    "source": ref,
                    "target": f"conversation:{row.source_conversation_id}",
                    "relation": "source_conversation",
                    "derived": True,
                    "confidence": 1.0,
                    "source_ref": f"task:{row.bee_id}",
                    "label": "source conversation",
                }
            )

    meetings = (
        db.execute(
            select(Meeting)
            .where(Meeting.owner_id == owner_id, Meeting.deleted_at.is_(None))
            .order_by(Meeting.meeting_at.desc(), Meeting.created_at.desc())
            .limit(200)
        )
        .scalars()
        .all()
    )
    for row in meetings:
        ref = f"meeting:{row.id}"
        nodes[ref] = {
            "id": ref,
            "type": "meeting",
            "label": _short(row.title),
            "route": f"/meetings/{row.id}",
            "verified": not row.ai_generated,
            "source": "Meeting from conversation" if row.source_kind == "conversation" else "Manual meeting",
            "metadata": {
                "meeting_at": _iso(row.meeting_at),
                "conversation_bee_id": row.conversation_bee_id,
                "ai_generated": row.ai_generated,
            },
        }
        if row.conversation_id in conversation_by_id:
            edges.append(
                {
                    "id": f"derived:meeting:{row.id}:conversation:{row.conversation_id}",
                    "source": ref,
                    "target": f"conversation:{row.conversation_id}",
                    "relation": "summarizes",
                    "derived": True,
                    "confidence": 1.0,
                    "source_ref": f"meeting:{row.id}",
                    "label": "summarizes",
                }
            )
        for participant in row.participants or []:
            if not isinstance(participant, str) or not participant.strip():
                continue
            participant_ref = _participant_ref(participant)
            if participant_ref not in nodes:
                nodes[participant_ref] = {
                    "id": participant_ref,
                    "type": "participant",
                    "label": _short(participant, 60),
                    "route": f"/meetings/{row.id}",
                    "verified": False,
                    "source": "Speaker label in source transcript",
                    "metadata": {
                        "meeting_ids": [row.id],
                        "note": "A speaker label, not a verified real-world identity.",
                    },
                }
            else:
                meeting_ids = nodes[participant_ref]["metadata"].setdefault("meeting_ids", [])
                if row.id not in meeting_ids:
                    meeting_ids.append(row.id)
            edges.append(
                {
                    "id": f"derived:meeting:{row.id}:participant:{participant_ref.split(':', 1)[1]}",
                    "source": ref,
                    "target": participant_ref,
                    "relation": "has_participant",
                    "derived": True,
                    "confidence": 1.0,
                    "source_ref": f"meeting:{row.id}",
                    "label": "participant",
                }
            )

    learning_sets = (
        db.execute(
            select(LearningSet)
            .where(LearningSet.owner_id == owner_id, LearningSet.deleted_at.is_(None))
            .order_by(LearningSet.updated_at.desc())
            .limit(150)
        )
        .scalars()
        .all()
    )
    for row in learning_sets:
        ref = f"learning:{row.id}"
        nodes[ref] = {
            "id": ref,
            "type": "learning",
            "label": _short(row.title),
            "route": f"/learning/{row.id}",
            "verified": True,
            "source": "Learning set",
            "metadata": {
                "ai_generated": row.ai_generated,
                "conversation_bee_id": row.conversation_bee_id,
            },
        }
        if row.conversation_id in conversation_by_id:
            edges.append(
                {
                    "id": f"derived:learning:{row.id}:conversation:{row.conversation_id}",
                    "source": ref,
                    "target": f"conversation:{row.conversation_id}",
                    "relation": "studies",
                    "derived": True,
                    "confidence": 1.0,
                    "source_ref": f"learning:{row.id}",
                    "label": "studies",
                }
            )

    stored = (
        db.execute(select(KnowledgeEdge).where(KnowledgeEdge.owner_id == owner_id))
        .scalars()
        .all()
    )
    for row in stored:
        if row.from_ref not in nodes or row.to_ref not in nodes:
            continue
        edges.append(
            {
                "id": f"stored:{row.id}",
                "source": row.from_ref,
                "target": row.to_ref,
                "relation": row.relation,
                "derived": False,
                "confidence": row.confidence,
                "source_ref": f"knowledge_edge:{row.id}",
                "label": row.relation.replace("_", " "),
            }
        )

    return list(nodes.values()), edges


def filter_graph(
    nodes: list[dict], edges: list[dict], *, query: str = "", types: set[str] | None = None
) -> tuple[list[dict], list[dict]]:
    selected = types or ALLOWED_TYPES
    query_lower = query.strip().lower()
    kept = [
        node
        for node in nodes
        if node["type"] in selected
        and (not query_lower or query_lower in node["label"].lower() or query_lower in node["id"].lower())
    ]
    kept_ids = {node["id"] for node in kept}
    kept_edges = [edge for edge in edges if edge["source"] in kept_ids and edge["target"] in kept_ids]
    return kept, kept_edges


def validate_ref(nodes: list[dict], ref: str) -> dict | None:
    return next((node for node in nodes if node["id"] == ref), None)
