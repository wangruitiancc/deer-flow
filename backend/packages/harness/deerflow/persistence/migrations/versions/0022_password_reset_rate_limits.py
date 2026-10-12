"""share password-reset request rate limits across Gateway workers.

Revision ID: 0022_password_reset_rate_limits
Revises: 0021_password_reset_outbox
Create Date: 2026-10-12
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022_password_reset_rate_limits"
down_revision: str | Sequence[str] | None = "0021_password_reset_outbox"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    if not sa.inspect(op.get_bind()).has_table("password_reset_rate_limits"):
        op.create_table(
            "password_reset_rate_limits",
            sa.Column("bucket_key", sa.String(length=70), nullable=False),
            sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("request_count", sa.Integer(), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("bucket_key"),
        )
        op.create_index("ix_password_reset_rate_limits_expires_at", "password_reset_rate_limits", ["expires_at"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("password_reset_rate_limits"):
        indexes = {index["name"] for index in inspector.get_indexes("password_reset_rate_limits")}
        if "ix_password_reset_rate_limits_expires_at" in indexes:
            op.drop_index("ix_password_reset_rate_limits_expires_at", table_name="password_reset_rate_limits")
        op.drop_table("password_reset_rate_limits")
