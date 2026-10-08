from contextlib import asynccontextmanager

import pytest

from deerflow.runtime.stream_bridge import END_SENTINEL, MemoryStreamBridge
from deerflow.runtime.stream_bridge.write_gated import WriteGatedStreamBridge


class _Gate:
    def __init__(self):
        self.frozen = False
        self.active = 0

    @asynccontextmanager
    async def hold(self, *, operation):
        assert operation == "run_stream_publish"
        if self.frozen:
            raise PermissionError("frozen")
        self.active += 1
        try:
            yield
        finally:
            self.active -= 1


@pytest.mark.asyncio
async def test_stream_content_is_published_inside_gate_and_end_remains_available():
    gate = _Gate()
    bridge = WriteGatedStreamBridge(MemoryStreamBridge(), gate)

    await bridge.publish("run-1", "messages", {"text": "synthetic"})
    assert gate.active == 0
    gate.frozen = True
    with pytest.raises(PermissionError, match="frozen"):
        await bridge.publish("run-1", "messages", {"text": "blocked"})

    await bridge.publish_end("run-1")
    items = [item async for item in bridge.subscribe("run-1")]
    assert [item.event for item in items if hasattr(item, "event")] == ["messages", "__end__"]
    assert items[-1] is END_SENTINEL or items[-1].event == END_SENTINEL.event
