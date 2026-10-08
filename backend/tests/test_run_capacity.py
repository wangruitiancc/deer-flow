"""Top-level Agent run admission capacity contracts."""

import pytest
from pydantic import ValidationError

from deerflow.config.run_capacity_config import RunCapacityConfig
from deerflow.runtime import RunCapacityExceeded, RunManager, RunStatus, ThreadOperationKind
from deerflow.runtime.runs.store.memory import MemoryRunStore


@pytest.mark.anyio
async def test_per_user_capacity_isolated_between_users() -> None:
    manager = RunManager(
        store=MemoryRunStore(),
        run_capacity_config=RunCapacityConfig(max_active_global=3, max_active_per_user=1),
    )
    await manager.create_or_reject("thread-a", user_id="user-a")

    with pytest.raises(RunCapacityExceeded) as caught:
        await manager.create_or_reject("thread-b", user_id="user-a")
    assert caught.value.scope == "user"
    assert caught.value.limit == 1

    other = await manager.create_or_reject("thread-c", user_id="user-b")
    assert other.user_id == "user-b"


@pytest.mark.anyio
async def test_per_tenant_capacity_isolated_between_legal_tenants() -> None:
    manager = RunManager(
        store=MemoryRunStore(),
        run_capacity_config=RunCapacityConfig(max_active_global=4, max_active_per_tenant=2),
    )
    await manager.create_or_reject("matter-a-1", user_id="user-a", tenant_capacity_key="tenant-a-key")
    await manager.create_or_reject("matter-a-2", user_id="user-b", tenant_capacity_key="tenant-a-key")

    with pytest.raises(RunCapacityExceeded) as caught:
        await manager.create_or_reject("matter-a-3", user_id="user-c", tenant_capacity_key="tenant-a-key")
    assert caught.value.scope == "tenant"
    assert caught.value.limit == 2

    other_tenant = await manager.create_or_reject(
        "matter-b-1",
        user_id="user-c",
        tenant_capacity_key="tenant-b-key",
    )
    assert other_tenant.tenant_capacity_key == "tenant-b-key"


@pytest.mark.anyio
async def test_internal_unscoped_run_does_not_share_a_null_tenant_bucket() -> None:
    manager = RunManager(
        store=MemoryRunStore(),
        run_capacity_config=RunCapacityConfig(max_active_global=3, max_active_per_tenant=1),
    )
    await manager.create_or_reject("internal-a", user_id="user-a")
    admitted = await manager.create_or_reject("internal-b", user_id="user-b")

    assert admitted.tenant_capacity_key is None


@pytest.mark.anyio
async def test_global_capacity_releases_after_terminal_status() -> None:
    manager = RunManager(
        store=MemoryRunStore(),
        run_capacity_config=RunCapacityConfig(max_active_global=2),
    )
    first = await manager.create_or_reject("thread-a", user_id="user-a")
    await manager.create_or_reject("thread-b", user_id="user-b")

    with pytest.raises(RunCapacityExceeded, match="scope=global limit=2"):
        await manager.create_or_reject("thread-c", user_id="user-c")

    await manager.set_status(first.run_id, RunStatus.success)
    admitted = await manager.create_or_reject("thread-c", user_id="user-c")
    assert admitted.status == RunStatus.pending


@pytest.mark.anyio
async def test_idempotent_retry_reuses_run_even_when_capacity_is_full() -> None:
    manager = RunManager(
        store=MemoryRunStore(),
        run_capacity_config=RunCapacityConfig(max_active_global=1),
    )
    original = await manager.create_or_reject("thread-a", user_id="user-a", idempotency_key="request-1")
    retried = await manager.create_or_reject("thread-a", user_id="user-a", idempotency_key="request-1")

    assert retried.run_id == original.run_id
    assert retried.idempotency_reused is True


@pytest.mark.anyio
async def test_interrupt_replacement_does_not_need_an_extra_capacity_slot() -> None:
    manager = RunManager(
        store=MemoryRunStore(),
        run_capacity_config=RunCapacityConfig(max_active_global=1),
    )
    original = await manager.create_or_reject("thread-a", user_id="user-a")
    replacement = await manager.create_or_reject("thread-a", user_id="user-a", multitask_strategy="interrupt")

    assert replacement.run_id != original.run_id
    assert (await manager.get(original.run_id)).status == RunStatus.interrupted


@pytest.mark.anyio
async def test_non_run_thread_reservation_does_not_consume_run_capacity() -> None:
    manager = RunManager(
        store=MemoryRunStore(),
        run_capacity_config=RunCapacityConfig(max_active_global=1),
    )

    async with manager.reserve_thread_operation("maintenance", kind=ThreadOperationKind.artifact_write, user_id="user-a"):
        admitted = await manager.create_or_reject("thread-a", user_id="user-a")

    assert admitted.status == RunStatus.pending


@pytest.mark.anyio
async def test_storeless_manager_enforces_the_same_capacity_contract() -> None:
    manager = RunManager(run_capacity_config=RunCapacityConfig(max_active_global=1))
    await manager.create_or_reject("thread-a", user_id="user-a")

    with pytest.raises(RunCapacityExceeded):
        await manager.create_or_reject("thread-b", user_id="user-b")


def test_capacity_config_rejects_per_user_limit_above_global_limit() -> None:
    with pytest.raises(ValidationError):
        RunCapacityConfig(max_active_global=2, max_active_per_user=3)


def test_capacity_config_rejects_per_tenant_limit_above_global_limit() -> None:
    with pytest.raises(ValidationError):
        RunCapacityConfig(max_active_global=2, max_active_per_tenant=3)
