"""Public lifecycle ports avoid extension imports of host path internals."""

from types import SimpleNamespace

import pytest
from deerflow_extension_api import ExtensionRuntimeDeps

from deerflow.extensions.gateway import start_services


def test_workspace_root_is_optional_for_older_extension_hosts():
    assert ExtensionRuntimeDeps().workspace_root is None


@pytest.mark.asyncio
async def test_host_binds_its_workspace_root_before_starting_extensions(monkeypatch, tmp_path):
    received = []

    class Service:
        async def start(self, deps):
            received.append(deps)

    monkeypatch.setattr("deerflow.config.paths.get_paths", lambda: SimpleNamespace(base_dir=tmp_path))
    loaded = SimpleNamespace(services=[("synthetic", Service())], app_store=object())
    assert await start_services(loaded, SimpleNamespace(), None) == []
    assert received[0].workspace_root == tmp_path
