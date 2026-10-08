"""Create isolated host and Matrix Law schemas before black-box startup."""

from __future__ import annotations

import asyncio
import os
import subprocess

from deerflow.persistence.engine import close_engine, init_engine


async def prepare_host_schema() -> None:
    await init_engine(
        "postgres",
        url=os.environ["DATABASE_URL"],
        postgres_schema=os.environ["MATRIX_LAW_DATABASE_SCHEMA"],
        pool_size=2,
    )
    await close_engine()


def main() -> None:
    asyncio.run(prepare_host_schema())
    subprocess.run(
        ["/app/backend/.venv/bin/matrix-law-migrate", "upgrade", "head"],
        check=True,
        env=os.environ.copy(),
    )
    print("host_migration_head=0019_run_tenant_capacity")
    print("matrix_law_migrations_applied=head (inspect law_alembic_version for the actual revision)")


if __name__ == "__main__":
    main()
