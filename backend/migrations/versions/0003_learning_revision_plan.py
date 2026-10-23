"""Learning revision plan.

Revision ID: 0003_learning_revision_plan
Revises: 0002_phase2
Create Date: 2026-10-23

Additive only: one nullable JSON column. Existing learning sets keep all their
data and simply start with no revision plan. Batch mode keeps the migration
portable between SQLite and MySQL 8.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_learning_revision_plan"
down_revision: Union[str, None] = "0002_phase2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("learning_sets") as batch:
        batch.add_column(sa.Column("revision_plan", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("learning_sets") as batch:
        batch.drop_column("revision_plan")
