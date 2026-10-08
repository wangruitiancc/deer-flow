"""Fail-closed dispatch for security-sensitive extension task admission."""

from __future__ import annotations

import asyncio
from typing import Any

from deerflow_extension_api import ExtensionData, TaskInfo

from deerflow.extensions.notify import get_extension_notify_loop
from deerflow.extensions.registry import LoadedExtensions


async def _admit_each(
    contributors: tuple[tuple[str, Any], ...],
    app_store: ExtensionData,
    task_store: ExtensionData,
    info: TaskInfo,
    timeout: float | None,
) -> None:
    loop = asyncio.get_running_loop()
    deadline = None if timeout is None else loop.time() + timeout
    for _source, contributor in contributors:
        call = contributor.admit_task(app_store, task_store, info)
        if deadline is None:
            await call
            continue
        remaining = deadline - loop.time()
        if remaining <= 0:
            close = getattr(call, "close", None)
            if callable(close):
                close()
            raise TimeoutError(f"Task admission timed out for {info.task_id}")
        await asyncio.wait_for(call, remaining)


async def admit_task(
    extensions: LoadedExtensions,
    task_store: ExtensionData,
    info: TaskInfo,
    *,
    timeout: float | None = None,
) -> None:
    """Run every admission contributor; any failure aborts the task."""
    admission = _admit_each(
        extensions.task_admission,
        extensions.app_store,
        task_store,
        info,
        timeout,
    )
    owner_loop = get_extension_notify_loop()
    current_loop = asyncio.get_running_loop()
    if owner_loop is None or owner_loop is current_loop:
        await admission
        return
    if not owner_loop.is_running():
        admission.close()
        raise RuntimeError("Extension runtime loop is not running")

    try:
        future = asyncio.run_coroutine_threadsafe(admission, owner_loop)
    except BaseException:
        admission.close()
        raise
    wrapped = asyncio.wrap_future(future)
    try:
        if timeout is None:
            await wrapped
        else:
            await asyncio.wait_for(wrapped, timeout)
    except BaseException:
        future.cancel()
        raise
