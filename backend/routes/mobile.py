"""Mobile companion pairing and device management.

The phone never receives Bee or AI credentials. It pairs with the operator
account over the Voice+ API, receives an opaque bearer token, and stores it in
the operating system's secure storage. Only the token hash is persisted here.
"""

from __future__ import annotations

from flask import Blueprint, g, jsonify, request
from sqlalchemy import select

from api_utils import ApiError, dump, json_body
from models import MobileToken, utcnow
from schemas import MobileDeviceOut, UserOut
from security import (
    authenticate_operator,
    get_db,
    get_mobile_pair_limiter,
    get_settings,
    issue_mobile_token,
    login_required,
)

bp = Blueprint("mobile", __name__, url_prefix="/api/mobile")

MAX_DEVICE_NAME = 128


def _device_name(value) -> str:
    if value is None:
        return "Mobile device"
    if not isinstance(value, str):
        raise ApiError("`device_name` must be a string.", code="invalid_parameter")
    name = value.strip()
    if not name:
        return "Mobile device"
    if len(name) > MAX_DEVICE_NAME:
        raise ApiError(
            f"`device_name` is limited to {MAX_DEVICE_NAME} characters.",
            code="invalid_parameter",
        )
    return name


def _require_mobile_token() -> MobileToken:
    token = getattr(g, "mobile_token", None)
    if token is None:
        raise ApiError(
            "This endpoint requires a paired mobile token.",
            status=401,
            code="mobile_token_required",
        )
    return token


@bp.post("/pair")
def pair():
    settings = get_settings()
    if not settings.app_password_hash:
        return (
            jsonify(
                {
                    "error": "operator_not_configured",
                    "message": (
                        "The operator account is not configured. Set "
                        "APP_PASSWORD_HASH and restart the server."
                    ),
                }
            ),
            503,
        )

    # Pairing checks a password, so rate-limit by client address. This is an
    # in-process limiter, consistent with the documented single-worker setup.
    get_mobile_pair_limiter().check(f"pair:{request.remote_addr or 'unknown'}")

    body = json_body()
    username = body.get("username")
    password = body.get("password")
    if not isinstance(username, str) or not isinstance(password, str) or not username or not password:
        raise ApiError("Username and password are required.", code="invalid_credentials")

    device_name = _device_name(body.get("device_name"))
    user = authenticate_operator(get_db(), username, password)
    if user is None:
        return (
            jsonify({"error": "invalid_credentials", "message": "Invalid username or password"}),
            401,
        )

    raw_token, token = issue_mobile_token(
        get_db(),
        user,
        device_name,
        ttl_days=settings.mobile_token_ttl_days,
    )
    response = jsonify(
        {
            "token": raw_token,
            "token_type": "Bearer",
            "expires_at": dump(MobileDeviceOut.model_validate(token))["expires_at"],
            "user": dump(UserOut.model_validate(user)),
            "device": dump(MobileDeviceOut.model_validate(token)),
        }
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@bp.get("/session")
@login_required
def session_info():
    settings = get_settings()
    token = _require_mobile_token()
    return jsonify(
        {
            "user": dump(UserOut.model_validate(g.current_user)),
            "device": dump(MobileDeviceOut.model_validate(token)),
            "server_time": utcnow().isoformat(timespec="seconds") + "Z",
            "api_version": "phase3",
            "capabilities": {
                "conversations": True,
                "summaries": True,
                "tasks": True,
                "assistant_chat": settings.ai_configured,
                "assistant_transcribe": settings.ai_configured,
                "bee_sync": settings.bee_configured,
                "updates": "foreground_polling",
                "wake_word": {
                    "mode": "on_device_optional",
                    "phrase": settings.wake_word_phrase,
                },
                "audio_output": "os_default_route",
            },
            "bee": {
                "configured": settings.bee_configured,
                "mode": settings.bee_api_mode,
            },
            "ai": {
                "configured": settings.ai_configured,
                "provider": settings.ai_provider,
                "model": settings.ai_model,
            },
        }
    )


@bp.delete("/session")
@login_required
def revoke_current_device():
    token = _require_mobile_token()
    if token.revoked_at is None:
        token.revoked_at = utcnow()
        get_db().commit()
    return jsonify({"revoked": True, "device_id": token.id})


@bp.get("/devices")
@login_required
def list_devices():
    rows = (
        get_db()
        .execute(
            select(MobileToken)
            .where(
                MobileToken.owner_id == g.current_user.id,
                MobileToken.revoked_at.is_(None),
                MobileToken.expires_at > utcnow(),
            )
            .order_by(MobileToken.created_at.desc())
        )
        .scalars()
        .all()
    )
    return jsonify([dump(MobileDeviceOut.model_validate(row)) for row in rows])


@bp.delete("/devices/<int:device_id>")
@login_required
def revoke_device(device_id: int):
    token = get_db().execute(
        select(MobileToken).where(
            MobileToken.id == device_id,
            MobileToken.owner_id == g.current_user.id,
        )
    ).scalar_one_or_none()
    if token is None:
        raise ApiError("Paired device not found.", status=404, code="not_found")
    if token.revoked_at is None:
        token.revoked_at = utcnow()
        get_db().commit()
    return jsonify({"revoked": True, "device_id": token.id})
