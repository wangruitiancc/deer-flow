"""Real-Postgres concurrency verification for top-level run capacity."""

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

SCHEMA = "phase10i_capacity"


@dataclass
class Admission:
    manager: RunManager
    record: object | None = None
    rejection_scope: str | None = None


async def wave(managers: list[RunManager], specs: list[tuple[str, str]]) -> list[Admission]:
    start = asyncio.Event()

    async def one(index: int, thread_id: str, user_id: str) -> Admission:
        await start.wait()
        manager = managers[index % len(managers)]
        try:
            record = await manager.create_or_reject(thread_id, user_id=user_id)
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
    url = os.environ["DATABASE_URL"]
    await init_engine("postgres", url=url, postgres_schema=SCHEMA, pool_size=8)
    session_factory = get_session_factory()
    assert session_factory is not None
    repository = RunRepository(session_factory)

    global_config = RunCapacityConfig(max_active_global=3, max_active_per_user=2)
    global_managers = [
        RunManager(store=repository, worker_id=f"gateway-{index}", run_capacity_config=global_config)
        for index in range(4)
    ]
    seed = await global_managers[0].create_or_reject(
        "seed-thread",
        user_id="user-a",
        idempotency_key="seed-idempotency-key",
    )
    first_wave = await wave(
        global_managers,
        [(f"global-thread-{index}", f"user-{'a' if index % 2 == 0 else 'b'}") for index in range(12)],
    )
    first_accepted = [item for item in first_wave if item.record is not None]
    assert len(first_accepted) == 2
    assert sum(item.rejection_scope is not None for item in first_wave) == 10

    # Cross-manager retry must resolve the existing run before checking a full cap.
    retried = await global_managers[3].create_or_reject(
        "seed-thread",
        user_id="user-a",
        idempotency_key="seed-idempotency-key",
    )
    assert retried.run_id == seed.run_id
    assert retried.idempotency_reused is True

    await global_managers[0].set_status(seed.run_id, RunStatus.success)
    await terminalize(first_accepted)

    user_config = RunCapacityConfig(max_active_global=10, max_active_per_user=2)
    user_managers = [
        RunManager(store=repository, worker_id=f"user-gateway-{index}", run_capacity_config=user_config)
        for index in range(4)
    ]
    user_wave = await wave(user_managers, [(f"user-thread-{index}", "user-c") for index in range(8)])
    user_accepted = [item for item in user_wave if item.record is not None]
    assert len(user_accepted) == 2
    assert [item.rejection_scope for item in user_wave].count("user") == 6
    await terminalize(user_accepted)

    replacement_config = RunCapacityConfig(max_active_global=1, max_active_per_user=1)
    owner = RunManager(store=repository, worker_id="owner", run_capacity_config=replacement_config)
    peer = RunManager(store=repository, worker_id="peer", run_capacity_config=replacement_config)
    original = await owner.create_or_reject("replacement-thread", user_id="user-d")
    replacement = await peer.create_or_reject(
        "replacement-thread",
        user_id="user-d",
        multitask_strategy="interrupt",
    )
    original_row = await repository.get(original.run_id, user_id="user-d")
    assert original_row is not None and original_row["status"] == "interrupted"

    engine = get_engine()
    assert engine is not None
    async with engine.connect() as connection:
        active_count = await connection.scalar(
            text("SELECT count(*) FROM runs WHERE status IN ('pending', 'running') AND operation_kind = 'run'")
        )
    assert active_count == 1

    print(
        json.dumps(
            {
                "global_limit": 3,
                "global_seed": 1,
                "global_concurrent_attempts": 12,
                "global_concurrent_admitted": len(first_accepted),
                "global_concurrent_rejected": 10,
                "idempotent_retry_reused_at_full_capacity": True,
                "per_user_limit": 2,
                "same_user_concurrent_attempts": 8,
                "same_user_admitted": len(user_accepted),
                "same_user_rejected": 6,
                "interrupt_replacement_at_full_capacity": True,
                "final_active_runs": active_count,
                "replacement_run_id_distinct": replacement.run_id != original.run_id,
            },
            indent=2,
        )
    )

    async with engine.begin() as connection:
        await connection.execute(text(f'DROP SCHEMA "{SCHEMA}" CASCADE'))
    await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
