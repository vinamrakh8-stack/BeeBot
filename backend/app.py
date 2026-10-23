"""Bee Voice+ — single Flask entry point.

Run everything with::

    python app.py                 # API + built React app on :5000
    python app.py init-db         # create tables without Alembic
    python app.py hash-password   # generate APP_PASSWORD_HASH
    python app.py sync --full     # sync from cron/Task Scheduler

In development the React app is usually served by Vite (``npm run dev``) which
proxies ``/api`` here. After ``npm run build`` this file serves ``frontend/dist``
too, so a single process runs the whole product.
"""

from __future__ import annotations

import argparse
import getpass
import json
import sys
import threading
from datetime import timedelta
from pathlib import Path

import click
from flask import Flask, abort, jsonify, request, send_from_directory

from api_utils import ApiError
from config import Settings, get_settings
from db import build_engine, build_session_factory
from models import Base
from routes import register_blueprints
from security import (
    close_db,
    enforce_same_origin,
    ensure_operator,
    hash_password,
    operator_exists,
)
from services.bee_client import BeeClient
from services.bee_errors import BeeError
from services.sync_service import SyncService
from services.ai_client import AIClient, AIError
from services.rate_limit import RateLimiter


def create_app(settings: Settings | None = None) -> Flask:
    settings = settings or get_settings()
    dist = settings.frontend_dist_path

    app = Flask(__name__, static_folder=None)
    app.config.update(
        SECRET_KEY=settings.secret_key,
        SESSION_COOKIE_NAME=settings.session_cookie_name,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=settings.is_production,
        PERMANENT_SESSION_LIFETIME=timedelta(hours=settings.session_ttl_hours),
        MAX_CONTENT_LENGTH=max(1_000_000, settings.ai_max_audio_bytes + 200_000),
        JSON_SORT_KEYS=False,
    )
    app.json.sort_keys = False

    engine = build_engine(settings)
    session_factory = build_session_factory(engine)
    bee_client = BeeClient(settings)
    ai_client = AIClient(settings)

    app.extensions["bee_settings"] = settings
    app.extensions["bee_engine"] = engine
    app.extensions["bee_session_factory"] = session_factory
    app.extensions["bee_client"] = bee_client
    app.extensions["bee_sync_lock"] = threading.Lock()
    app.extensions["ai_client"] = ai_client
    app.extensions["ai_limiter"] = RateLimiter(
        settings.ai_rate_limit_per_minute,
        message="Too many AI requests. Try again in about {seconds} seconds.",
    )
    app.extensions["mobile_pair_limiter"] = RateLimiter(
        settings.mobile_pair_rate_limit_per_minute,
        message="Too many pairing attempts. Try again in about {seconds} seconds.",
    )

    # Production schema changes go through Alembic; dev/test get a convenience
    # create_all so a fresh checkout runs immediately.
    if not settings.is_production:
        Base.metadata.create_all(engine)
    with session_factory() as db:
        ensure_operator(db, settings)

    app.teardown_appcontext(close_db)
    app.before_request(enforce_same_origin)
    register_blueprints(app)

    # ------------------------------------------------------------------ health

    @app.get("/api/health")
    def health():
        return jsonify(
            {
                "status": "ok",
                "bee_configured": settings.bee_configured,
                "ai_configured": settings.ai_configured,
            }
        )

    # ------------------------------------------------------------ error mapping

    @app.errorhandler(BeeError)
    def handle_bee_error(exc: BeeError):
        return jsonify(exc.as_dict()), exc.status_code

    @app.errorhandler(ApiError)
    def handle_api_error(exc: ApiError):
        response = jsonify(exc.as_dict())
        response.status_code = exc.status
        for name, value in exc.headers.items():
            response.headers[name] = value
        return response

    @app.errorhandler(AIError)
    def handle_ai_error(exc: AIError):
        return jsonify(exc.as_dict()), exc.status

    @app.errorhandler(404)
    def handle_404(exc):
        if request.path.startswith("/api/"):
            return (
                jsonify({"error": "not_found", "message": "Endpoint not found."}),
                404,
            )
        return _serve_spa(dist, "")

    @app.errorhandler(405)
    def handle_405(exc):
        return (
            jsonify({"error": "method_not_allowed", "message": "Method not allowed."}),
            405,
        )

    # ------------------------------------------------------------------- CORS

    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get("Origin")
        if origin and origin in settings.allowed_origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Accept, Authorization"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
        return response

    # -------------------------------------------------------- React single page

    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def spa(path: str):
        if path.startswith("api/"):
            abort(404)
        return _serve_spa(dist, path)

    # -------------------------------------------------------------- Flask CLI

    @app.cli.command("init-db")
    def init_db_command():
        """Create tables without Alembic (development convenience)."""
        Base.metadata.create_all(engine)
        click.echo("Schema created (or already up to date).")

    @app.cli.command("hash-password")
    def hash_password_command():
        """Print a bcrypt hash for APP_PASSWORD_HASH."""
        password = getpass.getpass("New password: ")
        if password != getpass.getpass("Confirm password: "):
            raise click.ClickException("Passwords do not match.")
        if len(password) < 10:
            raise click.ClickException("Use at least 10 characters.")
        click.echo(hash_password(password))

    @app.cli.command("sync")
    @click.option("--full", is_flag=True, help="Ignore the saved cursor.")
    def sync_command(full: bool):
        """Run a sync against Bee."""
        result = _run_cli_sync(app, full=full)
        click.echo(json.dumps(result, indent=2))

    return app


def _serve_spa(dist: Path, path: str):
    """Serve a built asset, or index.html for client-side routes."""
    if path:
        candidate = (dist / path).resolve()
        try:
            candidate.relative_to(dist)
        except ValueError:
            abort(404)
        if candidate.is_file():
            return send_from_directory(str(dist), path)

    index = dist / "index.html"
    if index.is_file():
        return send_from_directory(str(dist), "index.html")

    return (
        jsonify(
            {
                "error": "frontend_not_built",
                "message": (
                    "The React build is missing. Run `npm install && npm run build` "
                    "in frontend/, or use `npm run dev` while developing."
                ),
            }
        ),
        503,
    )


def _run_cli_sync(app: Flask, *, full: bool) -> dict:
    settings: Settings = app.extensions["bee_settings"]
    factory = app.extensions["bee_session_factory"]
    client = app.extensions["bee_client"]

    with factory() as db:
        user = operator_exists(db, settings.app_username)
        if user is None:
            raise click.ClickException(
                "Operator account not found. Set APP_PASSWORD_HASH and start the app once."
            )
        result = SyncService(db, client, settings, user.id).run(trigger="cli", full=full)
        return result.as_dict()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python app.py")
    parser.add_argument(
        "command",
        nargs="?",
        default="run",
        choices=["run", "init-db", "hash-password", "sync"],
        help="Default: run the web app.",
    )
    parser.add_argument("--full", action="store_true", help="With `sync`: ignore the cursor.")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args(argv)

    if args.command == "hash-password":
        password = getpass.getpass("New password: ")
        if password != getpass.getpass("Confirm password: "):
            print("Passwords do not match.", file=sys.stderr)
            return 1
        if len(password) < 10:
            print("Use at least 10 characters.", file=sys.stderr)
            return 1
        print(hash_password(password))
        return 0

    settings = get_settings()
    app = create_app(settings)

    if args.command == "init-db":
        Base.metadata.create_all(app.extensions["bee_engine"])
        print("Schema created (or already up to date).")
        return 0

    if args.command == "sync":
        try:
            print(json.dumps(_run_cli_sync(app, full=args.full), indent=2))
        except click.ClickException as exc:
            print(exc.format_message(), file=sys.stderr)
            return 2
        return 0

    app.run(
        host=args.host or settings.flask_host,
        port=args.port or settings.flask_port,
        debug=settings.app_env == "development",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
