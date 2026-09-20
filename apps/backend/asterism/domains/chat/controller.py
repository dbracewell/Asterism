import asyncio
import uuid
from logging import Logger

from fastapi import WebSocketDisconnect

from asterism.common.log import get_logger
from asterism.core.tasks import BackgroundTaskManager
from asterism.domains.agent.schemas import AgentEventType
from asterism.domains.chat.connection import Connection
from asterism.domains.chat.jobs import ChatJob
from asterism.domains.chat.message_queue import MessageQueue, get_message_queue
from asterism.domains.chat.orchestrator import ChatOrchestrator


class ChatController:
    def __init__(
        self,
        chat_id: uuid.UUID,
        connection: Connection,
        job: ChatJob,
    ):
        self.chat_id: uuid.UUID = chat_id
        self.connection: Connection = connection
        self.job = job
        self.orchestrator: ChatOrchestrator = job.orchestrator
        self.tasks: BackgroundTaskManager = BackgroundTaskManager()
        self.logger: Logger = get_logger(f"ChatSession({str(self.chat_id)})")
        self.inbound_commands: MessageQueue = asyncio.Queue()
        self._is_running: bool = False

    @property
    def queue(self) -> MessageQueue:
        return get_message_queue(self.chat_id)

    async def run(self) -> None:
        await self.connection.accept()
        self._is_running = True

        # Start background workers
        self.tasks.spawn(self.connection.heartbeat_loop())
        self.tasks.spawn(self.orchestrator.generate_chat_title())
        self.tasks.spawn(self._status_loop())
        self.tasks.spawn(self._message_queue_processing_loop())

        command_tasks: list[asyncio.Task[None]] = []
        try:
            # The generation task belongs to the chat job, not this socket.
            # Disconnecting a browser must therefore only stop this controller.
            if self.queue.qsize() == 0 and not self.job.is_active:
                self.job.start(self.orchestrator.run_agent())

            command_tasks = [
                asyncio.create_task(self._accept_commands_loop()),
                asyncio.create_task(self._process_commands_loop()),
            ]
            await asyncio.gather(*command_tasks)
        except WebSocketDisconnect:
            self.logger.info("Chat stream disconnected")
        except asyncio.CancelledError:
            self.logger.info("Shutting down WebSocket listener...")
            raise
        except Exception as e:
            self.logger.error(f"Controller error: {e}")
            await self.connection.send_json(
                {"type": AgentEventType.ERROR.value, "content": str(e)}
            )
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
                if cmd.get("always_allow"):
                    self.tasks.spawn(
                        self.orchestrator.save_always_allow_preference(tool_id)
                    )

                await self.queue.put({"type": "tool_update", "id": tool_id})
                continue  # Skip putting this in the sequential queue

            await self.inbound_commands.put(cmd)

    async def _process_commands_loop(self) -> None:
        while self._is_running:
            cmd = await self.inbound_commands.get()
            try:
                match cmd.get("type"):
                    case "chat":
                        current_job = self.job.start(
                            self.orchestrator.handle_new_user_message(
                                cmd.get("message", ""), cmd.get("files", [])
                            )
                        )
                    case "regenerate":
                        current_job = self.job.start(
                            self._regenerate(cmd.get("parent_message_id", ""))
                        )
                    case "ping":
                        continue
                    case _:
                        continue

                try:
                    # Shield the job from cancellation when this socket exits.
                    await asyncio.shield(current_job)
                except asyncio.CancelledError:
                    raise

            finally:
                self.inbound_commands.task_done()

    async def _regenerate(self, parent_message_id: str) -> None:
        parent_message_index, parent_message = self.orchestrator.find_message(
            parent_message_id
        )
        await self.connection.send_json(
            {
                "type": "regenerate",
                "parent_id": str(parent_message.id),
            }
        )
        await self.orchestrator.handle_regenerate_message(parent_message_index)

    async def _message_queue_processing_loop(self) -> None:
        event_sequence: set[AgentEventType] = set()

        while self._is_running:
            msg = await self.queue.get()

            try:
                msg_type: AgentEventType = AgentEventType(msg["type"])
            except ValueError:
                await self.connection.send_json(msg)
                continue

            event_sequence.add(msg_type)

            # Auto-inject START if needed
            if AgentEventType.START not in event_sequence:
                event_sequence.add(AgentEventType.START)
                await self.connection.send_json(
                    {"type": AgentEventType.START.value}
                )

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
                    }
                )
        except asyncio.CancelledError:
            pass
