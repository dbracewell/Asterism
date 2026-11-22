"""US-76.3: the ComfyUI generator against a fake ComfyUI server (ADR-0064)."""

import asyncio
import io

import pytest
from asterism.domains.image_generation.comfyui import provider as comfyui
from asterism.domains.image_generation.comfyui.schemas import ComfyUIParameters
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
SETTING = "/settings/app/image_generator_provider"
TEST = "/components/ImageGenerator/ComfyUI/test"


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


def settings(server, **changes) -> ComfyUIParameters:
    return ComfyUIParameters(base_url=server.url, checkpoint="sdxl.safetensors", **changes)


def generator(parameters: ComfyUIParameters) -> comfyui.ComfyUI:
    return comfyui.ComfyUI(parameters)


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
    result = await generator(settings(server))(
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
    provider = generator(settings(server))
    with pytest.raises(ImageGenerationError, match="ComfyUI failed in KSampler: CUDA out of memory"):
        await provider(ImageRequest(prompt="fail now"), progress)
    with pytest.raises(ImageGenerationError, match="produced no images"):
        await provider(ImageRequest(prompt="noimage"), progress)
    broken = {**DEFAULT_WORKFLOW, "12": {"class_type": "Broken", "inputs": {}}}
    with pytest.raises(
        ImageGenerationError,
        match=r"rejected the workflow: Prompt outputs failed validation\. "
        r"Node 12 \(Broken\): Value not in list: ckpt_name",
    ):
        await generator(settings(server, workflow=broken))(ImageRequest(prompt="x"), progress)

    with pytest.raises(ImageGenerationError, match="isn't reachable"):
        await generator(ComfyUIParameters(base_url="http://127.0.0.1:9", checkpoint="a"))(
            ImageRequest(prompt="x"), progress
        )
    server.state.token = "secret"
    with pytest.raises(ImageGenerationError, match="refused the credentials"):
        await provider(ImageRequest(prompt="x"), progress)
    # The right token works for HTTP and the progress socket.
    events, progress = await collect()
    authed = generator(settings(server, auth="bearer", token="secret"))
    assert len((await authed(ImageRequest(prompt="a cat", width=256, height=256), progress)).images) == 1
    assert any(e.stage == "running" for e in events)


async def test_timeouts_and_cancellation_remove_the_job(server, monkeypatch):
    _, progress = await collect()
    slow = generator(settings(server, timeout_seconds=10))
    monkeypatch.setattr(slow.config, "timeout_seconds", 0.5)
    with pytest.raises(ImageGenerationError, match="didn't finish within"):
        await slow(ImageRequest(prompt="slow please"), progress)
    assert [kind for kind, _ in server.state.cancelled] == ["queue", "interrupt"]
    prompt_id = server.state.cancelled[0][1]["delete"][0]
    assert server.state.cancelled[1][1] == {"prompt_id": prompt_id}

    server.state.cancelled.clear()
    task = asyncio.create_task(generator(settings(server))(ImageRequest(prompt="slow"), progress))
    await asyncio.sleep(0.5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert [kind for kind, _ in server.state.cancelled] == ["queue", "interrupt"]


async def test_status_explains_what_is_missing_and_caches_the_probe(server):
    status = lambda value: generator(value).status()  # noqa: E731
    assert (await status(ComfyUIParameters())).detail == "Set the ComfyUI server address"
    assert "checkpoint" in (await status(ComfyUIParameters(base_url=server.url))).detail
    with pytest.raises(ValueError, match="{{prompt}}"):
        ComfyUIParameters(base_url=server.url, workflow={"1": {"class_type": "X", "inputs": {}}})
    ready = await status(settings(server))
    assert ready.ready and ready.detail == f"ComfyUI at {server.url}"
    calls = len(server.state.headers)
    await status(settings(server))
    assert len(server.state.headers) == calls
    down = await status(ComfyUIParameters(base_url="http://127.0.0.1:9", checkpoint="a"))
    assert not down.ready and "isn't reachable" in down.detail


async def test_settings_and_test_connection_use_the_component_layer(images_api, server):
    from asterism.domains.components.registry import component_registry
    from asterism.domains.image_generation.local.provider import Diffusers

    # Diffusers is the untestable example; registered here so this runs without the local-image extra.
    component_registry.register()(Diffusers)
    client, sessions = images_api
    listed = (await client.get("/components/by_type/ImageGenerator", headers=auth())).json()["items"]
    testable = {item["name"]: item["testable"] for item in listed}
    assert testable["ComfyUI"] is True and testable["Diffusers"] is False
    schema = next(item for item in listed if item["name"] == "ComfyUI")["parameters"]["properties"]
    assert schema["verify_tls"]["type"] == "boolean" and schema["workflow"]["examples"]

    parameters = {"base_url": f"{server.url}/", "auth": "bearer", "token": "secret", "checkpoint": "sdxl.safetensors"}
    saved = await client.put(
        SETTING, headers=auth("admin"), json={"value": {"name": "ComfyUI", "parameters": parameters}}
    )
    assert saved.status_code == 200, saved.text
    async with sessions() as db:
        stored = (await db.get(ApplicationSettingsModel, "image_generator_provider")).value
    # Normalized against the parameter model, typed values kept, the token encrypted.
    assert stored["parameters"]["base_url"] == server.url and stored["parameters"]["steps"] == 25
    assert stored["parameters"]["verify_tls"] is True and stored["parameters"]["token"].startswith("enc:v1:")
    shown = (await client.get("/settings/app", headers=auth("admin"))).json()["image_generator_provider"]
    assert shown["parameters"]["token"] == "**********"

    # Saving the redacted token back keeps the stored one; testing with it uses the stored one too.
    echoed = {**shown["parameters"], "steps": 30}
    kept = await client.put(SETTING, headers=auth("admin"), json={"value": {"name": "ComfyUI", "parameters": echoed}})
    assert kept.status_code == 200, kept.text
    server.state.token = "secret"
    test = (await client.post(TEST, headers=auth("admin"), json={"parameters": echoed})).json()
    assert test == {
        "ok": True,
        "detail": "Connected to ComfyUI 0.9.1 on cuda:0 Fake GPU",
        "suggestions": {"checkpoint": ["sdxl.safetensors", "flux.safetensors"]},
    }
    wrong = (await client.post(TEST, headers=auth("admin"), json={"parameters": {**echoed, "token": "nope"}})).json()
    assert wrong["ok"] is False and wrong["detail"] == "ComfyUI refused the credentials"
    missing = {**echoed, "checkpoint": "gone.safetensors"}
    assert (
        "no checkpoint named gone"
        in (await client.post(TEST, headers=auth("admin"), json={"parameters": missing})).json()["detail"]
    )
    invalid = (await client.post(TEST, headers=auth("admin"), json={"parameters": {"base_url": "ftp://x"}})).json()
    assert invalid == {
        "ok": False,
        "detail": "base_url: Use an http:// or https:// address without a query",
        "suggestions": {},
    }
    # Only admins test, and only testable components.
    assert (await client.post(TEST, headers=auth("a"), json={"parameters": echoed})).status_code in (401, 403)
    untestable = await client.post("/components/ImageGenerator/Diffusers/test", headers=auth("admin"), json={})
    assert untestable.status_code == 400
    assert (
        await client.post("/components/ImageGenerator/Nope/test", headers=auth("admin"), json={})
    ).status_code == 404

    # The parameter model's checks give the reason on save.
    ui_format = {**echoed, "workflow": {"nodes": [], "links": []}}
    refused = await client.put(
        SETTING, headers=auth("admin"), json={"value": {"name": "ComfyUI", "parameters": ui_format}}
    )
    assert refused.status_code == 400 and "workflow: This is ComfyUI's UI format" in refused.text
    bad_url = {**echoed, "base_url": "ftp://x"}
    refused = await client.put(
        SETTING, headers=auth("admin"), json={"value": {"name": "ComfyUI", "parameters": bad_url}}
    )
    assert refused.status_code == 400 and "base_url" in refused.text


async def test_chat_generation_saves_images_from_comfyui(images_api, server):
    client, sessions = images_api
    await set_policy(
        sessions, provider="ComfyUI", parameters={"base_url": server.url, "checkpoint": "sdxl.safetensors"}
    )
    availability = (await client.get("/image-generation/availability", headers=auth())).json()
    assert availability == {"available": True, "reason": ""}

    chat_id, _, _ = await started_chat(client, sessions)
    images = await generate_images(
        user_id="a", chat_id=chat_id, request=ImageRequest(prompt="A lighthouse", width=256, height=256, seed=3)
    )
    assert [(image.width, image.height, image.seed, image.model) for image in images] == [
        (256, 256, 3, "sdxl.safetensors")
    ]
