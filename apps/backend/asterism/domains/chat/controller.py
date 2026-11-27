import asyncio
import time
import uuid
from logging import Logger
from typing import cast

from fastapi import WebSocketDisconnect

from asterism.common.log import get_logger
from asterism.core.tasks import BackgroundTaskManager
from asterism.db.database import get_async_db_session
from asterism.domains.agent.schemas import AgentEventType
from asterism.domains.chat.capacity import ChatCapacityError
from asterism.domains.chat.connection import Connection
from asterism.domains.chat.jobs import ChatJob, ControllerAdmission, chat_jobs
from asterism.domains.chat.message_queue import ChatStream, MessageQueue, get_message_queue, subscribe, unsubscribe
from asterism.domains.chat.orchestrator import ChatOrchestrator
from asterism.domains.usage.service import UsageLimitExceeded, require_within_budget


class ChatController:
    def __init__(
        self,
        chat_id: uuid.UUID,
        connection: Connection,
        job: ChatJob,
        admission: ControllerAdmission,
        expires_at: float | None = None,
    ):
        self.chat_id: uuid.UUID = chat_id
        # When the connecting token expires (Unix seconds); the socket closes
        # then with 1008 and the client reconnects with a fresh token (US-112.3).
        self.expires_at = expires_at
        self.connection: Connection = connection
        self.admission = admission
        self.job = job
        self.manager = job.manager or chat_jobs
        # Controller jobs are constructed with the concrete chat orchestrator;
        # the job manager itself depends only on its narrower lifecycle protocol.
        self.orchestrator = cast(ChatOrchestrator, job.orchestrator)
        self.tasks: BackgroundTaskManager = BackgroundTaskManager()
        self.logger: Logger = get_logger("ChatSession")
        self.inbound_commands: MessageQueue = MessageQueue()
        # This controller's own copy of the chat's outbound packets (US-77.3).
        self.outbound: MessageQueue | None = None
        self._is_running: bool = False

    @property
    def queue(self) -> ChatStream:
        """The chat's stream; a packet put here reaches every attached controller."""
        return get_message_queue(self.chat_id)

    async def run(self) -> None:
        command_tasks: list[asyncio.Task[None]] = []
        try:
            await self.connection.accept()
            self.manager.attach(self.chat_id, self.job, self.admission)
            self.outbound, replayed = subscribe(self.chat_id)
            self._is_running = True
            self.tasks.spawn(self.connection.heartbeat_loop())
            self.tasks.spawn(self._status_loop())
            self.tasks.spawn(self._message_queue_processing_loop())

            # Work survives controller disconnects. Admission fails immediately;
            # retain the control channel so clients can retry or cancel.
            try:
                if not replayed and not self.job.is_active:
                    self.job.start(self.orchestrator.resume_pending_turn())
                self.job.start_title_generation()
            except ChatCapacityError as error:
                await self.connection.send_json(error.packet())

            command_tasks = [
                asyncio.create_task(self._accept_commands_loop()),
                asyncio.create_task(self._process_commands_loop()),
            ]
            if self.expires_at is not None:
                command_tasks.append(asyncio.create_task(self._close_at_expiry(self.expires_at)))
            await asyncio.gather(*command_tasks)
        except WebSocketDisconnect:
            self.logger.info("Chat stream disconnected")
        except asyncio.CancelledError:
            self.logger.info("Shutting down WebSocket listener...")
            raise
        except Exception as e:
            self.logger.error(f"Controller error: {e}")
            await self.connection.send_json({"type": AgentEventType.ERROR.value, "content": str(e)})
        finally:
            self._is_running = False
            # These are connection-owned receive/dispatch loops. Cancelling
            # them cannot cancel a job because dispatch awaits it via shield.
            for task in command_tasks:
                if not task.done():
                    task.cancel()
            if command_tasks:
                await asyncio.gather(*command_tasks, return_exceptions=True)
            await self.tasks.shutdown()
            if self.outbound is not None:
                unsubscribe(self.chat_id, self.outbound)
            await self.manager.detach(self.chat_id, self.job, self.admission)

    async def _close_at_expiry(self, expires_at: float) -> None:
        """Close the socket once its token expires; running work carries on."""
        await asyncio.sleep(max(0.0, expires_at - time.time()))
        self.logger.info("Chat stream token expired")
        self._is_running = False
        await self.connection.close(code=1008, reason="Token expired")
        raise WebSocketDisconnect(code=1008)

    async def _accept_commands_loop(self) -> None:
        while self._is_running:
            cmd = await self.connection.receive_json()
            if cmd.get("type") == "cancel":
                self.job.cancel()
                continue

            if cmd.get("type") == "tool_approval":
                tool_id = str(cmd.get("tool_id"))
                is_approved = cmd.get("approved", False)
                self.orchestrator.resolve_tool_approval(tool_id, is_approved)
                await self.queue.put({"type": "tool_update", "id": tool_id})
                continue  # Skip putting this in the sequential queue

            await self.inbound_commands.put(cmd)

    async def _process_commands_loop(self) -> None:
        while self._is_running:
            cmd = await self.inbound_commands.get()
            try:
                match cmd.get("type"):
                    case "resume":
                        if self.job.is_active:
                            continue
                        current_job = self.job.start(self.orchestrator.resume_pending_turn())
                    case "regenerate":
                        await self._admit_new_run()
                        current_job = self.job.start(self._regenerate(cmd.get("parent_message_id", "")))
                    case "compact":
                        # Shares the work slot, so it never overlaps a turn (ADR-0060).
                        if self.job.is_active:
                            await self.connection.send_json(
                                {
                                    "type": "compaction",
                                    "status": "failed",
                                    "content": "Wait for the current reply to finish, then compact.",
                                }
                            )
                            continue
                        current_job = self.job.start(self.orchestrator.compact_now())
                    case "ping":
                        continue
                    case _:
                        continue

                try:
                    # Shield the job from cancellation when this socket exits.
                    await asyncio.shield(current_job)
                except asyncio.CancelledError:
                    raise

            except (ChatCapacityError, UsageLimitExceeded) as error:
                await self.connection.send_json(error.packet())
            finally:
                self.inbound_commands.task_done()

    async def _admit_new_run(self) -> None:
        """Refuse a regenerate over budget before it starts (ADR-0073); resumes finish admitted work."""
        async with get_async_db_session() as session:
            await require_within_budget(self.orchestrator.user_id, session)

    async def _regenerate(self, parent_message_id: str) -> None:
        await self.orchestrator.reload_chat()
        parent_message_index, parent_message = self.orchestrator.find_message(parent_message_id)
        await self.connection.send_json(
            {
                "type": "regenerate",
                "parent_id": str(parent_message.id),
            },
        )
        await self.orchestrator.handle_regenerate_message(parent_message_index)

    async def _message_queue_processing_loop(self) -> None:
        assert self.outbound is not None
        event_sequence: set[AgentEventType] = set()

        while self._is_running:
            msg = await self.outbound.get()

            try:
                msg_type: AgentEventType = AgentEventType(msg["type"])
            except ValueError:
                await self.connection.send_json(msg)
                continue

            event_sequence.add(msg_type)

            # Auto-inject START if needed
            if AgentEventType.START not in event_sequence:
                event_sequence.add(AgentEventType.START)
                # Comparison runs tag every packet; the injected start must
                # carry the same tag or the client treats it as a normal turn.
                start = {"type": AgentEventType.START.value}
                if "comparison" in msg:
                    start["comparison"] = msg["comparison"]
                await self.connection.send_json(start)

            if msg_type in (AgentEventType.COMPLETE, AgentEventType.ERROR):
                event_sequence.clear()
                await self.connection.send_json(msg)
            else:
                await self.connection.send_json(msg)

    async def _status_loop(self) -> None:
        try:
            while self._is_running:
                await asyncio.sleep(0.5)
                await self.connection.send_json(
                    {
                        "type": "status",
                        "is_processing": self.job.is_active or self.orchestrator.is_active,
                    },
                )
        except asyncio.CancelledError:
            pass
        except WebSocketDisconnect:
            # The tab closed between packets; the command loop ends the controller.
            pass
