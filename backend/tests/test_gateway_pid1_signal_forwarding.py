"""Deployment guards for graceful Gateway signal delivery."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_backend_dockerfile_execs_gateway_in_both_runtime_targets():
    dockerfile = (REPO_ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    gateway_cmds = [
        line
        for line in dockerfile.splitlines()
        if line.startswith("CMD ") and "uvicorn app.gateway.app:app" in line
    ]

    assert len(gateway_cmds) == 2
    assert all("exec " in command for command in gateway_cmds), gateway_cmds


def test_compose_gateway_commands_exec_runtime_for_signal_forwarding():
    compose_paths = (
        REPO_ROOT / "docker" / "docker-compose.yaml",
        REPO_ROOT / "docker" / "docker-compose.matrix-law-phase9-test.yaml",
        REPO_ROOT / "docker" / "docker-compose.matrix-law-phase10b.yaml",
    )

    checked: list[str] = []
    for path in compose_paths:
        gateway_commands = [
            line.strip()
            for line in path.read_text(encoding="utf-8").splitlines()
            if "command:" in line and "uvicorn app.gateway.app:app" in line
        ]
        for index, command_text in enumerate(gateway_commands, start=1):
            checked.append(f"{path.name}:{index}")
            assert "exec " in command_text, (
                f"{path.name} Gateway command leaves a shell as PID 1, so SIGTERM "
                f"cannot reach Uvicorn: {command_text}"
            )

    assert checked == [
        "docker-compose.yaml:1",
        "docker-compose.matrix-law-phase9-test.yaml:1",
        "docker-compose.matrix-law-phase10b.yaml:1",
    ]
