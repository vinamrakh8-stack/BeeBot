"""Privacy, retention, data-export and data-deletion endpoints.

Deletion and export only touch this app's local mirror. Bee itself is never
modified and is never called from these endpoints.
"""

from __future__ import annotations

from datetime import date

from flask import Blueprint, g, jsonify
from sqlalchemy import func, select

from api_utils import dump
from models import (
    Conversation,
    DailySummary,
    Fact,
    KnowledgeEdge,
    LearningItem,
    LearningSet,
    Meeting,
    Todo,
    utcnow,
)
from schemas import (
    ConversationDetailOut,
    DailySummaryOut,
    FactOut,
    LearningItemOut,
    LearningSetOut,
    MeetingOut,
    TodoOut,
)
from security import get_db, login_required
from services.sync_service import purge_synced_data

bp = Blueprint("privacy", __name__, url_prefix="/api")

# Phase 2 tables are counted explicitly so the privacy screen cannot imply that
# meetings, learning material or graph edges are excluded from storage.
COUNTED = (
    ("conversations", Conversation),
    ("daily_summaries", DailySummary),
    ("memories", Fact),
    ("tasks", Todo),
    ("meetings", Meeting),
    ("learning_sets", LearningSet),
    ("learning_items", LearningItem),
    ("knowledge_edges", KnowledgeEdge),
)


def _count(db, model, owner_id: int) -> int:
    return db.execute(
        select(func.count()).select_from(model).where(model.owner_id == owner_id)
    ).scalar_one()


def _learning_item_count(db, owner_id: int) -> int:
    return db.execute(
        select(func.count())
        .select_from(LearningItem)
        .join(LearningSet, LearningSet.id == LearningItem.set_id)
        .where(LearningSet.owner_id == owner_id)
    ).scalar_one()


@bp.get("/settings/privacy")
@login_required
def privacy():
    db = get_db()
    owner_id = g.current_user.id
    stored = {
        name: _count(db, model, owner_id)
        for name, model in COUNTED
        if model is not LearningItem
    }
    stored["learning_items"] = _learning_item_count(db, owner_id)
    return jsonify(
        {
            "stored": stored,
            "retention": (
                "Synced copies and locally created records stay in this deployment's "
                "database until you delete them. Bee retains its own copy under your "
                "Bee account."
            ),
            "credentials": (
                "The Bee token lives only in server environment variables (or in a "
                "local `bee proxy`). It is never sent to the browser or stored in "
                "the database."
            ),
            "sources": [
                "Conversations and transcripts",
                "Daily summaries",
                "Personal memories (facts, including accepted AI suggestions)",
                "Tasks (including accepted AI suggestions)",
                "Meetings derived from conversations",
                "Learning sets, cards, and revision plans",
                "User-confirmed knowledge-graph edges",
            ],
        }
    )


@bp.get("/data/export")
@login_required
def export_data():
    """Download every local record owned by the signed-in operator as JSON."""
    db = get_db()
    owner_id = g.current_user.id

    conversations = (
        db.execute(
            select(Conversation)
            .where(Conversation.owner_id == owner_id)
            .order_by(Conversation.bee_id.asc())
        )
        .scalars()
        .all()
    )
    daily = (
        db.execute(
            select(DailySummary)
            .where(DailySummary.owner_id == owner_id)
            .order_by(DailySummary.bee_id.asc())
        )
        .scalars()
        .all()
    )
    facts = (
        db.execute(
            select(Fact).where(Fact.owner_id == owner_id).order_by(Fact.bee_id.asc())
        )
        .scalars()
        .all()
    )
    todos = (
        db.execute(
            select(Todo).where(Todo.owner_id == owner_id).order_by(Todo.bee_id.asc())
        )
        .scalars()
        .all()
    )
    meetings = (
        db.execute(
            select(Meeting)
            .where(Meeting.owner_id == owner_id)
            .order_by(Meeting.id.asc())
        )
        .scalars()
        .all()
    )
    learning_sets = (
        db.execute(
            select(LearningSet)
            .where(LearningSet.owner_id == owner_id)
            .order_by(LearningSet.id.asc())
        )
        .scalars()
        .all()
    )
    set_ids = [row.id for row in learning_sets]
    items_by_set: dict[int, list[dict]] = {set_id: [] for set_id in set_ids}
    if set_ids:
        items = (
            db.execute(
                select(LearningItem)
                .where(LearningItem.set_id.in_(set_ids))
                .order_by(LearningItem.set_id.asc(), LearningItem.id.asc())
            )
            .scalars()
            .all()
        )
        for item in items:
            items_by_set.setdefault(item.set_id, []).append(
                dump(LearningItemOut.model_validate(item))
            )
    edges = (
        db.execute(
            select(KnowledgeEdge)
            .where(KnowledgeEdge.owner_id == owner_id)
            .order_by(KnowledgeEdge.id.asc())
        )
        .scalars()
        .all()
    )

    payload = {
        "format": "bee-voice-plus-export",
        "version": 1,
        "generated_at": utcnow().isoformat(timespec="seconds") + "Z",
        "account": {
            "id": g.current_user.id,
            "username": g.current_user.username,
            "display_name": g.current_user.display_name,
        },
        "notes": (
            "This export contains only records held by this deployment for the "
            "signed-in operator. It does not call Bee and does not include server "
            "credentials or the Bee token."
        ),
        "counts": {
            "conversations": len(conversations),
            "daily_summaries": len(daily),
            "memories": len(facts),
            "tasks": len(todos),
            "meetings": len(meetings),
            "learning_sets": len(learning_sets),
            "learning_items": sum(len(value) for value in items_by_set.values()),
            "knowledge_edges": len(edges),
        },
        "conversations": [
            dump(ConversationDetailOut.model_validate(row)) for row in conversations
        ],
        "daily_summaries": [dump(DailySummaryOut.model_validate(row)) for row in daily],
        "memories": [dump(FactOut.model_validate(row)) for row in facts],
        "tasks": [dump(TodoOut.model_validate(row)) for row in todos],
        "meetings": [dump(MeetingOut.model_validate(row)) for row in meetings],
        "learning_sets": [
            {
                **dump(LearningSetOut.model_validate(row)),
                "items": items_by_set.get(row.id, []),
            }
            for row in learning_sets
        ],
        "knowledge_edges": [
            {
                "id": row.id,
                "from_type": row.from_type,
                "from_ref": row.from_ref,
                "to_type": row.to_type,
                "to_ref": row.to_ref,
                "relation": row.relation,
                "confidence": row.confidence,
                "created_at": row.created_at.replace(tzinfo=None).isoformat(
                    timespec="seconds"
                )
                + "Z",
            }
            for row in edges
        ],
    }

    response = jsonify(payload)
    response.headers["Content-Disposition"] = (
        f'attachment; filename="bee-voice-plus-export-{date.today().isoformat()}.json"'
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@bp.delete("/data")
@login_required
def delete_data():
    deleted = purge_synced_data(get_db(), g.current_user.id)
    return jsonify(
        {
            "deleted": deleted,
            "message": (
                "Local copies and locally created records were deleted. Bee was "
                "not modified. Run a sync to fetch Bee-owned records again."
            ),
        }
    )
