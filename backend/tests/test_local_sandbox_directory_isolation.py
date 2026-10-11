from types import SimpleNamespace

import pytest

from deerflow.config.sandbox_config import SandboxConfig
from deerflow.runtime.user_context import _current_user, reset_current_user, set_current_user
from deerflow.sandbox.local.local_sandbox import LocalSandbox, PathMapping
from deerflow.sandbox.local.local_sandbox_provider import LocalSandboxProvider
from deerflow.sandbox.security import is_host_bash_allowed


@pytest.fixture
def directory_provider(monkeypatch, tmp_path):
    config = SimpleNamespace(sandbox=SandboxConfig(use="deerflow.sandbox.local:LocalSandboxProvider", directory_isolation=True))
    monkeypatch.setattr("deerflow.config.get_app_config", lambda: config)
    monkeypatch.setattr(LocalSandboxProvider, "_setup_path_mappings", lambda self: [])
    monkeypatch.setattr(LocalSandboxProvider, "_ensure_skills_projection", lambda *args, **kwargs: None)

    def mappings(self, thread_id, *, user_id, skill_projection):
        root = tmp_path / user_id / thread_id
        root.mkdir(parents=True, exist_ok=True)
        return [PathMapping("/mnt/user-data", str(root))]

    monkeypatch.setattr(LocalSandboxProvider, "_build_thread_path_mappings", mappings)
    return LocalSandboxProvider()


def test_users_cannot_reuse_each_others_cached_sandbox(directory_provider):
    alice = set_current_user(SimpleNamespace(id="alice"))
    try:
        sandbox_id = directory_provider.acquire("same-thread", user_id="alice")
        sandbox = directory_provider.get(sandbox_id)
        sandbox.write_file("/mnt/user-data/note.txt", "alice")
    finally:
        reset_current_user(alice)
    bob = set_current_user(SimpleNamespace(id="bob"))
    try:
        assert directory_provider.get(sandbox_id) is None
        with pytest.raises(PermissionError):
            sandbox.read_file("/mnt/user-data/note.txt")
        with pytest.raises(PermissionError):
            directory_provider.acquire("same-thread", user_id="alice")
        bob_id = directory_provider.acquire("same-thread")
        assert bob_id != sandbox_id
        other = directory_provider.get(bob_id)
        other.write_file("/mnt/user-data/note.txt", "bob")
        assert other.read_file("/mnt/user-data/note.txt") == "bob"
    finally:
        reset_current_user(bob)
    alice = set_current_user(SimpleNamespace(id="alice"))
    try:
        assert sandbox.read_file("/mnt/user-data/note.txt") == "alice"
    finally:
        reset_current_user(alice)


def test_directory_provider_requires_authenticated_thread(directory_provider):
    token = _current_user.set(None)
    try:
        with pytest.raises(RuntimeError, match="without user context"):
            directory_provider.acquire("thread", user_id="alice")
    finally:
        reset_current_user(token)
    token = set_current_user(SimpleNamespace(id="alice"))
    try:
        with pytest.raises(PermissionError, match="thread_required"):
            directory_provider.acquire()
        assert directory_provider.get("local") is None
    finally:
        reset_current_user(token)


@pytest.mark.parametrize("path", ["/etc/passwd", "relative.txt", "/mnt/user-data/../../other.txt", "/mnt/user-data-extra/note.txt"])
def test_directory_sandbox_rejects_unmapped_and_traversal_paths(tmp_path, path):
    token = set_current_user(SimpleNamespace(id="alice"))
    try:
        sandbox = LocalSandbox("scope", [PathMapping("/mnt/user-data", str(tmp_path))], directory_user_id="alice")
        with pytest.raises(PermissionError):
            sandbox._resolve_path(path)
        with pytest.raises(PermissionError):
            sandbox._resolve_path(str(tmp_path / "note.txt"))
    finally:
        reset_current_user(token)


def test_directory_sandbox_rejects_symlink_escape_and_skill_writes(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("synthetic")
    (workspace / "escape").symlink_to(outside, target_is_directory=True)
    token = set_current_user(SimpleNamespace(id="alice"))
    try:
        sandbox = LocalSandbox("scope", [PathMapping("/mnt/user-data", str(workspace)), PathMapping("/mnt/skills", str(outside), read_only=True)], directory_user_id="alice")
        with pytest.raises(PermissionError):
            sandbox.read_file("/mnt/user-data/escape/secret.txt")
        with pytest.raises(OSError) as error:
            sandbox.write_file("/mnt/skills/secret.txt", "changed")
        assert error.value.errno == 30
        with pytest.raises(PermissionError, match="commands_disabled"):
            sandbox.execute_command("true")
        assert (outside / "secret.txt").read_text() == "synthetic"
    finally:
        reset_current_user(token)


@pytest.mark.parametrize("extra", [{"allow_host_bash": True}, {"image": "any-image"}, {"mounts": [{"host_path": "/etc", "container_path": "/mnt/other"}]}, {"environment": {"PATH": "/usr/bin"}}])
def test_directory_provider_rejects_unsafe_configuration(monkeypatch, extra):
    config = SimpleNamespace(sandbox=SandboxConfig(use="deerflow.sandbox.local:LocalSandboxProvider", directory_isolation=True, **extra))
    monkeypatch.setattr("deerflow.config.get_app_config", lambda: config)
    with pytest.raises(ValueError, match="unsafe_configuration"):
        LocalSandboxProvider()
    assert not is_host_bash_allowed(config)
