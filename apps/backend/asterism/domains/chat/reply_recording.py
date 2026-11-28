"""Saving a turn's reply: completed steps, cancelled and failed turns, and fork steps."""

from __future__ import annotations

import uuid

import asterism.domains.chat.service as chat_service
from asterism.common.collection_utils import index_of
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.context_manifest import ContextManifest
from asterism.domains.agent.schemas import AgentEvent, AgentEventType
from asterism.domains.chat.context_manifest import step_context
from asterism.domains.chat.delegations import DelegationCollector
from asterism.domains.chat.forks import write_fork_step
from asterism.domains.chat.schemas import (
    Message,
    MessageExecution,
    MessageStatus,
    NewMessageRequest,
    UpdateMessageRequest,
)
from asterism.domains.chat.turn_stream import TurnStream
from asterism.domains.llm.schemas import ToolResult


class ReplyRecorder(TurnStream):
    """Writes what the active turn produced, so reconnecting never runs it again.

    Holds the turn's in-progress state: the request it answers, the step being
    streamed, delegations so far, the context manifest and a pending fork step.
    """

    def __init__(self, agent: Agent) -> None:
        super().__init__(agent.session)
        self.agent: Agent = agent
        self._active_parent_id: uuid.UUID | None = None
        # The message the next step of the active turn answers: the request,
        # then each recorded tool step in turn.
        self._step_parent_id: uuid.UUID | None = None
        self._streaming_content: str = ""
        self._streaming_thinking: str = ""
        self._execution: MessageExecution | None = None
        self._delegations = DelegationCollector()
        # US-54.3: what the current run was given, shared by its steps.
        self._context: ContextManifest | None = None
        # US-54.5: the pending fork step being replayed, until it is recorded.
        self._fork_step: Message | None = None

    async def _record_step(self, event: AgentEvent, parent_message: Message) -> Message:
        """Save one completed step of the turn as the reply to ``parent_message``."""
        if self._fork_step is not None:
            return await self._complete_fork_step(event)
        new_message = await chat_service.add_message(
            user_id=self.user_id,
            chat_id=self.chat_id,
            message=NewMessageRequest(
                role="assistant",
                content=event.content,
                thinking=event.thinking,
                status=MessageStatus.COMPLETED,
                input_tokens=event.input_tokens,
                output_tokens=event.output_tokens,
                total_tokens=event.total_tokens,
                generation_duration_ms=event.generation_duration_ms,
                parent_message_id=parent_message.id,
                tool_calls=event.tool_calls if event.has_tool_calls() else None,
                tool_call_results=event.tool_results if event.has_tool_results() else None,
                delegations=self._delegations.drain() or None,
                context=step_context(self._context, event.tool_results) if self._context else None,
                execution=self._execution,
                model_id=self.agent.model_id,  # type:ignore
            ),
        )
        parent_message.active_child_id = new_message.id
        parent_message.status = MessageStatus.COMPLETED
        return new_message

    async def cancel_active_generation(self) -> None:
        """Finalize the active user turn so reconnecting never re-runs it."""
        parent_id = self._active_parent_id
        if parent_id is None:
            return

        if self._fork_step is not None:
            await self._finish_fork_step(MessageStatus.CANCELLED)
            self._active_parent_id = None
            return

        parent_index = index_of(self.chat.messages, lambda message: message.id == parent_id)

        # Retain useful streamed output and delegation work rather than
        # silently discarding it.
        delegations = self._delegations.drain(unfinished="cancelled")
        if self._streaming_content or self._streaming_thinking or delegations:
            partial = await chat_service.add_message(
                user_id=self.user_id,
                chat_id=self.chat_id,
                message=NewMessageRequest(
                    role="assistant",
                    content=self._streaming_content,
                    thinking=self._streaming_thinking,
                    status=MessageStatus.CANCELLED,
                    delegations=delegations or None,
                    context=self._context,
                    parent_message_id=self._step_parent_id or parent_id,
                    execution=self._execution,
                    model_id=self.agent.model_id,  # type: ignore
                ),
            )
            self.chat.messages.append(partial)

        # add_message marks its parent complete when it attaches a child, so
        # write the terminal user-visible cancellation state last.
        parent = await chat_service.write_message_update(
            user_id=self.user_id,
            chat_id=self.chat_id,
            message_id=parent_id,
            payload=UpdateMessageRequest(status=MessageStatus.CANCELLED),
        )
        if parent_index >= 0:
            self.chat.messages[parent_index] = parent

        await self._emit(
            {
                "type": AgentEventType.COMPLETE.value,
                "last_messages": [message.model_dump(mode="json") for message in self.chat.messages[parent_index:]],
            },
        )
        self._active_parent_id = None

    async def fail_active_generation(self, error: str, error_code: str | None = None) -> None:
        """Finalize a turn that ended in an error so reconnecting never re-runs it (US-77.2).

        Like cancellation, the streamed output so far is kept, here on a failed
        step that carries the error, and the request is marked failed. The
        error packet is sent even if recording fails.
        """
        parent_id = self._active_parent_id
        self._active_parent_id = None
        try:
            if parent_id is None:
                pass
            elif self._fork_step is not None:
                await self._finish_fork_step(MessageStatus.FAILED, error=error)
            else:
                await self._record_failed_turn(parent_id, error)
        except Exception:
            self.logger.exception("Could not record the failed turn for chat %s", self.chat_id)
        await self._emit({"type": AgentEventType.ERROR.value, "content": error, "error_code": error_code})

    async def _record_failed_turn(self, parent_id: uuid.UUID, error: str) -> None:
        request_index = index_of(self.chat.messages, lambda message: message.id == parent_id)
        failed = await chat_service.add_message(
            user_id=self.user_id,
            chat_id=self.chat_id,
            message=NewMessageRequest(
                role="assistant",
                content=self._streaming_content,
                thinking=self._streaming_thinking,
                status=MessageStatus.FAILED,
                error=error,
                delegations=self._delegations.drain(unfinished="error") or None,
                context=self._context,
                parent_message_id=self._step_parent_id or parent_id,
                execution=self._execution,
                model_id=self.agent.model_id,  # type: ignore
            ),
        )
        self.chat.messages.append(failed)
        # add_message marks its parent complete, so write the request's state last.
        request = await chat_service.write_message_update(
            user_id=self.user_id,
            chat_id=self.chat_id,
            message_id=parent_id,
            payload=UpdateMessageRequest(status=MessageStatus.FAILED),
        )
        if request_index >= 0:
            self.chat.messages[request_index] = request
        await self._emit(
            {
                "type": AgentEventType.COMPLETE.value,
                "last_messages": [
                    message.model_dump(mode="json") for message in self.chat.messages[max(request_index, 0) :]
                ],
            },
        )

    async def _finish_fork_step(self, status: MessageStatus, *, error: str | None = None) -> None:
        """Record a cancelled or failed fork step with the work it finished (ADR-0038).

        Calls that did not finish get a cancelled result so the branch stays a
        valid conversation if the user continues from it.
        """
        step = self._fork_step
        assert step is not None
        self._fork_step = None
        recorded = {result.tool_call.id: result for result in step.tool_call_results or [] if result}
        results = [
            recorded.get(call.id)
            or ToolResult(content="Cancelled before it finished.", raw_result=None, is_empty=True, tool_call=call)
            for call in step.tool_calls or []
        ]
        cancelled = await write_fork_step(
            user_id=self.user_id,
            chat_id=self.chat_id,
            message_id=step.id,
            status=status,
            tool_call_results=results or None,
            delegations=[*(step.delegations or []), *self._delegations.drain(unfinished="cancelled")] or None,
            context=self._context,
            error=error,
        )
        self.chat.messages.append(cancelled)
        await self._emit(
            {
                "type": AgentEventType.COMPLETE.value,
                "last_messages": [cancelled.model_dump(mode="json")],
            },
        )

    async def _complete_fork_step(self, event: AgentEvent) -> Message:
        """Record the replayed fork step: reused work plus what ran again."""
        step = self._fork_step
        assert step is not None
        self._fork_step = None
        return await write_fork_step(
            user_id=self.user_id,
            chat_id=self.chat_id,
            message_id=step.id,
            status=MessageStatus.COMPLETED,
            tool_call_results=event.tool_results or None,
            delegations=[*(step.delegations or []), *self._delegations.drain()] or None,
            context=step_context(self._context, event.tool_results) if self._context else None,
        )
