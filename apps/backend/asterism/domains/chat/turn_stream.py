"""What a chat's turn sends to its open tabs: packets, text increments and approval prompts (ADR-0084)."""

from __future__ import annotations

import asyncio
import uuid
from logging import Logger
from typing import TYPE_CHECKING

from asterism.common.log import get_logger
from asterism.domains.agent.schemas import AgentEventType, SubAgentEventEnvelope
from asterism.domains.chat.message_queue import MessageQueue, get_message_queue
from asterism.domains.chat.schemas import Chat
from asterism.domains.chat.text_streams import TextStreams
from asterism.domains.llm.schemas import ToolCall

if TYPE_CHECKING:
    from asterism.domains.agent.user_response_queue import UserResponseQueue


class TurnStream:
    """A chat's outgoing stream: every packet goes through :meth:`_emit` to the chat's queue.

    Comparison runs tag their packets with the column they answer. Text streams
    send increments, and keep what each sent for tabs that join or fall behind.
    Tool approvals are asked here and answered by :meth:`resolve_tool_approval`.
    """

    def __init__(self, chat: Chat) -> None:
        self.chat: Chat = chat
        self.logger: Logger = get_logger("ChatSession")
        self.pending_approvals: dict[str, asyncio.Future] = {}
        # What each open text stream has sent, for increments and for tabs
        # that join or fall behind (ADR-0084).
        self._text_streams = TextStreams()
        # US-54.4: identifies the comparison column the current run answers.
        self._comparison: dict[str, str] | None = None

    @property
    def queue(self) -> MessageQueue:
        return get_message_queue(self.chat.info.id)

    @property
    def chat_id(self) -> uuid.UUID:
        return self.chat.info.id

    @property
    def user_id(self) -> str:
        return self.chat.info.user_id

    async def _emit_sub_agent(self, envelope: SubAgentEventEnvelope) -> None:
        """A sub-agent's event; its text deltas become increments of the child's stream (ADR-0084)."""
        outer = {"type": "sub_agent", **envelope.model_dump(mode="json", exclude={"event"})}
        child = envelope.event
        if child.type is AgentEventType.DELTA:
            packet = self._text_streams.child_delta(outer, child.content, child.thinking)
            if packet is not None:
                await self._emit(packet)
            return
        await self._emit({**outer, "event": child.model_dump(mode="json")})
        if child.type in (AgentEventType.COMPLETE, AgentEventType.ERROR):
            self._text_streams.end_child(envelope.execution_id)

    async def _emit(self, packet: dict) -> None:
        """Queue a client packet; comparison runs are tagged with their column."""
        if self._comparison is not None:
            packet = {**packet, "comparison": self._comparison}
        await self.queue.put(packet)

    def stream_snapshots(self) -> list[dict]:
        """``replace`` packets for the open text streams, tagged like the run's other packets (ADR-0084)."""
        packets = self._text_streams.snapshots()
        if self._comparison is not None:
            packets = [{**packet, "comparison": self._comparison} for packet in packets]
        return packets

    def _column_of_current_turn(self) -> dict[str, str] | None:
        column = next((message for message in reversed(self.chat.messages) if message.role == "user"), None)
        if column is None or column.comparison_id is None:
            return None
        return {"id": str(column.comparison_id), "column_id": str(column.id)}

    async def _handle_tool_approval(
        self,
        pending_tools: list[ToolCall],
        queue: UserResponseQueue,
    ) -> None:
        """
        Callback for InteractiveApprovalPolicy. Emits WebSocket
        permission-request messages and waits for user decisions.
        """
        tasks = []
        for tool in pending_tools:
            await self._emit(
                {
                    "type": "tool_permission_request",
                    "id": tool.id,
                    "name": tool.function.name,
                    "arguments": tool.function.arguments,
                },
            )
            tasks.append(self._wait_for_ui_approval(tool, queue))

        await asyncio.gather(*tasks)

    async def _wait_for_ui_approval(
        self,
        tool: ToolCall,
        queue: UserResponseQueue,
    ) -> None:
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        try:
            async with asyncio.timeout(60):
                self.pending_approvals[tool.id] = future
                is_approved = await future
                queue.respond(tool, is_approved)
        except asyncio.TimeoutError:
            self.logger.info(f"Tool {tool.id} timed out waiting for user approval.")
            queue.respond(tool, False)
            await self._emit({"type": "tool_update", "id": tool.id})
        finally:
            self.pending_approvals.pop(tool.id, None)

    def resolve_tool_approval(self, tool_id: str, approved: bool) -> None:
        future = self.pending_approvals.get(tool_id)
        if future and not future.done():
            future.set_result(approved)
