"""Shared MCP tool-runtime identity extraction.

This stays separate from ``mcp.tools`` so managed MCP code can use the same
LangGraph context/config semantics without importing the local MCP loader.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from langgraph.config import get_config


def extract_thread_id(runtime: Any | None) -> str:
    """Extract a thread id from runtime context, runtime config, or graph config."""
    if runtime is not None:
        context = getattr(runtime, "context", None)
        tid = context.get("thread_id") if isinstance(context, Mapping) else None
        if tid is not None:
            return str(tid)
        config = getattr(runtime, "config", None) or {}
        configurable = config.get("configurable", {}) if isinstance(config, Mapping) else {}
        tid = configurable.get("thread_id") if isinstance(configurable, Mapping) else None
        if tid is not None:
            return str(tid)

    try:
        configurable = get_config().get("configurable", {})
        tid = configurable.get("thread_id") if isinstance(configurable, Mapping) else None
        return str(tid) if tid is not None else "default"
    except RuntimeError:
        return "default"
