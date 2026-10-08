"""Task-scoped persistence rules derived from trusted extension admission."""

from __future__ import annotations

from typing import Any

from deerflow_extension_api import (
    ExtensionData,
    MatterScopeBinding,
    TaskWriteGate,
    TaskWriteGateBinding,
    task_store_from_runtime,
)


def matter_scope_from_task_store(task_store: ExtensionData | None) -> MatterScopeBinding | None:
    """Return the trusted legal scope installed by task admission, if any."""
    return task_store.get(MatterScopeBinding) if task_store is not None else None


def matter_scope_from_runtime(runtime: object) -> MatterScopeBinding | None:
    """Read the admitted matter scope from a LangGraph runtime."""
    return matter_scope_from_task_store(task_store_from_runtime(runtime))


def task_write_gate_from_store(task_store: ExtensionData | None) -> TaskWriteGate | None:
    """Return the opaque write guard installed by trusted task admission."""
    binding = task_store.get(TaskWriteGateBinding) if task_store is not None else None
    return binding.gate if binding is not None else None


def task_write_gate_from_runtime(runtime: object) -> TaskWriteGate | None:
    """Read the opaque task write gate from LangGraph's admitted runtime."""
    return task_write_gate_from_store(task_store_from_runtime(runtime))


def resolve_task_scoped_store(store: Any | None, task_store: ExtensionData | None) -> Any | None:
    """Withhold the generic LangGraph Store from matter-scoped tasks.

    A matter-aware persistent namespace and lifecycle API have not been
    implemented. Returning ``None`` prevents generic Store reads/writes from
    bypassing the tenant/matter lifecycle until that contract exists.
    """
    return None if matter_scope_from_task_store(task_store) is not None else store
