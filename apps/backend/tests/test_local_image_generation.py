"""US-76.2: local diffusers generator: hardware, catalog, recommendation, worker (ADR-0064).

US-94.2: the generator is an optional install. These tests run on both installs:
the ones that need torch skip without the ``local-image`` extra, the rest register
the Diffusers component themselves, and the "not installed" tests remove it.
"""

import asyncio
import io
import subprocess
import sys
import uuid
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from asterism.domains.components.registry import component_registry
from asterism.domains.components.schemas import ComponentType
from asterism.domains.image_generation.local import availability, catalog, downloads, provider
from asterism.domains.image_generation.local.catalog import BY_ID, CATALOG
from asterism.domains.image_generation.local.hardware import HardwareReport, cpu_bf16, detect, mps_bf16
from asterism.domains.image_generation.local.planning import dtype_for, plan, recommend
from asterism.domains.image_generation.local.runtime import OOM_MESSAGE, LocalRuntime, WorkerKey
from asterism.domains.image_generation.providers import ImageGenerationError
from asterism.domains.image_generation.schemas import ImageProgress, ImageRequest
from asterism.domains.image_generation.service import generate_images
from asterism.domains.knowledge.model_download import ModelDownloadService
from asterism.domains.settings.models import ApplicationSettingsModel
from sqlalchemy import delete
from test_canvas import canvas_api as _canvas_api
from test_canvas import started_chat
from test_image_generation import set_policy
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
needs_local_image = pytest.mark.skipif(
    not availability.local_image_installed(), reason="needs the local-image extra (uv sync --extra local-image)"
)
project_api = _project_api
canvas_api = _canvas_api
STUB = WorkerKey(model_dir="unused", pipeline="stub", device="cpu", mode="device", dtype="bfloat16")


def hardware(device="cuda", memory=24.0, ram=64.0, bf16=None) -> HardwareReport:
    return HardwareReport(
        device=device,
        name="Test",
        memory_gb=memory,
        free_gb=memory if device == "cuda" else None,
        system_ram_gb=ram,
        cpu_count=8,
        bf16=device != "cpu" if bf16 is None else bf16,
        available=[device, "cpu"] if device != "cpu" else ["cpu"],
    )


async def test_catalog_is_pinned_and_licensed():
    assert [entry.id for entry in CATALOG] == [
        "qwen-image-2.1-turbo",
        "qwen-image-2.1",
        "z-image-turbo",
        "flux2-klein-4b",
        "dreamshaper-xl-lightning",
        "dreamshaper-8-lcm",
    ]
    for entry in CATALOG:
        assert len(entry.revision) == 40 and entry.license and entry.pipeline
        assert entry.pinned().revision == entry.revision
        patterns = entry.pinned().allow_patterns
        # Only the diffusers folders download, never single-file checkpoints or extra copies.
        assert "model_index.json" in patterns and "*" not in patterns and not any(".ckpt" in p for p in patterns)
        assert not any("safety_checker" in p for p in patterns)
    assert not BY_ID["qwen-image-2.1-turbo"].commercial_use and BY_ID["z-image-turbo"].commercial_use
    sdxl = BY_ID["dreamshaper-xl-lightning"].pinned().allow_patterns
    assert "unet/diffusion_pytorch_model.fp16.safetensors" in sdxl
    assert "unet/diffusion_pytorch_model.safetensors" not in sdxl


async def test_recommendation_follows_the_hardware():
    def best(report):
        found = recommend(report)
        return found.id if found else None

    assert best(hardware("cuda", 48)) == "qwen-image-2.1-turbo"
    assert plan(BY_ID["qwen-image-2.1-turbo"], hardware("cuda", 48)).mode == "device"
    # A 24 GB GPU runs Qwen with offload when system memory holds the whole model.
    assert plan(BY_ID["qwen-image-2.1-turbo"], hardware("cuda", 24, ram=64)).mode == "offload"
    assert best(hardware("cuda", 24, ram=32)) == "z-image-turbo"
    assert best(hardware("cuda", 12, ram=32)) == "flux2-klein-4b"
    assert not plan(BY_ID["flux2-klein-4b"], hardware("cuda", 8)).fits
    # Small GPUs get the Stable Diffusion fine-tunes.
    assert best(hardware("cuda", 8, ram=16)) == "dreamshaper-xl-lightning"
    assert plan(BY_ID["dreamshaper-xl-lightning"], hardware("cuda", 8, ram=16)).mode == "offload"
    assert best(hardware("cuda", 6, ram=16)) == "dreamshaper-8-lcm"
    assert plan(BY_ID["dreamshaper-8-lcm"], hardware("cuda", 4, ram=8)).mode == "device"
    assert plan(BY_ID["dreamshaper-8-lcm"], hardware("cuda", 3, ram=8)).mode == "offload"
    assert best(hardware("cuda", 2, ram=8)) is None
    # Apple Silicon: a share of unified memory, no offload.
    assert best(hardware("mps", 64)) == "qwen-image-2.1-turbo"
    assert best(hardware("mps", 36)) == "z-image-turbo"
    assert best(hardware("mps", 16)) == "dreamshaper-xl-lightning"
    assert best(hardware("mps", 8)) == "dreamshaper-8-lcm"
    assert best(hardware("mps", 2)) is None
    # On the CPU the smallest model that fits wins, even with room for larger ones.
    # It runs in float32, so it needs twice the memory.
    assert plan(BY_ID["z-image-turbo"], hardware("cpu", 64)).fits
    assert not plan(BY_ID["z-image-turbo"], hardware("cpu", 32)).fits
    assert "minutes" in plan(BY_ID["z-image-turbo"], hardware("cpu", 64)).detail
    assert best(hardware("cpu", 64)) == "dreamshaper-8-lcm"
    assert "seconds" in plan(BY_ID["dreamshaper-8-lcm"], hardware("cpu", 8)).detail
    assert best(hardware("cpu", 4)) is None


async def test_precision_follows_the_os_processor_and_model():
    qwen, small = BY_ID["qwen-image-2.1-turbo"], BY_ID["dreamshaper-8-lcm"]
    # Native bf16 everywhere it's fast.
    assert dtype_for(qwen, hardware("cuda", 48)) == "bfloat16"
    assert dtype_for(small, hardware("cpu", 16, bf16=True)) == "bfloat16"
    # Without it: fp16 on a GPU for models trained in fp16, float32 otherwise.
    assert dtype_for(small, hardware("cuda", 8, bf16=False)) == "float16"
    assert dtype_for(small, hardware("mps", 8, bf16=False)) == "float16"
    assert dtype_for(qwen, hardware("cuda", 48, bf16=False)) == "float32"
    assert dtype_for(small, hardware("cpu", 16)) == "float32"
    # float32 doubles the memory: Qwen doesn't fit a 48 GB pre-Ampere GPU fully.
    assert plan(qwen, hardware("cuda", 48, ram=128, bf16=False)).mode == "offload"
    assert not plan(qwen, hardware("cuda", 48, ram=64, bf16=False)).fits
    # A CPU with native bf16 fits Z-Image in 32 GB; one without needs 64 GB.
    assert plan(BY_ID["z-image-turbo"], hardware("cpu", 32, bf16=True)).fits

    # Which CPUs count as having fast bf16.
    assert cpu_bf16({"avx512_bf16": True}, "Linux") and cpu_bf16({"amx_bf16": True}, "Windows")
    assert cpu_bf16({"sve_bf16": True}, "Linux")
    assert not cpu_bf16({"avx2": True, "avx512_f": True}, "Linux")
    # Apple CPUs report ARM bf16, but PyTorch runs it far slower than float32.
    assert not cpu_bf16({"bf16": True, "sve_bf16": True}, "Darwin")
    assert mps_bf16("Apple M5 Max", True) and not mps_bf16("Apple M1 Pro", True)
    assert not mps_bf16("Apple M3", False)


async def test_requests_are_scaled_to_the_model_native_size():
    assert provider.native_size(1024, 1024, 1024) == (1024, 1024)
    assert provider.native_size(1024, 1024, 512) == (512, 512)
    assert provider.native_size(1536, 864, 512) == (704, 384)
    # Smaller requests are kept.
    assert provider.native_size(256, 256, 512) == (256, 256)


@needs_local_image
async def test_detection_reports_this_machine():
    report = detect()
    assert report.device in report.available and report.available[-1] == "cpu"
    assert report.system_ram_gb > 0 and report.cpu_count >= 1
    assert detect("cpu").device == "cpu"


async def collect():
    events: list[ImageProgress] = []

    async def progress(update):
        events.append(update)

    return events, progress


async def test_the_worker_runs_in_its_own_process_and_is_reused():
    runtime = LocalRuntime(idle_seconds=60)
    events, progress = await collect()
    try:
        images = await runtime.generate(
            STUB, {"prompt": "a fox", "width": 64, "height": 48, "count": 2, "seed": 7, "steps": 3}, progress
        )
        from PIL import Image

        assert [seed for _, seed in images] == [7, 8]
        assert Image.open(io.BytesIO(images[0][0])).size == (64, 48)
        assert [(e.stage, e.step, e.total) for e in events] == [
            ("loading", None, None),
            *[("running", step, 6) for step in range(1, 7)],
        ]
        pid = runtime._worker.process.pid  # type: ignore[union-attr]
        await runtime.generate(STUB, {"prompt": "again", "width": 32, "height": 32, "count": 1, "seed": 1}, progress)
        assert runtime._worker.process.pid == pid  # type: ignore[union-attr]
    finally:
        await runtime.stop()
    assert runtime.running is None


async def test_crashes_and_out_of_memory_are_contained():
    runtime = LocalRuntime(idle_seconds=60)
    _, progress = await collect()
    job = {"width": 32, "height": 32, "count": 1, "seed": 1}
    try:
        with pytest.raises(ImageGenerationError, match="stopped unexpectedly"):
            await runtime.generate(STUB, {**job, "prompt": "crash"}, progress)
        assert runtime.running is None
        # The next job starts a fresh worker.
        assert await runtime.generate(STUB, {**job, "prompt": "fine"}, progress)
        with pytest.raises(ImageGenerationError) as raised:
            await runtime.generate(STUB, {**job, "prompt": "oom"}, progress)
        assert str(raised.value) == OOM_MESSAGE and runtime.running is None
        # A model that can't load reports the failure and leaves no worker.
        with pytest.raises(ImageGenerationError, match="Loading the model failed"):
            await runtime.generate(replace(STUB, pipeline="NoSuchPipeline"), {**job, "prompt": "x"}, progress)
        assert runtime.running is None
    finally:
        await runtime.stop()


async def test_cancelling_kills_the_worker_and_idle_workers_stop():
    runtime = LocalRuntime(idle_seconds=0.3)
    _, progress = await collect()
    job = {"prompt": "a", "width": 32, "height": 32, "count": 1, "seed": 1}
    try:
        await runtime.generate(STUB, job, progress)
        assert runtime.running == STUB
        await asyncio.sleep(1.0)
        assert runtime.running is None

        task = asyncio.create_task(runtime.generate(STUB, job, progress))
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert runtime.running is None
    finally:
        await runtime.stop()


@pytest.fixture
def local(images_api, monkeypatch, tmp_path):
    """The diffusers provider on the stub pipeline, with downloads stubbed."""
    from asterism.core import config

    monkeypatch.setattr(config, "storage_root", tmp_path)
    # As an install with the extra, so the stub-pipeline tests also run without it.
    from asterism.domains.image_generation.local import router

    component_registry.register()(provider.Diffusers)
    monkeypatch.setattr(router, "local_image_installed", lambda: True)
    downloads._SERVICES.clear()
    stub = replace(BY_ID["flux2-klein-4b"], id="stub", pipeline="stub", steps=3)
    monkeypatch.setitem(catalog.BY_ID, "stub", stub)
    monkeypatch.setattr(provider, "cached_detect", lambda device="auto": hardware("cuda", 48))
    ready = {"value": True}
    monkeypatch.setattr(ModelDownloadService, "ready", lambda self: asyncio.sleep(0, ready["value"]))
    started = AsyncMock()
    monkeypatch.setattr(ModelDownloadService, "start_download", started)
    runtime = LocalRuntime(idle_seconds=60)
    monkeypatch.setattr(provider, "runtime", runtime)
    return images_api, ready, started


@pytest.fixture
def images_api(canvas_api, monkeypatch, tmp_path):
    from asterism.domains.files.store import LocalFileStore

    store = LocalFileStore(tmp_path / "files")
    monkeypatch.setattr("asterism.domains.files.service.get_file_store", lambda: store)
    monkeypatch.setattr("asterism.domains.files.service.start_ingestion", lambda **_: None)
    return canvas_api


async def select(sessions, model_id):
    async with sessions() as db:
        await db.execute(
            delete(ApplicationSettingsModel).where(ApplicationSettingsModel.key == "image_generation_local")
        )
        db.add(ApplicationSettingsModel(key="image_generation_local", value={"model_id": model_id, "device": "auto"}))
        await db.commit()


async def test_the_provider_reports_status_and_generates_through_the_worker(local):
    (client, sessions), ready, _ = local
    await set_policy(sessions, provider="Diffusers")
    availability = lambda: client.get("/image-generation/availability", headers=auth())  # noqa: E731
    assert (await availability()).json()["reason"] == "Choose a local model"
    await select(sessions, "stub")
    ready["value"] = False
    assert (await availability()).json()["reason"].startswith("Download ")
    ready["value"] = True
    assert (await availability()).json() == {"available": True, "reason": ""}

    chat_id, _, _ = await started_chat(client, sessions)
    try:
        images = await generate_images(
            user_id="a", chat_id=chat_id, request=ImageRequest(prompt="A heron", width=256, height=256, seed=5)
        )
        assert [(image.width, image.height, image.seed) for image in images] == [(256, 256, 5)]
        assert images[0].model == "black-forest-labs/FLUX.2-klein-4B"
        with pytest.raises(Exception, match="ran out of memory"):
            await generate_images(user_id="a", chat_id=chat_id, request=ImageRequest(prompt="oom please"))
    finally:
        await provider.runtime.stop()


async def test_admin_endpoints_show_hardware_and_gate_licenses(local, monkeypatch):
    (client, sessions), _, started = local
    from asterism.domains.image_generation.local import router

    monkeypatch.setattr(router, "detect", lambda device="auto": hardware("cuda", 24, ram=64))
    url = "/settings/app/image-generation/local"
    assert (await client.get(url, headers=auth("a"))).status_code == 403
    overview = (await client.get(url, headers=auth("admin"))).json()
    assert overview["hardware"]["device"] == "cuda" and overview["recommended_id"] == "qwen-image-2.1-turbo"
    plans = {model["id"]: model["plan"]["mode"] for model in overview["models"]}
    assert plans == {
        "qwen-image-2.1-turbo": "offload",
        "qwen-image-2.1": "offload",
        # About 23 GB plus headroom doesn't fit 24 GB fully.
        "z-image-turbo": "offload",
        "flux2-klein-4b": "device",
        "dreamshaper-xl-lightning": "device",
        "dreamshaper-8-lcm": "device",
    }
    assert {model["id"]: model["license_accepted"] for model in overview["models"]}["z-image-turbo"] is True

    assert (await client.put(url, headers=auth("admin"), json={"model_id": "nope"})).status_code == 404
    chosen = await client.put(url, headers=auth("admin"), json={"model_id": "qwen-image-2.1-turbo", "device": "cuda"})
    assert chosen.json()["settings"]["model_id"] == "qwen-image-2.1-turbo"

    # A non-commercial license must be accepted before downloading, and acceptance is recorded.
    download = f"{url}/models/qwen-image-2.1-turbo/download"
    refused = await client.post(download, headers=auth("admin"), json={})
    assert refused.status_code == 400 and "Qwen Research License" in refused.text
    started.assert_not_called()
    accepted = await client.post(download, headers=auth("admin"), json={"accept_license": True})
    assert accepted.status_code == 200, accepted.text
    started.assert_awaited_once()
    assert accepted.json()["settings"]["accepted_licenses"] == ["qwen-image-2.1-turbo"]
    assert (
        await client.post(f"{url}/models/z-image-turbo/download", headers=auth("admin"), json={})
    ).status_code == 200

    removed = await client.delete(f"{url}/models/flux2-klein-4b", headers=auth("admin"))
    assert removed.status_code == 200
    assert (await client.delete(f"{url}/models/nope", headers=auth("admin"))).status_code == 404


# ---------------------------------------------------------------------------
# US-94.2: an install without the local-image extra
# ---------------------------------------------------------------------------


async def test_the_extra_is_installed_only_when_every_package_is_found(monkeypatch):
    found = {name: object() for name in availability.LOCAL_IMAGE_PACKAGES}
    monkeypatch.setattr(availability.importlib.util, "find_spec", lambda name: found.get(name))
    availability.local_image_installed.cache_clear()
    try:
        assert availability.local_image_installed() is True
        del found["torch"]
        availability.local_image_installed.cache_clear()
        assert availability.local_image_installed() is False
    finally:
        availability.local_image_installed.cache_clear()


async def test_the_registry_offers_diffusers_exactly_when_the_extra_is_installed():
    # A fresh process, so no test's own registration counts.
    probe = (
        "from asterism.domains.components.catalog import ensure_loaded; ensure_loaded();"
        "from asterism.domains.components.registry import component_registry;"
        "from asterism.domains.components.schemas import ComponentType;"
        "names = [c.name for c in component_registry.get_providers(ComponentType.ImageGenerator)];"
        "print(','.join(sorted(names)))"
    )
    names = subprocess.run([sys.executable, "-c", probe], check=True, capture_output=True, text=True).stdout
    expected = ["ComfyUI", "Diffusers", "ONNX"] if availability.local_image_installed() else ["ComfyUI", "ONNX"]
    assert names.strip().split(",") == expected


@pytest.fixture
def without_extra(local, monkeypatch):
    """The ``local`` fixture as an image without the extra would see it."""
    from asterism.domains.image_generation.local import router

    key = component_registry._make_key(ComponentType.ImageGenerator, "Diffusers")
    monkeypatch.delitem(component_registry.providers_by_unique_id, key)
    monkeypatch.setitem(
        component_registry.providers_by_type,
        ComponentType.ImageGenerator,
        [c for c in component_registry.get_providers(ComponentType.ImageGenerator) if c.name != "Diffusers"],
    )
    monkeypatch.setattr(router, "local_image_installed", lambda: False)
    monkeypatch.setattr(router, "detect", lambda device="auto": pytest.fail("detected hardware without torch"))
    return local


async def test_a_saved_local_generator_reads_as_not_available_and_is_never_replaced(without_extra):
    (client, sessions), _, _ = without_extra
    await set_policy(sessions, provider="Diffusers")
    await select(sessions, "stub")

    status = (await client.get("/settings/app/image-generation/status", headers=auth("admin"))).json()
    assert status == {
        "provider": "Diffusers",
        "ready": False,
        "detail": "Diffusers is not available in this image. Choose ONNX to generate images on this server's CPU",
    }
    available = (await client.get("/image-generation/availability", headers=auth())).json()
    assert available == {
        "available": False,
        "reason": "Diffusers is not available in this image. Choose ONNX to generate images on this server's CPU",
    }

    # The saved choice stays stored and readable; it is not swapped for ComfyUI.
    settings = (await client.get("/settings/app", headers=auth("admin"))).json()
    assert settings["image_generator_provider"]["name"] == "Diffusers"
    listed = (await client.get("/components/by_type/ImageGenerator", headers=auth("admin"))).json()
    names = [item["name"] for item in listed["items"]]
    assert "ComfyUI" in names and "Diffusers" not in names
    tried = await client.post("/settings/app/image-generation/test", headers=auth("admin"), json={"prompt": "A heron"})
    assert tried.status_code == 400 and "Diffusers is not available in this image" in tried.text


async def test_the_local_catalog_and_downloads_are_hidden_without_the_extra(without_extra):
    (client, sessions), _, started = without_extra
    await select(sessions, "stub")
    url = "/settings/app/image-generation/local"

    overview = (await client.get(url, headers=auth("admin"))).json()
    assert overview["installed"] is False
    assert overview["models"] == [] and overview["hardware"] is None and overview["recommended_id"] is None
    assert overview["settings"]["model_id"] == "stub"

    for method, path, body in [
        ("PUT", url, {"model_id": "flux2-klein-4b"}),
        ("POST", f"{url}/models/flux2-klein-4b/download", {"accept_license": True}),
        ("DELETE", f"{url}/models/flux2-klein-4b/download", None),
        ("DELETE", f"{url}/models/flux2-klein-4b", None),
    ]:
        response = await client.request(method, path, headers=auth("admin"), json=body)
        assert response.status_code == 400 and "not available in this image" in response.text, (method, path)
    started.assert_not_called()


async def test_generate_image_is_not_offered_for_a_local_generator_without_the_extra(without_extra):
    from asterism.domains.agent.service import get_main_agent_profile
    from asterism.domains.chat.tool_policy import resolve_effective_tools
    from test_chat_models import A

    (client, sessions), ready, _ = without_extra
    await set_policy(sessions, provider="Diffusers")
    await select(sessions, "stub")
    ready["value"] = True
    chat_id, _, _ = await started_chat(client, sessions)
    main = await get_main_agent_profile("a")

    tools = (await resolve_effective_tools(user_id="a", chat_id=chat_id, profile=main, model_id=uuid.UUID(A)))[0]
    assert "generate_image" not in tools
