"""Matrix Law tenant admission performed before a run row is persisted."""

from __future__ import annotations

import hashlib
import inspect
import os
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from functools import wraps
from typing import Any

from fastapi import HTTPException

from deerflow.runtime.user_context import get_effective_user_id

_TENANT_KEY_DOMAIN = b"matrix-law-run-tenant-v1\0"
_PRODUCT_REQUIRED_ENV = "MATRIX_LAW_PRODUCT_REQUIRED"


def matrix_law_product_required() -> bool:
    """Return whether this process must expose only the Matrix Law product."""
    return os.environ.get(_PRODUCT_REQUIRED_ENV, "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _matter_admissions(extensions: Any) -> list[Any]:
    from matrix_law_extension.runtime import MatterContextAdmission

    return [contributor for _source, contributor in getattr(extensions, "task_admission", ()) if isinstance(contributor, MatterContextAdmission)]


@asynccontextmanager
async def matrix_law_thread_write_scope(request: Any, *, thread_id: str, user_id: str | None) -> AsyncIterator[None]:
    """Fence a host-owned thread-file mutation against tenant data exit."""
    extensions = getattr(getattr(getattr(request, "app", None), "state", None), "extensions", None)
    admissions = _matter_admissions(extensions) if extensions is not None else []
    if not admissions:
        if matrix_law_product_required():
            raise HTTPException(status_code=503, detail="Legal workspace write gate is unavailable")
        yield
        return
    if len(admissions) != 1:
        raise HTTPException(status_code=503, detail="Legal workspace write gate is unavailable")

    from matrix_law_extension.runtime.context import (
        MatterContextAdmissionError,
        TenantWriteGateUnavailableError,
        TenantWritesFrozenError,
    )

    try:
        gate = await admissions[0].write_gate_for_thread(thread_id=thread_id, user_id=user_id)
    except MatterContextAdmissionError:
        raise HTTPException(status_code=403, detail="Thread is not authorized for legal workspace writes") from None
    except TenantWriteGateUnavailableError:
        raise HTTPException(status_code=503, detail="Legal workspace write gate is unavailable") from None

    try:
        async with gate.hold(operation="workspace_tool_write"):
            yield
    except TenantWritesFrozenError:
        raise HTTPException(status_code=423, detail="Thread writes are frozen for data exit") from None
    except TenantWriteGateUnavailableError:
        raise HTTPException(status_code=503, detail="Legal workspace write gate is unavailable") from None


def gate_matrix_law_thread_write[FunctionT: Callable[..., Any]](function: FunctionT) -> FunctionT:
    """Wrap a permission-checked Gateway thread write in the legal tenant gate."""

    signature = inspect.signature(function)

    @wraps(function)
    async def wrapped(*args: Any, **kwargs: Any) -> Any:
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        request = bound.arguments["request"]
        thread_id = str(bound.arguments["thread_id"])
        async with matrix_law_thread_write_scope(
            request,
            thread_id=thread_id,
            user_id=get_effective_user_id(),
        ):
            return await function(*args, **kwargs)

    return wrapped  # type: ignore[return-value]


def validate_matrix_law_product(extensions: Any) -> None:
    """Abort product startup unless exactly one legal admission is loaded."""
    if not matrix_law_product_required():
        return
    admissions = _matter_admissions(extensions)
    if len(admissions) != 1:
        raise RuntimeError("Matrix Law requires exactly one legal-work-context admission service")


def validate_matrix_law_runtime_config(app_config: Any) -> None:
    """Reject an uncoordinated Redis copy of legal checkpoint history."""
    if not matrix_law_product_required():
        return
    database = getattr(app_config, "database", None)
    cache = getattr(database, "checkpoint_cache", None)
    if getattr(database, "checkpoint_channel_mode", "full") == "delta" and getattr(cache, "type", "memory") == "redis" and getattr(cache, "max_entries", 0) > 0:
        raise RuntimeError("Matrix Law cannot enable Redis delta checkpoint history cache without tenant write fencing")


def matrix_law_manages_model_selection(extensions: Any) -> bool:
    """Return whether the legal admission delegates model authorization upstream.

    The generic host allowlist remains authoritative for ordinary DeerFlow
    deployments. Matrix Law may accept a synchronized model name only when its
    sole trusted admission service confirms that the controlled model runtime
    is enabled. Task admission and the capability Gateway then perform the
    tenant/member/deployment checks before constructing a model client.
    """

    if not matrix_law_product_required():
        return False
    admissions = _matter_admissions(extensions)
    return len(admissions) == 1 and admissions[0].controlled_models_enabled is True


def validate_matrix_law_run_request(body: Any) -> None:
    """Reject custom/generic agent selection in the Matrix Law product."""
    if not matrix_law_product_required():
        return

    assistant_id = getattr(body, "assistant_id", None)
    if assistant_id not in {None, "lead_agent"}:
        raise ValueError("Matrix Law runs only its dedicated legal agent")

    context = getattr(body, "context", None)
    config = getattr(body, "config", None)
    configurable = config.get("configurable") if isinstance(config, dict) else None
    for candidate in (context, configurable):
        if isinstance(candidate, dict) and candidate.get("agent_name") not in {None, ""}:
            raise ValueError("Matrix Law does not allow custom agent selection")


async def resolve_tenant_capacity_key(
    extensions: Any,
    *,
    thread_id: str,
    user_id: str | None,
) -> str | None:
    """Return a privacy-preserving key for the thread's trusted legal tenant.

    Matrix Law's task admission remains the authorization authority. Reusing
    that same service here avoids a second, generic extension abstraction and
    makes tenant isolation an explicit property of this legal product.
    """
    from matrix_law_extension.runtime import TrustedMatterContext

    admissions = _matter_admissions(extensions)
    if not admissions:
        if matrix_law_product_required():
            raise RuntimeError("Matrix Law legal-work-context admission is required")
        return None
    if len(admissions) != 1:
        raise RuntimeError("Matrix Law must register exactly one legal-work-context admission service")

    context = await admissions[0].resolve_run_context(thread_id=thread_id, user_id=user_id)
    if not isinstance(context, TrustedMatterContext):
        raise PermissionError("Legal run context is not trusted")
    return hashlib.sha256(_TENANT_KEY_DOMAIN + context.tenant_id.encode("utf-8")).hexdigest()
