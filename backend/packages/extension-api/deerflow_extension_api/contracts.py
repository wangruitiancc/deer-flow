"""The extension contracts and their data types.

Compatibility rules enforced throughout this module:
  * every Protocol method carries a default implementation, so adding a method
    later stays additive for already-released extensions;
  * every optional dataclass field carries a default, so adding a field stays
    additive.
"""

from __future__ import annotations

import ssl
from collections.abc import Awaitable, Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal, Protocol, TypeVar, runtime_checkable

from deerflow_extension_api.state import ExtensionData

if TYPE_CHECKING:  # pragma: no cover - typing only
    from deerflow_extension_api.assembly import AgentAssemblyObserver
    from deerflow_extension_api.compaction import ContextCompactionObserver
    from deerflow_extension_api.placement import AgentBuildContext, MiddlewarePlacement

F = TypeVar("F", bound=Callable[..., Any])


# --- Host projections -------------------------------------------------------


@dataclass(frozen=True)
class HostPolicySnapshot:
    """The limits the host actually enforces, projected for extensions.

    A narrow projection instead of the host's AppConfig: exposing AppConfig
    would pin every extension to the harness release cadence. Every field has
    a default so widening this stays additive.
    """

    token_budget_enabled: bool = False
    max_input_tokens: int | None = None
    max_output_tokens: int | None = None
    max_total_tokens: int | None = None
    budget_warn_fraction: float | None = None
    budget_hard_fraction: float | None = None
    max_subagents_per_run: int | None = None


# --- Task lifecycle ---------------------------------------------------------


class TaskOutcome(StrEnum):
    COMPLETED = "completed"
    ABORTED = "aborted"
    FAILED = "failed"


@dataclass(frozen=True)
class TaskInfo:
    """Identity of one lead-agent or subagent execution."""

    task_id: str
    run_id: str
    thread_id: str
    kind: Literal["lead", "subagent"]
    parent_task_id: str | None = None
    agent_name: str | None = None
    resumed: bool = False
    user_id: str | None = None


@dataclass(frozen=True, slots=True)
class MatterScopeBinding:
    """Trusted tenant/matter scope resolved for one legal task.

    The host uses this binding to prevent generic user-global persistence from
    crossing legal matter boundaries. It carries identifiers only; admission
    code must resolve and authorize them before placing the value in task state.
    """

    tenant_id: str
    matter_id: str
    thread_id: str


class TaskWriteGate(Protocol):
    """Opaque extension-owned guard for a short task-scoped persistent write."""

    def hold(
        self,
        *,
        operation: Literal["run_stream_publish", "workspace_tool_write"],
    ) -> AbstractAsyncContextManager[None]:
        """Hold the domain write gate until the enclosed side effect completes."""

        ...


@dataclass(frozen=True)
class TaskWriteGateBinding:
    """Task-store binding for a host write path that must honor a domain gate."""

    gate: TaskWriteGate


class TaskAdmissionContributor(Protocol):
    """Fail-closed admission hook for security-sensitive task context.

    Any exception, timeout, or dispatch failure aborts the task. Use ordinary
    task lifecycle hooks for observations that must remain fail-open.
    """

    async def admit_task(
        self,
        app_store: ExtensionData,
        task_store: ExtensionData,
        info: TaskInfo,
    ) -> None:
        return None


class AccountInvitationClaimHandler(Protocol):
    """Validate and consume email-bound invitations during account creation.

    The Gateway owns password hashing, account creation and the session
    cookie. A trusted extension uses this narrow hook to bind the resulting
    identity to its invitation without exposing an unauthenticated contributed
    route. Implementations must compare the address and one-time token, fence
    replays, and never log either value.
    """

    async def is_claimable(self, *, email: str, token: str) -> bool:
        return False

    async def claim(self, *, email: str, user_id: str, token: str) -> bool:
        return False


class TaskLifecycleContributor(Protocol):
    async def on_task_start(
        self,
        app_store: ExtensionData,
        task_store: ExtensionData,
        info: TaskInfo,
    ) -> None:
        return None

    async def on_task_stop(
        self,
        app_store: ExtensionData,
        task_store: ExtensionData,
        info: TaskInfo,
        outcome: TaskOutcome,
    ) -> None:
        return None


# --- Controlled model execution -------------------------------------------


@dataclass(frozen=True)
class ControlledGatewayTransport:
    """Opaque, extension-owned TLS transport for a controlled Gateway.

    The extension builds an ``SSLContext`` from its own secret-file references
    (including an mTLS client certificate).  DeerFlow only attaches that
    already-built context to its HTTP clients; it never receives PEM content,
    paths, passwords, or provider credentials in a prompt, header, checkpoint
    or persisted runtime configuration.
    """

    ssl_context: ssl.SSLContext | None = field(default=None, repr=False, compare=False)
    require_https: bool = True


@runtime_checkable
class ControlledModelRuntime(Protocol):
    """Task-scoped, opaque authority for a controlled model gateway.

    The host only consumes this narrow bridge while constructing models and
    issuing provider HTTP requests. Implementations keep signing material and
    tenant/member identity in task memory; neither is copied to a Runnable
    config, prompt, checkpoint, tool result, or extension observer payload.
    """

    @property
    def gateway_base_url(self) -> str:
        return ""

    @property
    def deployment_identity(self) -> DeploymentIdentityClaim | None:
        """Optional opaque remote-service identity projection.

        The host may observe this for compatibility checks but must never use
        it as a substitute for the runtime's signed request headers. A vertical
        extension owns enrollment, key material, tenant policy, and admission.
        """

        return None

    @property
    def gateway_transport(self) -> ControlledGatewayTransport | None:
        """Optional non-serializable transport for this runtime's Gateway.

        A ``None`` result preserves the legacy host behavior.  A runtime that
        supplies this projection must use HTTPS and a verified ``SSLContext``;
        the host rejects string/dict substitutes so certificate material cannot
        be smuggled through a general-purpose configuration surface.
        """

        return None

    def allows_model(self, model_name: str) -> bool:
        return False

    def request_headers(
        self,
        *,
        model_name: str,
        purpose: str,
        call_id: str,
        attempt_id: str,
    ) -> Mapping[str, str]:
        return {}

    def request_headers_for_request(
        self,
        *,
        model_name: str,
        purpose: str,
        call_id: str,
        attempt_id: str,
        request_method: str,
        request_path: str,
        request_body: bytes,
    ) -> Mapping[str, str]:
        """Mint headers after the final HTTP request body exists.

        A remote capability server can bind a short-lived assertion to the
        actual method/path/body rather than only an earlier logical call id.
        The default preserves older extension behavior unchanged.
        """

        del request_method, request_path, request_body
        # A previously released runtime may be merely structurally compatible
        # and therefore have no method at all on the bare object used by the
        # contract checks.  Conversely, a runtime that inherited the Protocol
        # can override the older method and should retain that behavior.
        legacy_headers = getattr(self, "request_headers", None)
        if not callable(legacy_headers):
            return {}
        return legacy_headers(
            model_name=model_name,
            purpose=purpose,
            call_id=call_id,
            attempt_id=attempt_id,
        )


@dataclass(frozen=True)
class DeploymentIdentityClaim:
    """Non-secret generic projection of a remote runtime deployment identity.

    It is intentionally only descriptive: an extension must still return a
    short-lived signed assertion per request, and the capability Gateway must
    check status, rotation, revocation and liveness itself.
    """

    issuer: str = ""
    tenant_id: str = ""
    deployment_id: str = ""
    identity_key_version: int = 0
    audience: str = "matrixflow-capability-gateway"


@dataclass(frozen=True)
class ControlledModelRuntimeBinding:
    """Typed task-store bridge; the concrete runtime stays extension-owned."""

    runtime: ControlledModelRuntime


# --- Controlled MCP execution ---------------------------------------------


@dataclass(frozen=True)
class ManagedMcpTool:
    """Tenant-safe tool metadata projected by the capability server.

    This intentionally has no endpoint, credential, adapter, price, or secret
    reference.  ``tool_id`` is the platform versioned tool identity used by
    the opaque runtime, rather than a caller-selected MCP server address.
    """

    tool_id: str
    name: str
    description: str = ""
    execution_mode: Literal["immediate", "durable"] = "immediate"
    effects: Literal["read", "write"] = "read"
    risk: Literal["low", "high"] = "low"


@runtime_checkable
class ControlledMcpRuntime(Protocol):
    """Task-scoped, extension-owned managed MCP authority.

    The host supplies only correlation identifiers derived from the live run.
    Implementations own mTLS, short service/deployment assertions, policy
    snapshots and remote handles; local MCP configuration is never a fallback
    while this binding is active.
    """

    async def catalog(self) -> Sequence[ManagedMcpTool]:
        return ()

    async def call(
        self,
        *,
        tool_id: str,
        arguments: Mapping[str, Any],
        root_run_id: str,
        run_id: str,
        call_id: str,
        attempt_id: str,
    ) -> Mapping[str, Any]:
        return {"status": "denied"}

    async def poll(
        self,
        *,
        task_id: str,
        root_run_id: str,
        run_id: str,
        call_id: str,
        attempt_id: str,
    ) -> Mapping[str, Any]:
        return {"status": "denied"}

    async def cancel(
        self,
        *,
        task_id: str,
        root_run_id: str,
        run_id: str,
        call_id: str,
        attempt_id: str,
    ) -> Mapping[str, Any]:
        return {"status": "denied"}


@dataclass(frozen=True)
class ControlledMcpRuntimeBinding:
    """Typed task-store bridge for a managed MCP runtime."""

    runtime: ControlledMcpRuntime


# --- Managed Skill projection ----------------------------------------------


@dataclass(frozen=True)
class ManagedSkillFile:
    """One already-authorized file from a signed platform package projection."""

    path: str
    sha256: str
    content: bytes


@dataclass(frozen=True)
class ManagedSkillPackage:
    """Fixed-version package material for one admitted task/run.

    The extension verifies the Gateway signature envelope before exposing this
    object.  It intentionally carries no artifact ref, URL, command, endpoint,
    credential, or installer input.
    """

    skill_id: str
    version: str
    package_sha256: str
    files: Sequence[ManagedSkillFile]


@dataclass(frozen=True)
class ManagedSkillDescriptor:
    """Catalog metadata for one platform Skill without package bytes."""

    skill_id: str
    version: str
    package_sha256: str
    description: str = ""
    allowed_tools: Sequence[str] | None = None


@runtime_checkable
class ManagedSkillRuntime(Protocol):
    """Extension-owned authority for task-scoped platform Skill bytes."""

    async def catalog(self) -> Sequence[ManagedSkillDescriptor]:
        return ()

    async def package(
        self,
        *,
        skill_id: str,
        version: str,
        package_sha256: str,
    ) -> ManagedSkillPackage:
        raise NotImplementedError

    async def packages(self) -> Sequence[ManagedSkillPackage]:
        return ()


@dataclass(frozen=True)
class ManagedSkillRuntimeBinding:
    """Typed task-store bridge. Presence forbids all local Skill discovery."""

    runtime: ManagedSkillRuntime


# --- System model calls not wrapped by middleware model-call hooks ----------


class SystemOperationKind(StrEnum):
    GOAL = "goal"
    MEMORY = "memory"
    TITLE = "title"
    SUMMARIZATION = "summarization"


@dataclass(frozen=True)
class SystemModelRequest:
    """Read-only snapshot taken before a system-owned model call."""

    messages: Sequence[Any] = ()
    model_name: str | None = None
    invoke_config: Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        """Normalize ``messages`` to a tuple so the snapshot is what it claims to be.

        Call sites differ: goal evaluation and memory extraction pass a message list,
        while title generation and summarization pass one prompt string. A bare ``str``
        already satisfies ``Sequence``, so without this an observer iterating
        ``request.messages`` would silently walk characters. Copying a list also makes
        the frozen snapshot immutable in fact, not only by dataclass declaration — the
        caller keeps its own list and observations may run after the call returns.
        """
        messages = self.messages
        if isinstance(messages, tuple):
            return
        normalized = tuple(messages) if isinstance(messages, Sequence) and not isinstance(messages, str | bytes) else (messages,)
        object.__setattr__(self, "messages", normalized)


@dataclass(frozen=True)
class SystemModelResult:
    """Success or failure snapshot taken after a system-owned model call."""

    response: Any | None = None
    error: BaseException | None = None
    duration_ms: float | None = None


class SystemModelCallObserver(Protocol):
    async def on_system_model_call(
        self,
        app_store: ExtensionData,
        task_store: ExtensionData,
        kind: SystemOperationKind,
        request: SystemModelRequest,
        result: SystemModelResult,
    ) -> None:
        return None


# --- Middleware -------------------------------------------------------------


class MiddlewareContributor(Protocol):
    def contribute_middlewares(
        self,
        app_store: ExtensionData,
        ctx: AgentBuildContext,
    ) -> Sequence[MiddlewarePlacement]:
        return ()


# --- Extension services ----------------------------------------------------


class BackgroundWorkerMetrics(Protocol):
    """Low-cardinality host recorder for extension-owned background workers.

    Worker names and provider classes are fixed product-owned enums;
    implementations must never attach tenant, matter, user, task, provider
    names/endpoints, or credential data.
    """

    def record_background_worker_batch(
        self,
        *,
        worker: str,
        claimed_jobs: int,
        duration_seconds: float,
        failed: bool = False,
    ) -> None:
        return None

    def record_background_worker_queue(
        self,
        *,
        worker: str,
        queue_depth: int,
        oldest_task_age_seconds: float,
        failed: bool = False,
    ) -> None:
        """Record one aggregate, identity-free pending queue observation.

        A failed observation increments diagnostics while preserving the last
        successful gauges. Worker names remain a fixed product-owned enum.
        """
        return None

    def record_ocr_provider_outcome(self, *, provider_class: str, outcome: str) -> None:
        """Record one OCR processor attempt using bounded categorical labels."""
        return None


@dataclass(frozen=True)
class ExtensionRuntimeDeps:
    """Host capabilities bound after Gateway infrastructure is ready."""

    app_store: ExtensionData | None = None
    policy: HostPolicySnapshot = field(default_factory=HostPolicySnapshot)
    session_factory: Any | None = None
    # Full current UTF-8 output via host sandbox authorization/path resolution.
    # Budget is checked after reading; no immutable snapshot or approval implied.
    read_output_text: Callable[[Any, str, int], Awaitable[str]] | None = None
    # New host-named output only; (runtime, content, suffix) -> virtual path.
    # No implicit publication, persistence transaction or replay guarantee.
    create_output_text: Callable[[Any, str, str], Awaitable[str]] | None = None
    # Actual native publisher, including callbacks/delivery attribution.
    present_output_files: Callable[[Any, list[str]], Awaitable[Any]] | None = None
    # Current runtime's uploads only; exact bytes, bounded local read. Remote
    # provider transfer is checked after download, not allocation-bounded.
    read_uploaded_bytes: Callable[[Any, str, int], Awaitable[bytes]] | None = None
    # New host-named binary output; retains native write limits and read-back.
    create_output_bytes: Callable[[Any, bytes, str], Awaitable[str]] | None = None
    # Optional low-cardinality host metrics for background workers.
    worker_metrics: BackgroundWorkerMetrics | None = None
    # Trusted host path for reviewed lifecycle adapters; never model/client input.
    workspace_root: Path | None = None
    # Single owner-bootstrap identity operation. The host injects it only into
    # the trusted Matrix Law bootstrap service, never into other extensions.
    ensure_owner_bootstrap_identity: Callable[[str, str], Awaitable[Any | None]] | None = None


class ExtensionService(Protocol):
    async def start(self, deps: ExtensionRuntimeDeps) -> None:
        return None

    async def stop(self) -> None:
        return None


# --- Registration surface ---------------------------------------------------


@runtime_checkable
class ExtensionRegistry(Protocol):
    """The write-only registration surface handed to ``install()``.

    Structural and minimal on purpose. Every method has a default so additive
    contract releases remain compatible with older registry implementations.
    The host's concrete registry additionally carries host-only machinery
    (attribution, positional rollback, build) that is deliberately absent here.
    """

    def middlewares(self, contributor: MiddlewareContributor) -> None:
        return None

    def task_admission(self, contributor: TaskAdmissionContributor) -> None:
        return None

    def task_lifecycle(self, contributor: TaskLifecycleContributor) -> None:
        return None

    def system_model_observer(self, observer: SystemModelCallObserver) -> None:
        return None

    def agent_assembly_observer(self, observer: AgentAssemblyObserver) -> None:
        return None

    def context_compaction_observer(self, observer: ContextCompactionObserver) -> None:
        return None

    def service(self, service: ExtensionService) -> None:
        return None

    def account_invitation_claim_handler(self, handler: AccountInvitationClaimHandler) -> None:
        """Register one invite-only account claim handler for host auth."""
        return None

    def routers(self, routers: Sequence[Any]) -> None:
        """Register HTTP routers constructed eagerly during extension install.

        Router types stay ``Any`` so this contract package has no FastAPI
        dependency. The host validates supported route shapes before mounting;
        runtime resources belong in a separately registered service.
        """
        return None


#: The install() entry point signature every extension exposes.
ExtensionInstall = Callable[[ExtensionRegistry, Mapping[str, Any]], None]


# --- Declaration decorator --------------------------------------------------


def extension(*, api: str, name: str | None = None) -> Callable[[F], F]:
    """Stamp an install function with the API version it was written against.

    Optional. pip's dependency resolution is the primary compatibility
    mechanism; this covers `--no-deps` installs and editable monorepo checkouts
    where versions can skew, and turns a deep AttributeError into an
    actionable startup diagnostic.
    """

    def _decorate(func: F) -> F:
        func.__deerflow_api__ = api  # type: ignore[attr-defined]
        func.__deerflow_name__ = name  # type: ignore[attr-defined]
        return func

    return _decorate
