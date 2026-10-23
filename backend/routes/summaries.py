"""Daily summaries / recaps."""

from __future__ import annotations

from flask import Blueprint, g, jsonify
from sqlalchemy import func, select

from api_utils import ApiError, dump, page_payload, pagination
from models import DailySummary
from schemas import DailySummaryOut
from security import get_db, login_required

bp = Blueprint("summaries", __name__, url_prefix="/api/summaries")


@bp.get("")
@bp.get("/")
@login_required
def list_summaries():
    limit, offset = pagination()
    db = get_db()
    filters = [DailySummary.owner_id == g.current_user.id, DailySummary.deleted.is_(False)]

    total = db.execute(select(func.count()).select_from(DailySummary).where(*filters)).scalar_one()
    rows = (
        db.execute(
            select(DailySummary)
            .where(*filters)
            .order_by(
                func.coalesce(DailySummary.day, func.date(DailySummary.day_time)).desc(),
                DailySummary.bee_id.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )

    return jsonify(
        page_payload([DailySummaryOut.model_validate(row) for row in rows], total, limit, offset)
    )


@bp.get("/<int:bee_id>")
@login_required
def get_summary(bee_id: int):
    row = get_db().execute(
        select(DailySummary).where(
            DailySummary.owner_id == g.current_user.id, DailySummary.bee_id == bee_id
        )
    ).scalar_one_or_none()
    if row is None:
        raise ApiError("Daily summary not found.", status=404, code="not_found")
    return jsonify(dump(DailySummaryOut.model_validate(row)))
