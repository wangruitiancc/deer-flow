"""store encrypted admin MFA state and one-use recovery-code digests.

Revision ID: 0020_admin_mfa
Revises: 0019_run_tenant_capacity
Create Date: 2026-10-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from deerflow.persistence.migrations._helpers import safe_add_column, safe_drop_column

revision: str = "0020_admin_mfa"
down_revision: str | Sequence[str] | None = "0019_run_tenant_capacity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    safe_add_column("users", sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    safe_add_column("users", sa.Column("mfa_secret_ciphertext", sa.Text(), nullable=True))
    safe_add_column("users", sa.Column("mfa_last_counter", sa.Integer(), nullable=False, server_default=sa.text("-1")))
    safe_add_column("users", sa.Column("mfa_challenge_id", sa.String(length=64), nullable=True))
    inspector = sa.inspect(op.get_bind())
    if "users" not in inspector.get_table_names() or "user_mfa_recovery_codes" in inspector.get_table_names():
        return
    op.create_table(
        "user_mfa_recovery_codes",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "code_hash"),
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "user_mfa_recovery_codes" in inspector.get_table_names():
        op.drop_table("user_mfa_recovery_codes")
    safe_drop_column("users", "mfa_challenge_id")
    safe_drop_column("users", "mfa_last_counter")
    safe_drop_column("users", "mfa_secret_ciphertext")
    safe_drop_column("users", "mfa_enabled")
