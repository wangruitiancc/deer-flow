"""Host-owned authorized native file capabilities for trusted extensions."""

from __future__ import annotations

import os
import re
import stat
from pathlib import Path
from typing import Any
from uuid import uuid4


async def create_output_text(runtime: Any, content: str, suffix: str) -> str:
    """Create and verify one new host-named UTF-8 output, without publication.

    No caller-selected path or overwrite. Reuses sandbox scope, lifecycle, local
    resolution and the native per-file operation lock. That lock is process-local,
    not a distributed exclusive-create guarantee. Uncertain failures/cancellation
    may leave an unpresented file; callers must not declare this replay-safe.
    """
    if suffix not in {".md", ".txt", ".json"} or not isinstance(content, str):
        raise ValueError("Invalid text output")
    encoded = content.encode("utf-8")
    if len(encoded) > 64 * 1024:
        raise ValueError("Text output exceeds byte budget")
    return await create_output_bytes(runtime, encoded, suffix)


async def create_output_bytes(runtime: Any, content: bytes, suffix: str) -> str:
    """Create and read back exact bytes; no publication or replay guarantee.

    Compound extensions are allowed, paths are not. The host hard ceiling is
    16 MiB and the existing native write budget can further restrict payloads.
    """
    if not isinstance(content, bytes) or not isinstance(suffix, str) or not re.fullmatch(r"(?:\.[a-z][a-z0-9_-]{0,31}){1,3}", suffix):
        raise ValueError("Invalid binary output")
    if len(content) > 16 * 1024 * 1024:
        raise ValueError("Binary output exceeds byte budget")
    encoded = content
    from deerflow.runtime.task_scope import task_write_gate_from_runtime
    from deerflow.sandbox import tools
    from deerflow.sandbox.lease import run_sync_lifecycle_operation

    native_limit = tools._effective_write_file_max_bytes()
    if native_limit > 0 and len(encoded) > native_limit:
        raise ValueError("Output exceeds native write budget")

    virtual_path = f"/mnt/user-data/outputs/draft-{uuid4().hex}{suffix}"

    def create():
        from deerflow.tools.builtins.present_file_tool import _normalize_presented_filepath

        sandbox = tools.ensure_sandbox_initialized(runtime)
        tools.ensure_thread_directories_exist(runtime)
        normalized = _normalize_presented_filepath(runtime, virtual_path)
        path = normalized
        local = tools.is_local_sandbox(runtime)
        if local:
            thread_data = tools.get_thread_data(runtime)
            tools.validate_local_tool_path(path, thread_data)
            path = tools._resolve_and_validate_user_data_path(path, thread_data)
        with tools.get_file_operation_lock(sandbox, path):
            try:
                sandbox.read_file(path)
            except FileNotFoundError:
                pass
            else:
                # Error-as-text, unknown state and existing files all fail closed.
                raise FileExistsError("Output target is not confirmed absent")
            # Native byte transport preserves CRLF/BOM and literal virtual paths;
            # model-facing text readers/writers may normalize or translate them.
            sandbox.update_file(path, encoded)
            actual = Path(path).read_bytes() if local else sandbox.download_file(path)
            if actual != encoded:
                raise OSError("Output byte verification failed")
        return normalized

    async with tools.sandbox_authorization_scope_async(runtime):
        await tools.ensure_sandbox_initialized_async(runtime)
        gate = task_write_gate_from_runtime(runtime)
        if gate is None:
            return await run_sync_lifecycle_operation(create)
        async with gate.hold(operation="workspace_tool_write"):
            return await run_sync_lifecycle_operation(create)


async def read_uploaded_bytes(runtime: Any, path: str, max_bytes: int) -> bytes:
    """Read a regular upload in the native runtime's user/thread scope.

    Local reads reject symlink components and read at most budget + 1 bytes.
    Remote download_file enforces the provider's own containment rules; the
    returned bytes are checked after transfer, not under an allocation cap.
    This is a current read, not an immutable upload or legal approval receipt.
    """
    prefix = "/mnt/user-data/uploads/"
    if not isinstance(path, str) or not path.startswith(prefix) or "\\" in path or any(ord(char) < 32 for char in path):
        raise ValueError("Invalid upload path")
    parts = path[len(prefix) :].split("/")
    if any(not part or part.startswith(".") for part in parts):
        raise ValueError("Invalid upload path")
    if type(max_bytes) is not int or not 0 < max_bytes <= 16 * 1024 * 1024:
        raise ValueError("Invalid upload byte budget")
    from deerflow.sandbox import tools
    from deerflow.sandbox.lease import run_sync_lifecycle_operation

    def read():
        from deerflow.config.paths import get_paths
        from deerflow.runtime.user_context import resolve_runtime_user_id

        thread_id = tools._resolve_runtime_thread_id(runtime)
        thread_data = tools.get_thread_data(runtime)
        if not thread_id or not thread_data or not thread_data.get("uploads_path"):
            raise PermissionError("Upload runtime scope unavailable")
        paths = get_paths()
        user_id = resolve_runtime_user_id(runtime)
        root = paths.sandbox_uploads_dir(thread_id, user_id=user_id)
        if Path(thread_data["uploads_path"]).resolve() != root.resolve():
            raise PermissionError("Upload runtime scope mismatch")
        sandbox = tools.ensure_sandbox_initialized(runtime)
        if tools.is_local_sandbox(runtime):
            tools.validate_local_tool_path(path, thread_data, read_only=True)
            resolved = Path(tools._resolve_and_validate_user_data_path(path, thread_data))
            if not resolved.is_relative_to(root.resolve()):
                raise PermissionError("Upload escaped current uploads directory")
            # Anchor traversal to directory descriptors, rejecting links even
            # when swapped after resolution; O_NONBLOCK avoids waiting on FIFOs.
            directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                for part in parts[:-1]:
                    next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory_fd)
                    os.close(directory_fd)
                    directory_fd = next_fd
                file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
                with os.fdopen(file_fd, "rb") as stream:
                    if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                        raise OSError("Upload is not a regular file")
                    content = stream.read(max_bytes + 1)
            finally:
                os.close(directory_fd)
        else:
            content = sandbox.download_file(path)
        if not isinstance(content, bytes):
            raise OSError("Upload bytes unavailable")
        if len(content) > max_bytes:
            raise ValueError("Upload exceeds byte budget")
        return content

    async with tools.sandbox_authorization_scope_async(runtime):
        await tools.ensure_sandbox_initialized_async(runtime)
        return await run_sync_lifecycle_operation(read)


async def read_output_text(runtime: Any, path: str, max_bytes: int) -> str:
    """Read current UTF-8 output text without display truncation.

    Uses the native publisher's path normalization and the sandbox's own reader.
    The byte budget is checked after the provider read; it is not a provider I/O
    memory limit. Callers must not treat returned text as an immutable snapshot.
    """
    if type(max_bytes) is not int or not 0 < max_bytes <= 16 * 1024 * 1024:
        raise ValueError("Invalid output text budget")
    from deerflow.sandbox.lease import run_sync_lifecycle_operation
    from deerflow.sandbox.tools import ensure_sandbox_initialized_async, read_current_file_content, sandbox_authorization_scope_async

    def read():
        from deerflow.tools.builtins.present_file_tool import _normalize_presented_filepath

        normalized = _normalize_presented_filepath(runtime, path)
        content = read_current_file_content(runtime, normalized)
        if not isinstance(content, str) or content.startswith("Error:"):
            raise OSError("Output text unavailable")
        if len(content.encode("utf-8")) > max_bytes:
            raise ValueError("Output text exceeds byte budget")
        return content

    async with sandbox_authorization_scope_async(runtime):
        await ensure_sandbox_initialized_async(runtime)
        return await run_sync_lifecycle_operation(read)


async def present_output_files(runtime: Any, paths: list[str]) -> Any:
    """Invoke native present_files including callbacks for delivery attribution.

    Domain checks belong to the calling extension; this is a trusted host port,
    not a model-facing alternative publisher or automatic legal approval.
    """
    from deerflow.sandbox.tools import sandbox_authorization_scope_async
    from deerflow.tools.builtins.present_file_tool import present_file_tool

    async with sandbox_authorization_scope_async(runtime):
        return await present_file_tool.ainvoke(
            {"name": "present_files", "type": "tool_call", "id": runtime.tool_call_id, "args": {"runtime": runtime, "filepaths": paths}},
            config=getattr(runtime, "config", None),
        )
