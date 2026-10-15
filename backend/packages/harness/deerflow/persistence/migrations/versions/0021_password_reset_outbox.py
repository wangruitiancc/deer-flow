"""durable encrypted password-reset mail outbox.

Revision ID: 0021_password_reset_outbox
Revises: 0020_admin_mfa
Create Date: 2026-10-12
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021_password_reset_outbox"
down_revision: str | Sequence[str] | None = "0020_admin_mfa"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    if not sa.inspect(op.get_bind()).has_table("password_reset_outbox"):
        op.create_table(
            "password_reset_outbox",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("token_version", sa.Integer(), nullable=False),
            sa.Column("purpose", sa.String(length=32), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("recipient", sa.String(length=320), nullable=True),
            sa.Column("token_ciphertext", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
            sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.CheckConstraint("purpose = 'password_reset'", name="ck_password_reset_outbox_purpose"),
            sa.CheckConstraint("status IN ('queued', 'sending')", name="ck_password_reset_outbox_status"),
        )
        op.create_index("ix_password_reset_outbox_due", "password_reset_outbox", ["status", "next_attempt_at"])
        op.create_index("ix_password_reset_outbox_user_id", "password_reset_outbox", ["user_id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("password_reset_outbox"):
        indexes = {index["name"] for index in inspector.get_indexes("password_reset_outbox")}
        if "ix_password_reset_outbox_user_id" in indexes:
            op.drop_index("ix_password_reset_outbox_user_id", table_name="password_reset_outbox")
        if "ix_password_reset_outbox_due" in indexes:
            op.drop_index("ix_password_reset_outbox_due", table_name="password_reset_outbox")
        op.drop_table("password_reset_outbox")
