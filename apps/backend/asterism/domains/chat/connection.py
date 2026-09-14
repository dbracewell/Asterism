import asyncio
from abc import ABC, abstractmethod

from fastapi import WebSocket


class Connection(ABC):
    def __init__(self):
        self.is_connected = False

    @abstractmethod
    async def accept(self) -> None: ...

    @abstractmethod
    async def receive_json(self) -> dict: ...

    @abstractmethod
    async def send_json(self, data: dict) -> None: ...

    @abstractmethod
    async def close(self) -> None: ...

    async def heartbeat_loop(self) -> None:
        try:
            while self.is_connected:
                await asyncio.sleep(10)
                await self.send_json({"type": "pong"})
        except asyncio.CancelledError:
            pass


class WebSocketConnection(Connection):
    def __init__(self, websocket: WebSocket):
        super().__init__()
        self.ws = websocket

    async def accept(self) -> None:
        await self.ws.accept()
        self.is_connected = True

    async def receive_json(self) -> dict:
        return await self.ws.receive_json()

    async def send_json(self, data: dict) -> None:
        if self.is_connected:
            await self.ws.send_json(data)

    async def close(self) -> None:
        if self.is_connected:
            self.is_connected = False
            await self.ws.close()
