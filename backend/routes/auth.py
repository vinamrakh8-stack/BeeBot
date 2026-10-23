"""Operator authentication for the dashboard."""

from __future__ import annotations

from flask import Blueprint, g, jsonify, session

from api_utils import ApiError, dump, json_body
from schemas import UserOut
from security import (
    get_db,
    get_settings,
    hash_password,
    login_required,
    operator_exists,
    verify_password,
)

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

# Verified against when the username is unknown, so a miss costs about the same
# time as a wrong password.
DUMMY_HASH = hash_password("dummy-password-for-timing-only")


@bp.get("/demo")
def demo():
    """Return the development demo account for the sign-in page.

    Deliberately unavailable in production, and disabled entirely when
    DEMO_PASSWORD is empty.
    """
    settings = get_settings()
    enabled = (
        settings.app_env == "development"
        and settings.demo_login_enabled
        and bool(settings.demo_password)
        and bool(settings.app_username)
    )
    if not enabled:
        return jsonify({"enabled": False})

    response = jsonify(
        {
            "enabled": True,
            "username": settings.app_username,
            "password": settings.demo_password,
        }
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@bp.post("/login")
def login():
    settings = get_settings()
    if not settings.app_password_hash:
        return (
            jsonify(
                {
                    "error": "operator_not_configured",
                    "message": (
                        "The operator account is not configured. Set "
                        "APP_PASSWORD_HASH (see README) and restart the server."
                    ),
                }
            ),
            503,
        )

    body = json_body()
    username = body.get("username")
    password = body.get("password")
    if not isinstance(username, str) or not isinstance(password, str) or not username or not password:
        raise ApiError("Username and password are required.", code="invalid_credentials")

    db = get_db()
    user = operator_exists(db, username)
    stored_hash = user.password_hash if user and user.password_hash else DUMMY_HASH
    password_ok = verify_password(password, stored_hash)

    if user is None or not password_ok:
        return (
            jsonify({"error": "invalid_credentials", "message": "Invalid username or password"}),
            401,
        )

    session.clear()
    session["uid"] = user.id
    session.permanent = True
    return jsonify(dump(UserOut.model_validate(user)))


@bp.post("/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@bp.get("/me")
@login_required
def me():
    return jsonify(dump(UserOut.model_validate(g.current_user)))
