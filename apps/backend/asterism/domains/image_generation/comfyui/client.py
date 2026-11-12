"""A small ComfyUI HTTP and WebSocket client (US-76.3).

Endpoints: ``/system_stats`` (test connection), ``/object_info`` (checkpoints),
``/prompt`` (queue), ``/history/{id}`` (completion and outputs), ``/view``
(image bytes), ``/queue`` and ``/interrupt`` (cancel) and ``/ws`` (step
progress, best effort: completion never depends on it). Errors become
``ImageGenerationError`` with a message an admin or user can act on.
"""

import asyncio
import base64
import json
import ssl
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from asterism.common.log import get_logger

from ..providers import ImageGenerationError
from .schemas import ComfyUIParameters

logger = get_logger("ComfyUI")

MAX_IMAGE_BYTES = 64 * 1024 * 1024
REQUEST_TIMEOUT = httpx.Timeout(30.0, connect=5.0)
StepCallback = Callable[[int, int], Awaitable[None]]


def auth_headers(settings: ComfyUIParameters) -> dict[str, str]:
    if settings.auth == "bearer" and settings.token:
        return {"Authorization": f"Bearer {settings.token}"}
    if settings.auth == "basic":
        pair = f"{settings.username}:{settings.token}".encode()
        return {"Authorization": f"Basic {base64.b64encode(pair).decode()}"}
    return {}


def _detail(response: httpx.Response) -> str:
    """ComfyUI's error message, plus the first node error when it names one."""
    try:
        body = response.json()
    except ValueError:
        return response.text[:300]
    if not isinstance(body, dict):
        return str(body)[:300]
    error = body.get("error")
    parts = [str(error.get("message", "")) if isinstance(error, dict) else str(error or "")]
    for node_id, node in (body.get("node_errors") or {}).items():
        for item in node.get("errors", [])[:1]:
            reason = ": ".join(text for text in (item.get("message"), item.get("details")) if text)
            parts.append(f"Node {node_id} ({node.get('class_type', '?')}): {reason}")
        break
    return ". ".join(part.strip().rstrip(".") for part in parts if part.strip())[:500]


class ComfyUIClient:
    def __init__(self, settings: ComfyUIParameters, transport: httpx.AsyncBaseTransport | None = None):
        if not settings.base_url:
            raise ImageGenerationError("Set the ComfyUI server address first")
        self.settings = settings
        self.base_url = settings.base_url
        self._http = httpx.AsyncClient(
            base_url=settings.base_url,
            headers=auth_headers(settings),
            timeout=REQUEST_TIMEOUT,
            verify=settings.verify_tls,
            follow_redirects=False,
            transport=transport,
        )

    async def __aenter__(self) -> "ComfyUIClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self._http.aclose()

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            response = await self._http.request(method, path, **kwargs)
        except httpx.TimeoutException as error:
            raise ImageGenerationError(f"ComfyUI at {self.base_url} didn't respond in time") from error
        except httpx.HTTPError as error:
            raise ImageGenerationError(f"ComfyUI at {self.base_url} isn't reachable") from error
        if response.status_code in (401, 403):
            raise ImageGenerationError("ComfyUI refused the credentials")
        return response

    async def _json(self, method: str, path: str, **kwargs: Any) -> Any:
        response = await self._request(method, path, **kwargs)
        if response.status_code >= 400:
            raise ImageGenerationError(f"ComfyUI answered {response.status_code} for {path}: {_detail(response)}")
        try:
            return response.json()
        except ValueError as error:
            raise ImageGenerationError(
                f"ComfyUI sent an unexpected answer for {path}; is this a ComfyUI server?"
            ) from error

    async def system_stats(self) -> dict[str, Any]:
        return await self._json("GET", "/system_stats")

    async def checkpoints(self) -> list[str]:
        data = await self._json("GET", "/object_info/CheckpointLoaderSimple")
        try:
            choices = data["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"]
        except (KeyError, TypeError):
            return []
        # Older servers: [[names...]]; newer: ["COMBO", {"options": [names...]}].
        if choices and isinstance(choices[0], list):
            return [str(name) for name in choices[0]]
        if len(choices) > 1 and isinstance(choices[1], dict):
            return [str(name) for name in choices[1].get("options", [])]
        return []

    async def queue(self, workflow: dict[str, Any], client_id: str) -> str:
        response = await self._request("POST", "/prompt", json={"prompt": workflow, "client_id": client_id})
        if response.status_code == 400:
            raise ImageGenerationError(f"ComfyUI rejected the workflow: {_detail(response) or 'no reason given'}")
        if response.status_code >= 400:
            raise ImageGenerationError(f"ComfyUI answered {response.status_code} when queueing: {_detail(response)}")
        prompt_id = response.json().get("prompt_id")
        if not isinstance(prompt_id, str):
            raise ImageGenerationError("ComfyUI didn't return a job id")
        return prompt_id

    async def history(self, prompt_id: str) -> dict[str, Any] | None:
        data = await self._json("GET", f"/history/{prompt_id}")
        entry = data.get(prompt_id) if isinstance(data, dict) else None
        return entry if isinstance(entry, dict) else None

    async def image(self, ref: dict[str, Any]) -> bytes:
        params = {key: str(ref.get(key, "")) for key in ("filename", "subfolder", "type")}
        try:
            async with self._http.stream("GET", "/view", params=params) as response:
                if response.status_code >= 400:
                    raise ImageGenerationError(f"ComfyUI couldn't send image {params['filename']}")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_IMAGE_BYTES:
                        raise ImageGenerationError("A ComfyUI image was larger than 64 MB")
                return bytes(data)
        except httpx.HTTPError as error:
            raise ImageGenerationError(f"Downloading the image from ComfyUI failed: {error}") from error

    async def cancel(self, prompt_id: str) -> None:
        """Remove the job if it's waiting, and stop it if it's running. Best effort."""
        for path, body in (("/queue", {"delete": [prompt_id]}), ("/interrupt", {"prompt_id": prompt_id})):
            try:
                await self._http.post(path, json=body, timeout=5.0)
            except httpx.HTTPError:
                logger.warning(f"Couldn't cancel ComfyUI job {prompt_id} via {path}")

    def _ws_url(self, client_id: str) -> str:
        scheme = "wss" if self.base_url.startswith("https://") else "ws"
        return f"{scheme}://{self.base_url.split('://', 1)[1]}/ws?clientId={client_id}"

    async def listen(self, client_id: str, on_step: StepCallback, connected: asyncio.Event) -> None:
        """Report sampler steps sent to this client id until cancelled; failures only lose progress."""
        from websockets.asyncio.client import connect

        context = None
        if self.base_url.startswith("https://") and not self.settings.verify_tls:
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        try:
            async with connect(
                self._ws_url(client_id),
                additional_headers=auth_headers(self.settings),
                ssl=context,
                open_timeout=5,
                max_size=32 * 1024 * 1024,
            ) as socket:
                connected.set()
                async for message in socket:
                    if not isinstance(message, str):
                        continue  # Binary preview images.
                    event = json.loads(message)
                    data = event.get("data") or {}
                    if event.get("type") == "progress" and isinstance(data.get("value"), int):
                        await on_step(int(data["value"]), int(data.get("max") or 0))
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001 - progress is optional
            logger.info(f"ComfyUI progress socket unavailable: {error}")
        finally:
            connected.set()
