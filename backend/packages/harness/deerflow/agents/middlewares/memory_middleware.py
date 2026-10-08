"""Middleware for memory mechanism."""

import asyncio
import logging
from typing import TYPE_CHECKING, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langgraph.config import get_config
from langgraph.runtime import Runtime

from deerflow.agents.memory import get_memory_manager
from deerflow.config.memory_config import get_memory_config
from deerflow.runtime.task_scope import matter_scope_from_runtime
from deerflow.runtime.user_context import resolve_runtime_user_id
from deerflow.trace_context import DEERFLOW_TRACE_METADATA_KEY, resolve_trace_id

if TYPE_CHECKING:
    from deerflow.config.memory_config import MemoryConfig

logger = logging.getLogger(__name__)


def _has_controlled_model_runtime(runtime: Runtime) -> bool:
    """Whether a trusted admission installed a task-only model authority.

    The legacy memory manager debounces extraction onto a timer thread. It
    cannot safely carry a tenant signing authority across that detached
    lifetime, so controlled tasks fail closed by skipping that legacy model
    call rather than silently using the host provider credentials.
    """

    try:
        from deerflow_extension_api import ControlledModelRuntimeBinding, task_store_from_runtime

        task_store = task_store_from_runtime(runtime)
        return task_store is not None and (task_store.get(ControlledModelRuntimeBinding) is not None or matter_scope_from_runtime(runtime) is not None)
    except Exception:
        # A contract import failure is not a reason to weaken the normal
        # memory path. The controlled extension admission itself is fail closed.
        return False


class MemoryMiddlewareState(AgentState):
    """Compatible with the `ThreadState` schema."""

    pass


class MemoryMiddleware(AgentMiddleware[MemoryMiddlewareState]):
    """Middleware that queues conversation for memory update after agent execution.

    This middleware:
    1. After each agent execution, queues the conversation for memory update
    2. Only includes user inputs and final assistant responses (ignores tool calls)
    3. The queue uses debouncing to batch multiple updates together
    4. Memory is updated asynchronously via LLM summarization
    """

    state_schema = MemoryMiddlewareState

    def __init__(self, agent_name: str | None = None, *, memory_config: "MemoryConfig | None" = None):
        """Initialize the MemoryMiddleware.

        Args:
            agent_name: If provided, memory is stored per-agent. If None, uses global memory.
            memory_config: Explicit memory config. When omitted, legacy global
                config fallback is used.
        """
        super().__init__()
        self._agent_name = agent_name
        self._memory_config = memory_config

    def _resolve_add_args(self, state: MemoryMiddlewareState, runtime: Runtime) -> tuple[str, list, str, str] | None:
        """Resolve one write request without invoking the manager."""
        config = self._memory_config or get_memory_config()
        if not config.enabled:
            return None

        if _has_controlled_model_runtime(runtime):
            # This is intentionally a post-agent safety boundary, not an
            # observer or an admission precheck. CP-02 does not permit the
            # timer-backed global memory model to bypass the Gateway.
            logger.info("Skipping legacy deferred memory extraction for controlled or matter-scoped task")
            return None

        # Get thread ID from runtime context first, then fall back to LangGraph's configurable metadata
        thread_id = runtime.context.get("thread_id") if runtime.context else None
        if thread_id is None:
            config_data = get_config()
            thread_id = config_data.get("configurable", {}).get("thread_id")
        if not thread_id:
            logger.debug("No thread_id in context, skipping memory update")
            return None

        # Get messages from state
        messages = state.get("messages", [])
        if not messages:
            logger.debug("No messages in state, skipping memory update")
            return None

        # Capture user_id at enqueue time while the request context is still alive.
        # threading.Timer fires on a different thread where ContextVar values are not
        # propagated, so we must store user_id explicitly in ConversationContext.
        user_id = resolve_runtime_user_id(runtime)
        # The memory update fires on a threading.Timer thread that inherits no
        # ContextVars, so the id is captured here, while the request context is
        # still alive, and carried as data. The runtime context is authoritative
        # (worker._bind_trace_id always fills it); the ambient fallback covers
        # embedded callers driving the agent outside a Gateway run.
        runtime_context = runtime.context if isinstance(runtime.context, dict) else {}
        trace_id = resolve_trace_id(runtime_context.get(DEERFLOW_TRACE_METADATA_KEY))

        return thread_id, messages, user_id, trace_id

    @override
    def after_agent(self, state: MemoryMiddlewareState, runtime: Runtime) -> dict | None:
        """Queue conversation for memory update after agent completes."""
        add_args = self._resolve_add_args(state, runtime)
        if add_args is None:
            return None
        thread_id, messages, user_id, trace_id = add_args

        # Hand raw messages to the manager; the backend filters to user + final-AI
        # turns, validates, detects correction/reinforcement, and enqueues.
        get_memory_manager().add(
            thread_id,
            messages,
            agent_name=self._agent_name,
            user_id=user_id,
            trace_id=trace_id,
        )

        return None

    @override
    async def aafter_agent(self, state: MemoryMiddlewareState, runtime: Runtime) -> dict | None:
        """Use the manager's async boundary on LangGraph's async execution path."""
        add_args = self._resolve_add_args(state, runtime)
        if add_args is None:
            return None
        thread_id, messages, user_id, trace_id = add_args
        manager = await asyncio.to_thread(get_memory_manager)
        await manager.aadd(
            thread_id,
            messages,
            agent_name=self._agent_name,
            user_id=user_id,
            trace_id=trace_id,
        )
        return None
