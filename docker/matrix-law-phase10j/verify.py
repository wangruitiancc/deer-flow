"""Real-Postgres concurrency verification for Matrix Law tenant capacity."""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass

from sqlalchemy import text

from deerflow.config.run_capacity_config import RunCapacityConfig
from deerflow.persistence.engine import close_engine, get_engine, get_session_factory, init_engine
from deerflow.persistence.run import RunRepository
from deerflow.runtime import RunCapacityExceeded, RunManager, RunStatus

SCHEMA = "phase10j_tenant_capacity"


@dataclass
class Admission:
    manager: RunManager
    record: object | None = None
    rejection_scope: str | None = None


async def wave(
    managers: list[RunManager],
    specs: list[tuple[str, str, str | None]],
) -> list[Admission]:
    start = asyncio.Event()

    async def one(index: int, thread_id: str, user_id: str, tenant_key: str | None) -> Admission:
        await start.wait()
        manager = managers[index % len(managers)]
        try:
            record = await manager.create_or_reject(
                thread_id,
                user_id=user_id,
                tenant_capacity_key=tenant_key,
            )
            return Admission(manager=manager, record=record)
        except RunCapacityExceeded as exc:
            return Admission(manager=manager, rejection_scope=exc.scope)

    tasks = [asyncio.create_task(one(index, *spec)) for index, spec in enumerate(specs)]
    start.set()
    return await asyncio.gather(*tasks)


async def terminalize(admissions: list[Admission]) -> None:
    for admission in admissions:
        if admission.record is not None:
            await admission.manager.set_status(admission.record.run_id, RunStatus.success)


async def main() -> None:
    await init_engine(
        "postgres",
        url=os.environ["DATABASE_URL"],
        postgres_schema=SCHEMA,
        pool_size=8,
    )
    session_factory = get_session_factory()
    assert session_factory is not None
    repository = RunRepository(session_factory)
    config = RunCapacityConfig(
        max_active_global=6,
        max_active_per_tenant=2,
        max_active_per_user=4,
    )
    managers = [
        RunManager(store=repository, worker_id=f"gateway-{index}", run_capacity_config=config)
        for index in range(4)
    ]

    tenant_a = await wave(
        managers,
        [(f"tenant-a-thread-{index}", f"tenant-a-user-{index}", "tenant-a-key") for index in range(8)],
    )
    tenant_a_accepted = [item for item in tenant_a if item.record is not None]
    assert len(tenant_a_accepted) == 2
    assert [item.rejection_scope for item in tenant_a].count("tenant") == 6

    # A saturated tenant must not consume another tenant's independent limit.
    tenant_b = await wave(
        managers,
        [(f"tenant-b-thread-{index}", f"tenant-b-user-{index}", "tenant-b-key") for index in range(3)],
    )
    tenant_b_accepted = [item for item in tenant_b if item.record is not None]
    assert len(tenant_b_accepted) == 2
    assert [item.rejection_scope for item in tenant_b].count("tenant") == 1

    # Low-level internal operations without a tenant key do not collapse into
    # one synthetic NULL bucket. Public Matrix Law requests never take this
    # path: their Gateway admission requires a trusted matter mapping.
    unmapped = await wave(
        managers,
        [("internal-unscoped-thread", "internal-user", None)],
    )
    assert len([item for item in unmapped if item.record is not None]) == 1

    engine = get_engine()
    assert engine is not None
    async with engine.connect() as connection:
        active_count = await connection.scalar(
            text("SELECT count(*) FROM runs WHERE status IN ('pending', 'running') AND operation_kind = 'run'")
        )
        tenant_keys = (
            await connection.execute(
                text("SELECT DISTINCT tenant_capacity_key FROM runs WHERE tenant_capacity_key IS NOT NULL")
            )
        ).scalars().all()
        version = await connection.scalar(text("SELECT version_num FROM alembic_version"))
    assert active_count == 5
    assert sorted(tenant_keys) == ["tenant-a-key", "tenant-b-key"]
    assert version == "0019_run_tenant_capacity"

    await terminalize(tenant_a_accepted + tenant_b_accepted + unmapped)
    print(
        json.dumps(
            {
                "migration_head": version,
                "global_limit": 6,
                "per_tenant_limit": 2,
                "tenant_a_attempts": 8,
                "tenant_a_admitted": len(tenant_a_accepted),
                "tenant_a_rejected_by_tenant_limit": 6,
                "tenant_b_attempts_while_tenant_a_full": 3,
                "tenant_b_admitted": len(tenant_b_accepted),
                "tenant_b_rejected_by_tenant_limit": 1,
                "unmapped_admitted": 1,
                "active_before_cleanup": active_count,
                "tenant_keys_persisted": len(tenant_keys),
            },
            indent=2,
        )
    )

    async with engine.begin() as connection:
        await connection.execute(text(f'DROP SCHEMA "{SCHEMA}" CASCADE'))
    await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
