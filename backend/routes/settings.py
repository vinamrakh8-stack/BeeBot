"""Privacy, retention and data-deletion endpoints.

Deletion only removes this app's local mirror. Bee itself is never modified.
"""

from __future__ import annotations

from flask import Blueprint, g, jsonify
from sqlalchemy import func, select

from models import Conversation, DailySummary, Fact, Todo
from security import get_db, login_required
from services.sync_service import purge_synced_data

bp = Blueprint("privacy", __name__, url_prefix="/api")


def _count(db, model, owner_id: int) -> int:
    return db.execute(
        select(func.count()).select_from(model).where(model.owner_id == owner_id)
    ).scalar_one()


@bp.get("/settings/privacy")
@login_required
def privacy():
    db = get_db()
    owner_id = g.current_user.id
    return jsonify(
        {
            "stored": {
                "conversations": _count(db, Conversation, owner_id),
                "daily_summaries": _count(db, DailySummary, owner_id),
                "memories": _count(db, Fact, owner_id),
                "tasks": _count(db, Todo, owner_id),
            },
            "retention": (
                "Synced copies stay in this deployment's database until you delete "
                "them. Bee retains its own copy under your Bee account."
            ),
            "credentials": (
                "The Bee token lives only in server environment variables (or in a "
                "local `bee proxy`). It is never sent to the browser or stored in "
                "the database."
            ),
            "sources": [
                "Conversations and transcripts",
                "Daily summaries",
                "Personal memories (facts)",
                "Tasks (todos)",
            ],
        }
    )


@bp.delete("/data")
@login_required
def delete_data():
    deleted = purge_synced_data(get_db(), g.current_user.id)
    return jsonify(
        {
            "deleted": deleted,
            "message": (
                "Local copies deleted. Bee was not modified. Run a sync to fetch "
                "them again."
            ),
        }
    )
