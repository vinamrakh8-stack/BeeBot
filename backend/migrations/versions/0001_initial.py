"""Initial schema for Bee Voice+.

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-22
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("username", sa.String(length=128), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("display_name", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )

    op.create_table(
        "conversations",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("bee_id", sa.BigInteger(), nullable=False),
        sa.Column("uuid", sa.String(length=64), nullable=True),
        sa.Column("start_time", sa.DateTime(), nullable=True),
        sa.Column("end_time", sa.DateTime(), nullable=True),
        sa.Column("device_type", sa.String(length=64), nullable=True),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("short_summary", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("primary_location", sa.JSON(), nullable=True),
        sa.Column("suggested_links", sa.JSON(), nullable=True),
        sa.Column("transcriptions", sa.JSON(), nullable=True),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("bee_created_at", sa.DateTime(), nullable=True),
        sa.Column("bee_updated_at", sa.DateTime(), nullable=True),
        sa.Column("synced_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("owner_id", "bee_id", name="uq_conversations_owner_bee"),
    )
    op.create_index("ix_conversations_owner_start", "conversations", ["owner_id", "start_time"])

    op.create_table(
        "daily_summaries",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("bee_id", sa.BigInteger(), nullable=False),
        sa.Column("day", sa.Date(), nullable=True),
        sa.Column("day_time", sa.DateTime(), nullable=True),
        sa.Column("short_summary", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("email_summary", sa.Text(), nullable=True),
        sa.Column("calendar_summary", sa.Text(), nullable=True),
        sa.Column("conversations_count", sa.Integer(), nullable=True),
        sa.Column("locations", sa.JSON(), nullable=True),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("bee_created_at", sa.DateTime(), nullable=True),
        sa.Column("bee_updated_at", sa.DateTime(), nullable=True),
        sa.Column("synced_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("owner_id", "bee_id", name="uq_daily_owner_bee"),
    )
    op.create_index("ix_daily_owner_date", "daily_summaries", ["owner_id", "day"])

    op.create_table(
        "facts",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("bee_id", sa.BigInteger(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=True),
        sa.Column("confirmed", sa.Boolean(), nullable=False),
        sa.Column("bee_created_at", sa.DateTime(), nullable=True),
        sa.Column("synced_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("owner_id", "bee_id", name="uq_facts_owner_bee"),
    )
    op.create_index("ix_facts_owner_created", "facts", ["owner_id", "bee_created_at"])

    op.create_table(
        "todos",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("bee_id", sa.BigInteger(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("alarm_at", sa.DateTime(), nullable=True),
        sa.Column("bee_created_at", sa.DateTime(), nullable=True),
        sa.Column("synced_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("owner_id", "bee_id", name="uq_todos_owner_bee"),
    )
    op.create_index("ix_todos_owner_completed", "todos", ["owner_id", "completed"])

    op.create_table(
        "sync_state",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("cursor", sa.String(length=255), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(), nullable=True),
        sa.Column("last_full_sync_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("owner_id", name="uq_sync_state_owner"),
    )

    op.create_table(
        "sync_runs",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("trigger", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("counts", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_sync_runs_owner_id", "sync_runs", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_sync_runs_owner_id", table_name="sync_runs")
    op.drop_table("sync_runs")
    op.drop_table("sync_state")
    op.drop_index("ix_todos_owner_completed", table_name="todos")
    op.drop_table("todos")
    op.drop_index("ix_facts_owner_created", table_name="facts")
    op.drop_table("facts")
    op.drop_index("ix_daily_owner_date", table_name="daily_summaries")
    op.drop_table("daily_summaries")
    op.drop_index("ix_conversations_owner_start", table_name="conversations")
    op.drop_table("conversations")
    op.drop_table("users")
