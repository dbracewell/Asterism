"""A fake ComfyUI server for US-76.3 tests: real HTTP and WebSocket on a local port.

Behavior follows ComfyUI's API: ``POST /prompt`` queues, step ``progress``
messages go to the client id's socket, ``/history/{id}`` shows the outputs,
``/view`` serves the image. Prompts steer failures: "fail" errors in a node,
"slow" never finishes, "noimage" saves nothing. A ``Broken`` node is rejected
as a bad workflow.
"""

import asyncio
import io
import socket
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response


@dataclass
class FakeState:
    token: str | None = None
    prompts: list[dict[str, Any]] = field(default_factory=list)
    history: dict[str, Any] = field(default_factory=dict)
    images: dict[str, bytes] = field(default_factory=dict)
    sockets: dict[str, WebSocket] = field(default_factory=dict)
    cancelled: list[tuple[str, Any]] = field(default_factory=list)
    headers: list[str | None] = field(default_factory=list)


def _png(width: int, height: int, seed: int) -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (width, height), (seed % 256, 120, 200)).save(out, format="PNG")
    return out.getvalue()


def _text(workflow: dict[str, Any]) -> str:
    return " ".join(
        str(node["inputs"].get("text", "")) for node in workflow.values() if node["class_type"] == "CLIPTextEncode"
    )


def build_app(state: FakeState) -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def auth(request: Request, call_next):
        state.headers.append(request.headers.get("authorization"))
        if state.token and request.headers.get("authorization") != f"Bearer {state.token}":
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await call_next(request)

    @app.get("/system_stats")
    async def stats():
        return {"system": {"comfyui_version": "0.9.1", "os": "posix"}, "devices": [{"name": "cuda:0 Fake GPU"}]}

    @app.get("/object_info/CheckpointLoaderSimple")
    async def checkpoints():
        options = ["sdxl.safetensors", "flux.safetensors"]
        return {"CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": ["COMBO", {"options": options}]}}}}

    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        if state.token and websocket.headers.get("authorization") != f"Bearer {state.token}":
            await websocket.close(code=4401)
            return
        await websocket.accept()
        state.sockets[websocket.query_params["clientId"]] = websocket
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass

    async def run(prompt_id: str, client_id: str, workflow: dict[str, Any]) -> None:
        text = _text(workflow)
        if "slow" in text:
            return
        socket_ = state.sockets.get(client_id)
        for step in range(1, 4):
            if socket_ is not None:
                await socket_.send_bytes(b"\x00\x00\x00\x01preview")
                await socket_.send_json(
                    {"type": "progress", "data": {"value": step, "max": 3, "prompt_id": prompt_id, "node": "3"}}
                )
            await asyncio.sleep(0.01)
        if "fail" in text:
            state.history[prompt_id] = {
                "outputs": {},
                "status": {
                    "status_str": "error",
                    "completed": False,
                    "messages": [
                        ["execution_start", {"prompt_id": prompt_id}],
                        ["execution_error", {"node_type": "KSampler", "exception_message": "CUDA out of memory"}],
                    ],
                },
            }
            return
        latent = next((n["inputs"] for n in workflow.values() if n["class_type"] == "EmptyLatentImage"), {})
        sampler = next((n["inputs"] for n in workflow.values() if n["class_type"] == "KSampler"), {})
        outputs: dict[str, Any] = {}
        if "noimage" not in text:
            name = f"asterism_{len(state.images):05}_.png"
            state.images[name] = _png(
                int(latent.get("width", 64)), int(latent.get("height", 64)), sampler.get("seed", 0)
            )
            outputs = {
                "9": {"images": [{"filename": name, "subfolder": "", "type": "output"}]},
                "10": {"images": [{"filename": "preview.png", "subfolder": "", "type": "temp"}]},
            }
        state.history[prompt_id] = {"outputs": outputs, "status": {"status_str": "success", "completed": True}}

    @app.post("/prompt")
    async def queue(request: Request):
        body = await request.json()
        workflow = body["prompt"]
        if any(node["class_type"] == "Broken" for node in workflow.values()):
            return JSONResponse(
                {
                    "error": {
                        "type": "prompt_outputs_failed_validation",
                        "message": "Prompt outputs failed validation",
                    },
                    "node_errors": {
                        "12": {
                            "class_type": "Broken",
                            "errors": [{"message": "Value not in list", "details": "ckpt_name: 'x' not in []"}],
                        }
                    },
                },
                status_code=400,
            )
        prompt_id = str(uuid.uuid4())
        state.prompts.append(workflow)
        asyncio.get_running_loop().create_task(run(prompt_id, body["client_id"], workflow))
        return {"prompt_id": prompt_id, "number": len(state.prompts), "node_errors": {}}

    @app.get("/history/{prompt_id}")
    async def history(prompt_id: str):
        entry = state.history.get(prompt_id)
        return {prompt_id: entry} if entry else {}

    @app.get("/view")
    async def view(filename: str, subfolder: str = "", type: str = "output"):
        data = state.images.get(filename)
        return Response(data, media_type="image/png") if data else Response(status_code=404)

    @app.post("/queue")
    async def delete(request: Request):
        state.cancelled.append(("queue", await request.json()))
        return {}

    @app.post("/interrupt")
    async def interrupt(request: Request):
        state.cancelled.append(("interrupt", await request.json()))
        return {}

    return app


class FakeComfyUI:
    def __init__(self) -> None:
        self.state = FakeState()
        self._socket = socket.socket()
        self._socket.bind(("127.0.0.1", 0))
        self.url = f"http://127.0.0.1:{self._socket.getsockname()[1]}"
        self._server = uvicorn.Server(uvicorn.Config(build_app(self.state), log_level="warning", lifespan="off"))
        self._thread = threading.Thread(target=self._server.run, kwargs={"sockets": [self._socket]}, daemon=True)

    def __enter__(self) -> "FakeComfyUI":
        self._thread.start()
        deadline = time.monotonic() + 10
        while not self._server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("The fake ComfyUI server didn't start")
            time.sleep(0.02)
        return self

    def __exit__(self, *_: object) -> None:
        self._server.should_exit = True
        self._thread.join(timeout=5)
        self._socket.close()
