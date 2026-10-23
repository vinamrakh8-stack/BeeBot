"""Bee connection status and synchronisation endpoints."""

from __future__ import annotations

from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import select

from api_utils import ApiError, dump, int_arg
from models import SyncRun
from schemas import SyncRunOut
from security import get_client, get_db, get_settings, login_required
from services import bee_service, sync_service
from services.sync_service import SyncBusy

bp = Blueprint("bee", __name__, url_prefix="/api")


def _lock():
    return current_app.extensions["bee_sync_lock"]


@bp.get("/bee/status")
@bp.get("/connection/status")
@login_required
def bee_status():
    settings = get_settings()
    db = get_db()
    return jsonify(
        bee_service.connection_status(
            db,
            get_client(),
            settings,
            g.current_user.id,
            running=sync_service.is_running(_lock()),
        )
    )


@bp.get("/sync/status")
@login_required
def sync_status():
    return jsonify(
        dump(
            sync_service.get_sync_status(
                get_db(), g.current_user.id, running=sync_service.is_running(_lock())
            )
        )
    )


@bp.post("/bee/sync")
@login_required
def trigger_sync():
    full = request.args.get("full", "false").lower() in {"1", "true", "yes"}
    db = get_db()
    try:
        result = sync_service.run_sync(
            db,
            get_client(),
            get_settings(),
            g.current_user.id,
            trigger="manual",
            full=full,
            lock=_lock(),
        )
    except SyncBusy as exc:
        raise ApiError(str(exc), status=409, code="sync_in_progress") from None

    run = db.execute(select(SyncRun).where(SyncRun.id == result.run_id)).scalar_one()
    return jsonify(dump(SyncRunOut.model_validate(run)))


@bp.get("/sync/runs")
@login_required
def sync_runs():
    limit = int_arg("limit", 10, minimum=1, maximum=50)
    rows = (
        get_db()
        .execute(
            select(SyncRun)
            .where(SyncRun.owner_id == g.current_user.id)
            .order_by(SyncRun.id.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return jsonify([dump(SyncRunOut.model_validate(row)) for row in rows])
