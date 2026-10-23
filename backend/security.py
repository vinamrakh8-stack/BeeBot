"""Authentication and request guards.

The dashboard uses its own operator account, distinct from the Bee account.
Sessions are Flask signed cookies; Bee credentials never enter the session.
"""

from __future__ import annotations

from functools import wraps
from typing import Callable

import bcrypt
from flask import current_app, g, jsonify, request, session
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import Settings
from models import User


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def get_settings() -> Settings:
    return current_app.extensions["bee_settings"]


def get_client():
    return current_app.extensions["bee_client"]


def get_ai_client():
    return current_app.extensions["ai_client"]


def get_ai_limiter():
    return current_app.extensions["ai_limiter"]


def check_ai_rate_limit() -> None:
    """Rate-limit AI calls per authenticated operator."""
    get_ai_limiter().check(f"user:{g.current_user.id}")


def get_db() -> Session:
    """One SQLAlchemy session per request, closed by the teardown hook."""
    if "db" not in g:
        g.db = current_app.extensions["bee_session_factory"]()
    return g.db


def close_db(_exc: BaseException | None = None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def current_user() -> User | None:
    uid = session.get("uid")
    if not isinstance(uid, int):
        return None
    user = getattr(g, "current_user", None)
    if user is None or user.id != uid:
        user = get_db().get(User, uid)
        g.current_user = user
    return user


def login_required(view: Callable):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None:
            return (
                jsonify(
                    {
                        "error": "not_authenticated",
                        "message": "Sign in to continue.",
                    }
                ),
                401,
            )
        g.current_user = user
        return view(*args, **kwargs)

    return wrapped


def enforce_same_origin():
    """CSRF guard for cookie-authenticated mutations.

    Browsers send Origin/Referer on state-changing requests. Non-browser
    clients (curl, tests) send neither and are allowed, matching normal API
    behaviour.
    """
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return None
    if not request.path.startswith("/api/"):
        return None

    origin = request.headers.get("Origin") or request.headers.get("Referer")
    if not origin:
        return None

    # Always allow the app's own origin. This matters when Flask serves the
    # built React app itself: the browser then posts to e.g.
    # http://127.0.0.1:5000, which may not be listed in CORS_ORIGINS.
    host_url = request.host_url.rstrip("/")
    if origin == host_url or origin.startswith(host_url + "/"):
        return None

    allowed = get_settings().allowed_origins
    if any(origin == candidate or origin.startswith(candidate + "/") for candidate in allowed):
        return None

    return (
        jsonify(
            {
                "error": "cross_origin_blocked",
                "message": "Cross-origin request blocked.",
            }
        ),
        403,
    )


def operator_exists(db: Session, username: str) -> User | None:
    return db.execute(select(User).where(User.username == username)).scalar_one_or_none()


def ensure_operator(db: Session, settings: Settings) -> None:
    """Create or refresh the operator account from the environment."""
    if not settings.app_password_hash:
        return
    user = operator_exists(db, settings.app_username)
    if user is None:
        db.add(
            User(
                username=settings.app_username,
                password_hash=settings.app_password_hash,
                display_name=settings.app_username,
            )
        )
    elif user.password_hash != settings.app_password_hash:
        user.password_hash = settings.app_password_hash
    db.commit()
