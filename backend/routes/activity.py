"""Activity timeline endpoint."""

from __future__ import annotations

from flask import Blueprint, g, jsonify

from api_utils import dump, int_arg
from security import get_db, login_required
from services.activity_service import collect_activity

bp = Blueprint("activity", __name__, url_prefix="/api/activity")


@bp.get("")
@bp.get("/")
@login_required
def activity():
    limit = int_arg("limit", 30, minimum=1, maximum=100)
    items = collect_activity(get_db(), g.current_user.id, limit=limit)
    return jsonify([dump(item) for item in items])
