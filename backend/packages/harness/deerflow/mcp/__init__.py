"""MCP (Model Context Protocol) integration using langchain-mcp-adapters."""

from .cache import (
    get_cached_mcp_tools,
    initialize_mcp_tools,
    reset_mcp_tools_cache,
)
from .client import build_server_params, build_servers_config


async def get_mcp_tools():
    """Load MCP tools lazily to keep the managed-runtime bridge acyclic."""

    from .tools import get_mcp_tools as load

    return await load()


__all__ = [
    "build_server_params",
    "build_servers_config",
    "get_mcp_tools",
    "initialize_mcp_tools",
    "get_cached_mcp_tools",
    "reset_mcp_tools_cache",
]
