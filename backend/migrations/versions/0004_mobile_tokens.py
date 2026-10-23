"""Mobile companion bearer tokens.

Revision ID: 0004_mobile_tokens
Revises: 0003_learning_revision_plan
Create Date: 2026-10-23

Additive only: a new table for hashed phone pairing tokens. Existing users and
data are untouched. The raw token is never stored.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_mobile_tokens"
down_revision: Union[str, None] = "0003_learning_revision_plan"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mobile_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("device_name", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_mobile_tokens_owner", "mobile_tokens", ["owner_id"])
    op.create_index("ix_mobile_tokens_expiry", "mobile_tokens", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_mobile_tokens_expiry", table_name="mobile_tokens")
    op.drop_index("ix_mobile_tokens_owner", table_name="mobile_tokens")
    op.drop_table("mobile_tokens")
