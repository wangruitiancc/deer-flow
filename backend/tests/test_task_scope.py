from deerflow_extension_api import ExtensionData, MatterScopeBinding, TaskWriteGateBinding
from deerflow_extension_api.runtime_bridge import EXTENSION_TASK_STORE_KEY

from deerflow.runtime.task_scope import (
    matter_scope_from_runtime,
    resolve_task_scoped_store,
    task_write_gate_from_runtime,
    task_write_gate_from_store,
)


def test_resolve_task_scoped_store_withholds_generic_store_for_matter_task():
    store = object()
    task_store = ExtensionData("legal-task")
    binding = MatterScopeBinding(tenant_id="tenant-1", matter_id="matter-1", thread_id="thread-1")
    task_store.set(binding)

    runtime = type("Runtime", (), {"context": {EXTENSION_TASK_STORE_KEY: task_store}})()
    assert resolve_task_scoped_store(store, task_store) is None
    assert matter_scope_from_runtime(runtime) == binding


def test_resolve_task_scoped_store_preserves_store_for_unscoped_task():
    store = object()

    assert resolve_task_scoped_store(store, None) is store


def test_task_write_gate_is_read_only_from_admitted_task_store():
    gate = object()
    task_store = ExtensionData("legal-task")
    task_store.set(TaskWriteGateBinding(gate))

    assert task_write_gate_from_store(task_store) is gate
    assert task_write_gate_from_store(None) is None
    runtime = type("Runtime", (), {"context": {EXTENSION_TASK_STORE_KEY: task_store}})()
    assert task_write_gate_from_runtime(runtime) is gate
