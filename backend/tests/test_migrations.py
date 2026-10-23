from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def _run_alembic(db_path: Path, *args: str) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    env["APP_ENV"] = "test"
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_migration_0002_preserves_existing_rows(tmp_path):
    db_path = tmp_path / "migration.db"
    initial = _run_alembic(db_path, "upgrade", "0001_initial")
    assert initial.returncode == 0, initial.stderr

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "INSERT INTO users (username, password_hash, display_name, created_at) "
            "VALUES ('operator', 'hash', 'Operator', '2026-01-01 00:00:00')"
        )
        connection.execute(
            "INSERT INTO facts (owner_id, bee_id, text, confirmed, synced_at) "
            "VALUES (1, 10, 'Prefers tea', 1, '2026-01-01 00:00:00')"
        )
        connection.execute(
            "INSERT INTO todos (owner_id, bee_id, text, completed, synced_at) "
            "VALUES (1, 11, 'Call dentist', 0, '2026-01-01 00:00:00')"
        )
        connection.commit()

    upgraded = _run_alembic(db_path, "upgrade", "head")
    assert upgraded.returncode == 0, upgraded.stderr

    with sqlite3.connect(db_path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        assert {
            "sync_tombstones",
            "meetings",
            "learning_sets",
            "learning_items",
            "knowledge_edges",
        } <= tables

        fact = connection.execute(
            "SELECT text, origin, ai_generated FROM facts WHERE bee_id = 10"
        ).fetchone()
        assert fact == ("Prefers tea", "bee", 0)

        todo = connection.execute(
            "SELECT text, origin, approved, due_at FROM todos WHERE bee_id = 11"
        ).fetchone()
        assert todo == ("Call dentist", "bee", 1, None)

        fact_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(facts)")
        }
        assert {"origin", "source_conversation_id", "deleted_at"} <= fact_columns


def test_migration_0003_adds_revision_plan_without_data_loss(tmp_path):
    db_path = tmp_path / "learning.db"
    upgraded = _run_alembic(db_path, "upgrade", "0002_phase2")
    assert upgraded.returncode == 0, upgraded.stderr

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "INSERT INTO users (username, password_hash, display_name, created_at) "
            "VALUES ('operator', 'hash', 'Operator', '2026-01-01 00:00:00')"
        )
        connection.execute(
            "INSERT INTO learning_sets "
            "(owner_id, title, source_kind, notes, ai_generated, created_at, updated_at) "
            "VALUES (1, 'Indexes', 'manual', 'Existing notes', 0, "
            "'2026-01-01 00:00:00', '2026-01-01 00:00:00')"
        )
        connection.commit()

    head = _run_alembic(db_path, "upgrade", "head")
    assert head.returncode == 0, head.stderr

    with sqlite3.connect(db_path) as connection:
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(learning_sets)")
        }
        assert "revision_plan" in columns
        stored = connection.execute(
            "SELECT title, notes, revision_plan FROM learning_sets"
        ).fetchone()
        assert stored == ("Indexes", "Existing notes", None)
