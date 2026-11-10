"""US-76.3: the ComfyUI generator against a fake ComfyUI server (ADR-0064)."""

import asyncio
import io

import pytest
from asterism.domains.image_generation.comfyui import provider as comfyui
from asterism.domains.image_generation.comfyui.schemas import ComfyUISettings
from asterism.domains.image_generation.comfyui.workflow import DEFAULT_WORKFLOW, check_workflow, fill
from asterism.domains.image_generation.providers import ImageGenerationError
from asterism.domains.image_generation.schemas import ImageProgress, ImageRequest
from asterism.domains.image_generation.service import generate_images
from asterism.domains.settings.models import ApplicationSettingsModel
from fake_comfyui import FakeComfyUI
from test_canvas import canvas_api as _canvas_api
from test_canvas import started_chat
from test_image_generation import set_policy
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
canvas_api = _canvas_api
URL = "/settings/app/image-generation/comfyui"


@pytest.fixture
def server():
    comfyui.clear_probes()
    with FakeComfyUI() as fake:
        yield fake
    comfyui.clear_probes()


@pytest.fixture
def images_api(canvas_api, monkeypatch, tmp_path):
    from asterism.domains.files.store import LocalFileStore

    store = LocalFileStore(tmp_path / "files")
    monkeypatch.setattr("asterism.domains.files.service.get_file_store", lambda: store)
    monkeypatch.setattr("asterism.domains.files.service.start_ingestion", lambda **_: None)
    return canvas_api


def settings(server, **changes) -> ComfyUISettings:
    return ComfyUISettings(base_url=server.url, checkpoint="sdxl.safetensors", **changes)


async def collect():
    events: list[ImageProgress] = []

    async def progress(update):
        events.append(update)

    return events, progress


async def test_workflow_placeholders_are_checked_and_typed():
    check_workflow(DEFAULT_WORKFLOW)
    filled = fill(
        DEFAULT_WORKFLOW,
        {
            "prompt": 'a "quoted" {{seed}} fox',
            "negative_prompt": "",
            "width": 832,
            "height": 1216,
            "seed": 9,
            "steps": 20,
            "guidance": 4.5,
            "checkpoint": "sdxl.safetensors",
        },
    )
    assert filled["5"]["inputs"] == {"width": 832, "height": 1216, "batch_size": 1}
    assert filled["3"]["inputs"]["seed"] == 9 and filled["3"]["inputs"]["cfg"] == 4.5
    # User text is a value, never re-read as a placeholder or structure.
    assert filled["6"]["inputs"]["text"] == 'a "quoted" {{seed}} fox'
    assert DEFAULT_WORKFLOW["5"]["inputs"]["width"] == "{{width}}"
    assert (
        fill({"1": {"class_type": "X", "inputs": {"text": "style, {{prompt}}"}}}, {"prompt": "cat"})["1"]["inputs"][
            "text"
        ]
        == "style, cat"
    )

    for bad, reason in [
        ({"nodes": [], "links": []}, "UI format"),
        ({"1": {"inputs": {}}}, "class_type"),
        ({"1": {"class_type": "X", "inputs": {"text": "{{size}}"}}}, "Unknown placeholders"),
        ({"1": {"class_type": "X", "inputs": {"text": "fixed"}}}, "{{prompt}}"),
    ]:
        with pytest.raises(ValueError, match=reason):
            check_workflow(bad)


async def test_generates_through_the_server_with_progress_and_seeds(server):
    events, progress = await collect()
    result = await comfyui.ComfyUIProvider(settings(server)).generate(
        ImageRequest(prompt="a heron", negative_prompt="blurry", width=512, height=320, count=2, seed=40), progress
    )
    assert [(image.seed, image.width, image.height) for image in result.images] == [(40, 512, 320), (41, 512, 320)]
    assert result.model == "sdxl.safetensors" and result.steps == 25
    # One prompt per image, with the typed values filled in; only saved outputs are downloaded.
    first = server.state.prompts[0]
    assert first["4"]["inputs"]["ckpt_name"] == "sdxl.safetensors"
    assert first["7"]["inputs"]["text"] == "blurry" and first["3"]["inputs"]["seed"] == 40
    assert server.state.prompts[1]["3"]["inputs"]["seed"] == 41
    from PIL import Image

    assert Image.open(io.BytesIO(result.images[0].png)).getpixel((0, 0))[0] == 40
    # Step progress from the WebSocket, across both images.
    assert [(e.step, e.total) for e in events if e.stage == "running"] == [
        (1, 6),
        (2, 6),
        (3, 6),
        (4, 6),
        (5, 6),
        (6, 6),
    ]


async def test_errors_are_clear(server):
    _, progress = await collect()
    provider = comfyui.ComfyUIProvider(settings(server))
    with pytest.raises(ImageGenerationError, match="ComfyUI failed in KSampler: CUDA out of memory"):
        await provider.generate(ImageRequest(prompt="fail now"), progress)
    with pytest.raises(ImageGenerationError, match="produced no images"):
        await provider.generate(ImageRequest(prompt="noimage"), progress)
    broken = {**DEFAULT_WORKFLOW, "12": {"class_type": "Broken", "inputs": {}}}
    with pytest.raises(
        ImageGenerationError,
        match=r"rejected the workflow: Prompt outputs failed validation\. "
        r"Node 12 \(Broken\): Value not in list: ckpt_name",
    ):
        await comfyui.ComfyUIProvider(settings(server, workflow=broken)).generate(ImageRequest(prompt="x"), progress)

    with pytest.raises(ImageGenerationError, match="isn't reachable"):
        await comfyui.ComfyUIProvider(ComfyUISettings(base_url="http://127.0.0.1:9", checkpoint="a")).generate(
            ImageRequest(prompt="x"), progress
        )
    server.state.token = "secret"
    with pytest.raises(ImageGenerationError, match="refused the credentials"):
        await provider.generate(ImageRequest(prompt="x"), progress)
    # The right token works for HTTP and the progress socket.
    events, progress = await collect()
    authed = comfyui.ComfyUIProvider(settings(server, auth="bearer", token="secret"))
    assert len((await authed.generate(ImageRequest(prompt="a cat", width=256, height=256), progress)).images) == 1
    assert any(e.stage == "running" for e in events)


async def test_timeouts_and_cancellation_remove_the_job(server, monkeypatch):
    _, progress = await collect()
    slow = comfyui.ComfyUIProvider(settings(server, timeout_seconds=10))
    monkeypatch.setattr(slow.settings, "timeout_seconds", 0.5)
    with pytest.raises(ImageGenerationError, match="didn't finish within"):
        await slow.generate(ImageRequest(prompt="slow please"), progress)
    assert [kind for kind, _ in server.state.cancelled] == ["queue", "interrupt"]
    prompt_id = server.state.cancelled[0][1]["delete"][0]
    assert server.state.cancelled[1][1] == {"prompt_id": prompt_id}

    server.state.cancelled.clear()
    task = asyncio.create_task(
        comfyui.ComfyUIProvider(settings(server)).generate(ImageRequest(prompt="slow"), progress)
    )
    await asyncio.sleep(0.5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert [kind for kind, _ in server.state.cancelled] == ["queue", "interrupt"]


async def test_status_explains_what_is_missing_and_caches_the_probe(server):
    status = lambda value: comfyui.ComfyUIProvider(value).status()  # noqa: E731
    assert (await status(ComfyUISettings())).detail == "Set the ComfyUI server address"
    assert "checkpoint" in (await status(ComfyUISettings(base_url=server.url))).detail
    bad = ComfyUISettings(base_url=server.url, workflow={"1": {"class_type": "X", "inputs": {}}})
    assert "{{prompt}}" in (await status(bad)).detail
    ready = await status(settings(server))
    assert ready.ready and ready.detail == f"ComfyUI at {server.url}"
    calls = len(server.state.headers)
    await status(settings(server))
    assert len(server.state.headers) == calls
    down = await status(ComfyUISettings(base_url="http://127.0.0.1:9", checkpoint="a"))
    assert not down.ready and "isn't reachable" in down.detail


async def test_admin_settings_keep_the_token_secret_and_test_the_connection(images_api, server):
    client, sessions = images_api
    assert (await client.get(URL, headers=auth("a"))).status_code == 401
    initial = (await client.get(URL, headers=auth("admin"))).json()
    assert initial["settings"]["base_url"] is None and "prompt" in initial["placeholders"]

    body = {"base_url": f"{server.url}/", "auth": "bearer", "token": "secret", "checkpoint": "sdxl.safetensors"}
    saved = (await client.put(URL, headers=auth("admin"), json=body)).json()["settings"]
    assert saved["base_url"] == server.url and saved["has_token"] and "token" not in saved
    async with sessions() as db:
        row = await db.get(ApplicationSettingsModel, "image_generation_comfyui")
        assert row.value["token"].startswith("enc:v1:")
    # The generic settings routes can't read or write it.
    assert "image_generation_comfyui" not in (await client.get("/settings/app", headers=auth("admin"))).json()
    generic = await client.put("/settings/app/image_generation_comfyui", headers=auth("admin"), json={"value": {}})
    assert generic.status_code == 400

    # Saving without a token keeps it; testing uses it.
    kept = (await client.put(URL, headers=auth("admin"), json={**body, "token": None, "steps": 30})).json()
    assert kept["settings"]["has_token"] and kept["settings"]["steps"] == 30
    server.state.token = "secret"
    test = (await client.post(f"{URL}/test", headers=auth("admin"), json={**body, "token": None})).json()
    assert test == {
        "ok": True,
        "detail": "Connected to ComfyUI 0.9.1",
        "version": "0.9.1",
        "devices": ["cuda:0 Fake GPU"],
        "checkpoints": ["sdxl.safetensors", "flux.safetensors"],
    }
    wrong = (await client.post(f"{URL}/test", headers=auth("admin"), json={**body, "token": "nope"})).json()
    assert wrong["ok"] is False and wrong["detail"] == "ComfyUI refused the credentials"
    missing = {**body, "token": None, "checkpoint": "gone.safetensors"}
    assert (
        "no checkpoint named gone"
        in (await client.post(f"{URL}/test", headers=auth("admin"), json=missing)).json()["detail"]
    )

    ui_format = await client.put(URL, headers=auth("admin"), json={**body, "workflow": {"nodes": [], "links": []}})
    assert ui_format.status_code == 400 and "Save (API)" in ui_format.text
    assert (await client.put(URL, headers=auth("admin"), json={**body, "base_url": "ftp://x"})).status_code == 422


async def test_chat_generation_saves_images_from_comfyui(images_api, server):
    client, sessions = images_api
    await set_policy(sessions, provider="comfyui")
    body = {"base_url": server.url, "checkpoint": "sdxl.safetensors"}
    assert (await client.put(URL, headers=auth("admin"), json=body)).status_code == 200
    availability = (await client.get("/image-generation/availability", headers=auth())).json()
    assert availability == {"available": True, "reason": ""}

    chat_id, _, _ = await started_chat(client, sessions)
    images = await generate_images(
        user_id="a", chat_id=chat_id, request=ImageRequest(prompt="A lighthouse", width=256, height=256, seed=3)
    )
    assert [(image.width, image.height, image.seed, image.model) for image in images] == [
        (256, 256, 3, "sdxl.safetensors")
    ]
