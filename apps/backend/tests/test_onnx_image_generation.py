"""US-94.4: the ONNX image generator: schedulers, pipeline, provider and admin endpoints (ADR-0077)."""

from dataclasses import dataclass, replace
from pathlib import Path
from unittest.mock import AsyncMock

import numpy as np
import pytest
from asterism.domains.components.registry import component_registry
from asterism.domains.components.schemas import ComponentType
from asterism.domains.image_generation.local import worker
from asterism.domains.image_generation.onnx import catalog, downloads, planning, provider, schedulers
from asterism.domains.image_generation.onnx.catalog import OnnxCatalogEntry
from asterism.domains.image_generation.onnx.pipeline import OnnxDiffusionPipeline
from asterism.domains.image_generation.schemas import ImageRequest
from asterism.domains.knowledge.model_download import ModelDownloadService
from asterism.domains.settings.models import ApplicationSettingsModel
from sqlalchemy import delete
from test_canvas import canvas_api as _canvas_api
from test_image_generation import set_policy
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
canvas_api = _canvas_api
SCHEDULER = {"num_train_timesteps": 1000, "beta_start": 0.00085, "beta_end": 0.012, "original_inference_steps": 50}


# ---------------------------------------------------------------------------
# Schedulers
# ---------------------------------------------------------------------------


async def test_lcm_takes_evenly_spaced_timesteps_from_its_distillation_schedule():
    assert schedulers.lcm_timesteps(4).tolist() == [999, 759, 499, 259]
    assert schedulers.lcm_timesteps(1).tolist() == [999]
    with pytest.raises(ValueError):
        schedulers.lcm_timesteps(0)


async def test_sdxl_turbo_steps_trail_back_from_the_last_training_step():
    assert schedulers.trailing_timesteps(1).tolist() == [999]
    assert schedulers.trailing_timesteps(4).tolist() == [999, 749, 499, 249]


async def test_the_lcm_guidance_embedding_is_sinusoidal_in_scale_minus_one():
    embedding = schedulers.guidance_embedding(1.0)
    assert embedding.shape == (1, 256) and embedding.dtype == np.float32
    # A scale of 1 embeds zero: sines 0, cosines 1.
    assert np.allclose(embedding[0, :128], 0.0) and np.allclose(embedding[0, 128:], 1.0)
    assert not np.allclose(schedulers.guidance_embedding(8.0), embedding)


async def test_an_lcm_step_denoises_on_the_last_step_and_renoises_before_it():
    alphas = schedulers.scaled_linear_alphas_cumprod(0.00085, 0.012, 1000)
    rng = np.random.default_rng(0)
    latents, prediction = rng.standard_normal((1, 4, 8, 8)), rng.standard_normal((1, 4, 8, 8))

    last = schedulers.lcm_step(latents, prediction, 259, None, alphas, None)
    original = (latents - np.sqrt(1 - alphas[259]) * prediction) / np.sqrt(alphas[259])
    c_skip = 0.25 / ((259 * 10.0) ** 2 + 0.25)
    c_out = 2590.0 / np.sqrt(2590.0**2 + 0.25)
    assert np.allclose(last, c_out * original + c_skip * latents)

    noise = rng.standard_normal(latents.shape)
    earlier = schedulers.lcm_step(latents, prediction, 999, 759, alphas, noise)
    denoised = schedulers.lcm_step(latents, prediction, 999, None, alphas, None)
    assert np.allclose(earlier, np.sqrt(alphas[759]) * denoised + np.sqrt(1 - alphas[759]) * noise)
    with pytest.raises(ValueError):
        schedulers.lcm_step(latents, prediction, 999, 759, alphas, None)


async def test_a_final_euler_ancestral_step_lands_on_the_predicted_image():
    latents, prediction = np.full((1, 4, 2, 2), 3.0), np.full((1, 4, 2, 2), 0.5)
    stepped = schedulers.euler_ancestral_step(latents, prediction, 14.6, 0.0, None)
    assert np.allclose(stepped, latents - 14.6 * prediction)
    with pytest.raises(ValueError):
        schedulers.euler_ancestral_step(latents, prediction, 14.6, 7.0, None)


async def test_sigmas_follow_the_schedule_and_end_at_zero():
    alphas = schedulers.scaled_linear_alphas_cumprod(0.00085, 0.012, 1000)
    sigmas = schedulers.euler_sigmas(np.asarray([999]), alphas)
    assert sigmas[-1] == 0.0 and np.isclose(sigmas[0], np.sqrt((1 - alphas[999]) / alphas[999]))


# ---------------------------------------------------------------------------
# The pipeline, on fake sessions
# ---------------------------------------------------------------------------


@dataclass
class Node:
    name: str
    type: str = "tensor(float)"


class FakeTokenizer:
    model_max_length = 77

    def __call__(self, prompt, **_kwargs):
        return {"input_ids": np.full((1, 77), len(prompt) % 50, dtype=np.int64)}


class FakeSession:
    def __init__(self, inputs, outputs, run):
        self._inputs, self._outputs, self._run = inputs, outputs, run
        self.feeds: list[dict] = []

    def get_inputs(self):
        return self._inputs

    def get_outputs(self):
        return [Node(name) for name in self._outputs]

    def run(self, _names, feed):
        self.feeds.append(feed)
        return self._run(feed)


def encoder(width: int, pooled: bool = False) -> FakeSession:
    names = (["text_embeds"] if pooled else []) + ["last_hidden_state"] + [f"hidden_states.{i}" for i in range(3)]

    def run(feed):
        value = float(feed["input_ids"][0, 0])
        outputs = {"text_embeds": np.full((1, 1280), value, dtype=np.float32)} if pooled else {}
        outputs["last_hidden_state"] = np.full((1, 77, width), value + 10, dtype=np.float32)
        for i in range(3):
            outputs[f"hidden_states.{i}"] = np.full((1, 77, width), value + i, dtype=np.float32)
        return [outputs[name] for name in names]

    return FakeSession([Node("input_ids", "tensor(int32)")], names, run)


def unet(extra_inputs: list[Node]) -> FakeSession:
    inputs = [Node("sample"), Node("timestep", "tensor(int64)"), Node("encoder_hidden_states"), *extra_inputs]
    return FakeSession(inputs, ["out_sample"], lambda feed: [feed["sample"] * 0.1])


def vae() -> FakeSession:
    def run(feed):
        latents = feed["latent_sample"]
        _, _, h, w = latents.shape
        return [np.tanh(np.repeat(np.repeat(latents[:, :3], 8, axis=2), 8, axis=3))]

    return FakeSession([Node("latent_sample")], ["sample"], run)


def lcm_pipeline() -> OnnxDiffusionPipeline:
    return OnnxDiffusionPipeline(
        "lcm", [FakeTokenizer()], [encoder(768)], unet([Node("timestep_cond")]), vae(), SCHEDULER
    )


def sdxl_pipeline() -> OnnxDiffusionPipeline:
    return OnnxDiffusionPipeline(
        "sdxl",
        [FakeTokenizer(), FakeTokenizer()],
        [encoder(768), encoder(1280, pooled=True)],
        unet([Node("text_embeds"), Node("time_ids")]),
        vae(),
        SCHEDULER,
    )


class Seed:
    def __init__(self, seed):
        self.seed = seed

    def initial_seed(self):
        return self.seed


async def test_lcm_runs_one_unet_pass_per_step_with_the_guidance_embedding():
    pipeline = lcm_pipeline()
    steps: list[int] = []
    image = pipeline(
        prompt="a fox",
        width=64,
        height=48,
        num_inference_steps=4,
        guidance_scale=8.0,
        generator=Seed(3),
        callback_on_step_end=lambda pipe, step, _t, kwargs: steps.append(step) or kwargs,
    ).images[0]

    assert image.size == (64, 48)
    assert steps == [0, 1, 2, 3] and pipeline.num_timesteps == 4
    feeds = pipeline.unet.feeds
    assert [int(feed["timestep"][0]) for feed in feeds] == [999, 759, 499, 259]
    assert feeds[0]["sample"].shape == (1, 4, 6, 8) and feeds[0]["encoder_hidden_states"].shape == (1, 77, 768)
    assert np.array_equal(feeds[0]["timestep_cond"], schedulers.guidance_embedding(8.0))


async def test_sdxl_joins_both_encoders_penultimate_layers_and_conditions_on_size():
    pipeline = sdxl_pipeline()
    pipeline(prompt="a fox", width=64, height=32, num_inference_steps=1, generator=Seed(1))

    (feed,) = pipeline.unet.feeds
    assert int(feed["timestep"][0]) == 999
    hidden = feed["encoder_hidden_states"]
    assert hidden.shape == (1, 77, 2048)
    # Penultimate is hidden_states.1: the prompt's value plus one, from each encoder.
    assert np.all(hidden == len("a fox") % 50 + 1)
    assert feed["text_embeds"].shape == (1, 1280)
    assert feed["time_ids"].tolist() == [[32, 64, 0, 0, 32, 64]]


async def test_a_seed_gives_the_same_image_and_another_seed_a_different_one():
    def pixels(seed):
        return np.asarray(
            lcm_pipeline()(prompt="x", width=32, height=32, num_inference_steps=2, generator=Seed(seed)).images[0]
        )

    assert np.array_equal(pixels(5), pixels(5))
    assert not np.array_equal(pixels(5), pixels(6))


async def test_sizes_must_be_multiples_of_eight():
    with pytest.raises(ValueError, match="multiples of 8"):
        lcm_pipeline()(prompt="x", width=60, height=64, num_inference_steps=1, generator=Seed(0))


async def test_the_worker_gives_onnx_pipelines_a_seed_without_torch():
    generator = worker._generator(42, f"{worker.ONNX_PREFIX}lcm")
    assert generator.initial_seed() == 42


# ---------------------------------------------------------------------------
# Catalog, planning, provider and endpoints
# ---------------------------------------------------------------------------

STUB = OnnxCatalogEntry(
    id="stub-lcm",
    name="Stub LCM",
    repo="davidb727/stub",
    revision="0" * 40,
    family="lcm",
    license="CreativeML Open RAIL-M",
    license_url="https://example.test/LICENSE",
    commercial_use=True,
    description="A test model.",
    files={"unet/model.onnx": "a" * 64},
    download_gb=1.6,
    memory_gb=5.2,
    seconds_per_image=5,
    steps=4,
    max_steps=8,
    guidance=8.0,
)
RESTRICTED = replace(
    STUB,
    id="stub-sdxl",
    family="sdxl",
    license="Stability AI Community License",
    commercial_use=False,
    attribution="Powered by Stability AI",
    memory_gb=7.9,
    steps=1,
    max_steps=4,
    guidance=0.0,
)


async def test_the_catalog_is_pinned_to_published_files():
    for entry in catalog.CATALOG:
        assert entry.repo.startswith(f"{catalog.PUBLISHER}/") and len(entry.revision) == 40
        assert entry.files and all(len(digest) == 64 for digest in entry.files.values())
        assert "LICENSE" in entry.files or "LICENSE.md" in entry.files
        assert "NOTICE" in entry.files and entry.family in ("lcm", "sdxl")
        pinned = entry.pinned()
        assert pinned.files == entry.files and pinned.revision == entry.revision
        assert 1 <= entry.steps <= entry.max_steps


async def test_a_model_fits_when_its_peak_and_headroom_are_within_most_of_memory():
    assert planning.plan(STUB, 16).fits
    small = planning.plan(STUB, 6)
    assert not small.fits and "this server has 6 GB" in small.detail


async def test_onnx_is_registered_in_every_install():
    assert component_registry.find(ComponentType.ImageGenerator, "ONNX") is provider.Onnx


@pytest.fixture
def onnx_api(images_api, monkeypatch, tmp_path):
    """The ONNX provider on a stub catalog, with downloads and the worker stubbed."""
    from asterism.core import config
    from asterism.domains.image_generation.onnx import router

    monkeypatch.setattr(config, "storage_root", tmp_path)
    downloads._SERVICES.clear()
    for module in (catalog, provider, router):
        monkeypatch.setattr(
            module, "entry", lambda model_id: {STUB.id: STUB, RESTRICTED.id: RESTRICTED}.get(model_id), raising=False
        )
    monkeypatch.setattr(router, "CATALOG", (STUB, RESTRICTED))
    monkeypatch.setattr("asterism.domains.image_generation.onnx.planning.CATALOG", (STUB, RESTRICTED))
    for module in (provider, router):
        monkeypatch.setattr(module, "server_ram_gb", lambda: 16.0)
    ready = {"value": True}
    monkeypatch.setattr(ModelDownloadService, "is_ready", lambda self: ready["value"])
    started = AsyncMock()
    monkeypatch.setattr(ModelDownloadService, "start_download", started)
    generate = AsyncMock(return_value=[(b"png", 11)])
    monkeypatch.setattr(provider.runtime, "generate", generate)
    return images_api, ready, started, generate


@pytest.fixture
def images_api(canvas_api, monkeypatch, tmp_path):
    from asterism.domains.files.store import LocalFileStore

    store = LocalFileStore(tmp_path / "files")
    monkeypatch.setattr("asterism.domains.files.service.get_file_store", lambda: store)
    monkeypatch.setattr("asterism.domains.files.service.start_ingestion", lambda **_: None)
    return canvas_api


async def choose(sessions, model_id):
    async with sessions() as db:
        await db.execute(
            delete(ApplicationSettingsModel).where(ApplicationSettingsModel.key == "image_generation_onnx")
        )
        db.add(ApplicationSettingsModel(key="image_generation_onnx", value={"model_id": model_id}))
        await db.commit()


async def test_the_provider_reports_status_and_sends_a_bounded_job_to_the_worker(onnx_api):
    (client, sessions), ready, _, generate = onnx_api
    await set_policy(sessions, provider="ONNX")
    availability = lambda: client.get("/image-generation/availability", headers=auth())  # noqa: E731
    assert (await availability()).json()["reason"] == "Choose an ONNX model"
    await choose(sessions, STUB.id)
    ready["value"] = False
    assert (await availability()).json()["reason"] == "Download Stub LCM first"
    ready["value"] = True
    assert (await availability()).json() == {"available": True, "reason": ""}

    result = await provider.Onnx(provider.OnnxParameters())(
        ImageRequest(prompt="A heron", width=1024, height=1024, seed=5, steps=50), AsyncMock()
    )
    key, job, _ = generate.call_args.args
    assert key.pipeline == "onnx-lcm" and key.device == "cpu"
    assert Path(key.model_dir).name == STUB.id
    # Scaled down to the model's 512 px area, and steps capped at its maximum.
    assert (job["width"], job["height"], job["steps"], job["seed"], job["guidance"]) == (512, 512, 8, 5, 8.0)
    assert result.model == STUB.repo and result.revision == STUB.revision and result.images[0].seed == 11


async def test_admin_endpoints_show_fit_attribution_and_gate_licenses(onnx_api):
    (client, sessions), _, started, _ = onnx_api
    url = "/settings/app/image-generation/onnx"
    assert (await client.get(url, headers=auth("a"))).status_code == 403
    overview = (await client.get(url, headers=auth("admin"))).json()
    assert overview["memory_gb"] == 16.0 and overview["recommended_id"] == STUB.id
    models = {model["id"]: model for model in overview["models"]}
    assert models[RESTRICTED.id]["attribution"] == "Powered by Stability AI"
    assert models[RESTRICTED.id]["license_accepted"] is False and models[STUB.id]["license_accepted"] is True

    assert (await client.put(url, headers=auth("admin"), json={"model_id": "nope"})).status_code == 404
    chosen = await client.put(url, headers=auth("admin"), json={"model_id": STUB.id})
    assert chosen.json()["settings"]["model_id"] == STUB.id

    download = f"{url}/models/{RESTRICTED.id}/download"
    refused = await client.post(download, headers=auth("admin"), json={})
    assert refused.status_code == 400 and "Stability AI Community License" in refused.text
    started.assert_not_called()
    accepted = await client.post(download, headers=auth("admin"), json={"accept_license": True})
    assert accepted.status_code == 200, accepted.text
    started.assert_called_once()
    assert RESTRICTED.id in accepted.json()["settings"]["accepted_licenses"]


async def test_a_saved_diffusers_choice_without_the_extra_points_to_onnx(onnx_api, monkeypatch):
    (client, sessions), _, _, _ = onnx_api
    key = component_registry._make_key(ComponentType.ImageGenerator, "Diffusers")
    monkeypatch.delitem(component_registry.providers_by_unique_id, key, raising=False)
    await set_policy(sessions, provider="Diffusers")
    status = (await client.get("/settings/app/image-generation/status", headers=auth("admin"))).json()
    assert status["ready"] is False
    assert status["detail"] == (
        "Diffusers is not available in this image. Choose ONNX to generate images on this server's CPU"
    )
