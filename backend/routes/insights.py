"""Daily and weekly insights. Deterministic, source-backed, and honest about gaps."""

from __future__ import annotations

from datetime import date

from flask import Blueprint, g, jsonify, request

from api_utils import ApiError, dump
from models import utcnow
from security import get_db, login_required
from services.insight_service import build_insights

bp = Blueprint("insights", __name__, url_prefix="/api/insights")


@bp.get("")
@bp.get("/")
@login_required
def insights():
    period = request.args.get("period", "day")
    if period not in {"day", "week"}:
        raise ApiError(
            "`period` must be day or week.", code="invalid_parameter"
        )
    raw_date = request.args.get("date", "")
    anchor = utcnow().date()
    if raw_date:
        try:
            anchor = date.fromisoformat(raw_date)
        except ValueError:
            raise ApiError(
                "`date` must be an ISO date (YYYY-MM-DD).", code="invalid_parameter"
            ) from None
    return jsonify(
        dump(
            build_insights(
                get_db(), g.current_user.id, period=period, anchor=anchor
            )
        )
    )
