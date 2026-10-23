"""Phase 2: provenance, local tasks/memories, meetings, learning, graph.

Revision ID: 0002_phase2
Revises: 0001_initial
Create Date: 2026-10-23

All changes are additive. Existing rows keep their data; new non-null columns
receive conservative server defaults. SQLite uses Alembic batch mode so the
same migration works on SQLite and MySQL 8.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_phase2"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("facts") as batch:
        batch.add_column(
            sa.Column("origin", sa.String(length=16), nullable=False, server_default="bee")
        )
        batch.add_column(sa.Column("source_kind", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("source_conversation_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("source_excerpt", sa.Text(), nullable=True))
        batch.add_column(
            sa.Column("ai_generated", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch.add_column(
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now())
        )
        batch.add_column(
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now())
        )
        batch.add_column(sa.Column("deleted_at", sa.DateTime(), nullable=True))
    op.create_index("ix_facts_owner_origin", "facts", ["owner_id", "origin"])
    op.create_index("ix_facts_owner_deleted", "facts", ["owner_id", "deleted_at"])

    with op.batch_alter_table("todos") as batch:
        batch.add_column(
            sa.Column("origin", sa.String(length=16), nullable=False, server_default="bee")
        )
        batch.add_column(sa.Column("source_conversation_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("source_excerpt", sa.Text(), nullable=True))
        batch.add_column(sa.Column("due_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("postponed_until", sa.DateTime(), nullable=True))
        batch.add_column(
            sa.Column("ai_generated", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch.add_column(sa.Column("dedupe_key", sa.String(length=255), nullable=True))
        batch.add_column(
            sa.Column("approved", sa.Boolean(), nullable=False, server_default=sa.true())
        )
        batch.add_column(
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now())
        )
        batch.add_column(
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now())
        )
        batch.add_column(sa.Column("deleted_at", sa.DateTime(), nullable=True))
    op.create_index("ix_todos_owner_due", "todos", ["owner_id", "due_at"])
    op.create_index("ix_todos_owner_deleted", "todos", ["owner_id", "deleted_at"])

    op.create_table(
        "sync_tombstones",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("entity", sa.String(length=16), nullable=False),
        sa.Column("source_id", sa.BigInteger(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "owner_id", "entity", "source_id", name="uq_tombstone_owner_entity_source"
        ),
    )
    op.create_index("ix_tombstones_owner_entity", "sync_tombstones", ["owner_id", "entity"])

    op.create_table(
        "meetings",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=True),
        sa.Column("conversation_bee_id", sa.BigInteger(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("meeting_at", sa.DateTime(), nullable=True),
        sa.Column("participants", sa.JSON(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("key_points", sa.JSON(), nullable=True),
        sa.Column("decisions", sa.JSON(), nullable=True),
        sa.Column("action_items", sa.JSON(), nullable=True),
        sa.Column("source_kind", sa.String(length=32), nullable=False),
        sa.Column("ai_generated", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_meetings_owner_date", "meetings", ["owner_id", "meeting_at"])
    op.create_index(
        "ix_meetings_owner_conversation", "meetings", ["owner_id", "conversation_id"]
    )

    op.create_table(
        "learning_sets",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("source_kind", sa.String(length=32), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=True),
        sa.Column("conversation_bee_id", sa.BigInteger(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("goals", sa.JSON(), nullable=True),
        sa.Column("ai_generated", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_learning_sets_owner_created", "learning_sets", ["owner_id", "created_at"]
    )
    op.create_index(
        "ix_learning_sets_owner_conversation", "learning_sets", ["owner_id", "conversation_id"]
    )

    op.create_table(
        "learning_items",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("set_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("reviews", sa.Integer(), nullable=False),
        sa.Column("last_reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("ai_generated", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["set_id"], ["learning_sets.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_learning_items_set", "learning_items", ["set_id"])

    op.create_table(
        "knowledge_edges",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("from_type", sa.String(length=32), nullable=False),
        sa.Column("from_ref", sa.String(length=128), nullable=False),
        sa.Column("to_type", sa.String(length=32), nullable=False),
        sa.Column("to_ref", sa.String(length=128), nullable=False),
        sa.Column("relation", sa.String(length=64), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "owner_id",
            "from_type",
            "from_ref",
            "to_type",
            "to_ref",
            "relation",
            name="uq_knowledge_edge",
        ),
    )
    op.create_index("ix_knowledge_edges_owner", "knowledge_edges", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_knowledge_edges_owner", table_name="knowledge_edges")
    op.drop_table("knowledge_edges")
    op.drop_index("ix_learning_items_set", table_name="learning_items")
    op.drop_table("learning_items")
    op.drop_index("ix_learning_sets_owner_conversation", table_name="learning_sets")
    op.drop_index("ix_learning_sets_owner_created", table_name="learning_sets")
    op.drop_table("learning_sets")
    op.drop_index("ix_meetings_owner_conversation", table_name="meetings")
    op.drop_index("ix_meetings_owner_date", table_name="meetings")
    op.drop_table("meetings")
    op.drop_index("ix_tombstones_owner_entity", table_name="sync_tombstones")
    op.drop_table("sync_tombstones")

    op.drop_index("ix_todos_owner_deleted", table_name="todos")
    op.drop_index("ix_todos_owner_due", table_name="todos")
    with op.batch_alter_table("todos") as batch:
        batch.drop_column("deleted_at")
        batch.drop_column("updated_at")
        batch.drop_column("created_at")
        batch.drop_column("approved")
        batch.drop_column("dedupe_key")
        batch.drop_column("ai_generated")
        batch.drop_column("postponed_until")
        batch.drop_column("due_at")
        batch.drop_column("source_excerpt")
        batch.drop_column("source_conversation_id")
        batch.drop_column("origin")

    op.drop_index("ix_facts_owner_deleted", table_name="facts")
    op.drop_index("ix_facts_owner_origin", table_name="facts")
    with op.batch_alter_table("facts") as batch:
        batch.drop_column("deleted_at")
        batch.drop_column("updated_at")
        batch.drop_column("created_at")
        batch.drop_column("ai_generated")
        batch.drop_column("source_excerpt")
        batch.drop_column("source_conversation_id")
        batch.drop_column("source_kind")
        batch.drop_column("origin")
