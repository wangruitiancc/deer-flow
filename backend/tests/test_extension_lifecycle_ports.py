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
    ensure_owner_bootstrap_identity = object()

    class Service:
        def __init__(self, *, owner_bootstrap=False):
            self.requires_owner_bootstrap_identity = owner_bootstrap

        async def start(self, deps):
            received.append(deps)

    monkeypatch.setattr("deerflow.config.paths.get_paths", lambda: SimpleNamespace(base_dir=tmp_path))
    loaded = SimpleNamespace(
        services=[
            ("matrix-law", Service(owner_bootstrap=True)),
            ("matrix_law_extension:install", Service(owner_bootstrap=True)),
            ("matrix-law", Service()),
            ("synthetic", Service(owner_bootstrap=True)),
        ],
        app_store=object(),
    )
    assert (
        await start_services(
            loaded,
            SimpleNamespace(),
            None,
            ensure_owner_bootstrap_identity=ensure_owner_bootstrap_identity,
        )
        == []
    )
    assert received[0].workspace_root == tmp_path
    assert received[0].ensure_owner_bootstrap_identity is ensure_owner_bootstrap_identity
    assert received[1].ensure_owner_bootstrap_identity is ensure_owner_bootstrap_identity
    assert received[2].ensure_owner_bootstrap_identity is None
    assert received[3].ensure_owner_bootstrap_identity is None
