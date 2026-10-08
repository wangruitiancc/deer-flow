"""add anonymized run tenant capacity key.

Revision ID: 0019_run_tenant_capacity
Revises: 0018_oauth_identity_pg_partial
Create Date: 2026-09-05
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from deerflow.persistence.migrations._helpers import safe_add_column, safe_drop_column

revision: str = "0019_run_tenant_capacity"
down_revision: str | Sequence[str] | None = "0018_oauth_identity_pg_partial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "runs"
_INDEX = "ix_runs_tenant_capacity_status"


def _index_exists() -> bool:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(_TABLE):
        return False
    return any(index.get("name") == _INDEX for index in inspector.get_indexes(_TABLE))


def upgrade() -> None:
    safe_add_column(_TABLE, sa.Column("tenant_capacity_key", sa.String(length=64), nullable=True))
    if sa.inspect(op.get_bind()).has_table(_TABLE) and not _index_exists():
        op.create_index(_INDEX, _TABLE, ["tenant_capacity_key", "status"], unique=False)


def downgrade() -> None:
    if _index_exists():
        op.drop_index(_INDEX, table_name=_TABLE)
    safe_drop_column(_TABLE, "tenant_capacity_key")
