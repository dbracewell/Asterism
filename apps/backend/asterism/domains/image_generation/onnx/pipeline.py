"""Stable Diffusion on ONNX Runtime and NumPy, without PyTorch (ADR-0077, US-94.4).

Two families, matching the catalog:

- ``lcm``: Stable Diffusion 1.5 with a guidance-distilled Latent Consistency
  Model UNet (one CLIP text encoder; the guidance scale goes in as an embedding,
  so each step is one UNet run).
- ``sdxl``: SDXL Turbo (two CLIP text encoders whose penultimate hidden states are
  joined, the pooled embedding and size conditioning; Euler ancestral sampling).

A pipeline is called like a diffusers pipeline, which lets the existing worker
process run it: ``pipeline(prompt=…, width=…, height=…, num_inference_steps=…,
guidance_scale=…, generator=…, callback_on_step_end=…)`` returns an object with
``images``. ``generator`` only needs ``initial_seed()``; noise comes from NumPy, so
a seed gives the same image on every machine, though not the image diffusers
would give.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np
from PIL import Image

from . import schedulers

FAMILIES = ("lcm", "sdxl")
VAE_SCALE = {"lcm": 0.18215, "sdxl": 0.13025}
LCM_EMBEDDING_DIM = 256


class Session(Protocol):
    """The part of ``onnxruntime.InferenceSession`` the pipelines use."""

    def get_inputs(self) -> list[Any]: ...
    def get_outputs(self) -> list[Any]: ...
    def run(self, output_names: list[str] | None, input_feed: dict[str, np.ndarray]) -> list[np.ndarray]: ...


def lean_session(path: Path) -> Any:
    """A CPU session tuned for memory: no arena, memory pattern or weight prepacking.

    Together they cut peak memory by about 2 GB per image at the same speed (ADR-0077).
    """
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.enable_cpu_mem_arena = False
    options.enable_mem_pattern = False
    options.add_session_config_entry("session.disable_prepacking", "1")
    return ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])


_NUMPY_TYPES: dict[str, Any] = {
    "tensor(float)": np.float32,
    "tensor(float16)": np.float16,
    "tensor(int64)": np.int64,
    "tensor(int32)": np.int32,
}


def _input_type(session: Session, name: str) -> Any:
    found = next((item for item in session.get_inputs() if item.name == name), None)
    if found is None:
        raise ValueError(f"The model has no input {name}")
    return _NUMPY_TYPES[found.type]


@dataclass
class _Output:
    images: list[Image.Image]


StepCallback = Callable[[Any, int, int, dict[str, Any]], dict[str, Any]]


class OnnxDiffusionPipeline:
    """One loaded model. Not thread-safe; the worker runs one job at a time."""

    def __init__(
        self,
        family: str,
        tokenizers: list[Any],
        text_encoders: list[Session],
        unet: Session,
        vae_decoder: Session,
        scheduler_config: dict[str, Any],
    ) -> None:
        if family not in FAMILIES:
            raise ValueError(f"Unknown ONNX pipeline family {family}")
        self.family = family
        self.tokenizers = tokenizers
        self.text_encoders = text_encoders
        self.unet = unet
        self.vae_decoder = vae_decoder
        self.train_steps = int(scheduler_config["num_train_timesteps"])
        self.original_steps = int(scheduler_config.get("original_inference_steps", 50))
        self.alphas_cumprod = schedulers.scaled_linear_alphas_cumprod(
            float(scheduler_config["beta_start"]), float(scheduler_config["beta_end"]), self.train_steps
        )
        self.num_timesteps = 0

    @classmethod
    def load(cls, root: Path, family: str) -> OnnxDiffusionPipeline:
        from transformers import CLIPTokenizer

        tokenizer_dirs = ["tokenizer"] if family == "lcm" else ["tokenizer", "tokenizer_2"]
        encoder_dirs = ["text_encoder"] if family == "lcm" else ["text_encoder", "text_encoder_2"]
        return cls(
            family,
            [CLIPTokenizer.from_pretrained(root / name, local_files_only=True) for name in tokenizer_dirs],
            [lean_session(root / name / "model.onnx") for name in encoder_dirs],
            lean_session(root / "unet" / "model.onnx"),
            lean_session(root / "vae_decoder" / "model.onnx"),
            json.loads((root / "scheduler" / "scheduler_config.json").read_text(encoding="utf-8")),
        )

    def _encode(self, tokenizer: Any, encoder: Session, prompt: str) -> dict[str, np.ndarray]:
        ids = tokenizer(
            prompt, padding="max_length", max_length=tokenizer.model_max_length, truncation=True, return_tensors="np"
        )["input_ids"]
        feed = encoder.get_inputs()[0]
        names = [item.name for item in encoder.get_outputs()]
        return dict(zip(names, encoder.run(None, {feed.name: ids.astype(_NUMPY_TYPES[feed.type])}), strict=True))

    def _conditioning(self, prompt: str, width: int, height: int) -> dict[str, np.ndarray]:
        if self.family == "lcm":
            hidden = self._encode(self.tokenizers[0], self.text_encoders[0], prompt)["last_hidden_state"]
            return {"encoder_hidden_states": hidden.astype(np.float32)}
        hidden_states, pooled = [], None
        for tokenizer, encoder in zip(self.tokenizers, self.text_encoders, strict=True):
            outputs = self._encode(tokenizer, encoder, prompt)
            layers = sorted((n for n in outputs if n.startswith("hidden_states.")), key=lambda n: int(n.split(".")[1]))
            # SDXL conditions on each encoder's penultimate layer.
            hidden_states.append(outputs[layers[-2]].astype(np.float32))
            pooled = outputs.get("text_embeds", pooled)
        if pooled is None:
            raise ValueError("The second SDXL text encoder gave no pooled embedding")
        return {
            "encoder_hidden_states": np.concatenate(hidden_states, axis=-1),
            "text_embeds": pooled.astype(np.float32),
            # Original size, crop origin, target size.
            "time_ids": np.asarray([[height, width, 0, 0, height, width]], dtype=_input_type(self.unet, "time_ids")),
        }

    def _denoise(
        self,
        latents: np.ndarray,
        conditioning: dict[str, np.ndarray],
        steps: int,
        guidance_scale: float,
        rng: np.random.Generator,
        on_step: Callable[[int], None],
    ) -> np.ndarray:
        timestep_type = _input_type(self.unet, "timestep")

        def predict(sample: np.ndarray, timestep: int, extra: dict[str, np.ndarray]) -> np.ndarray:
            feed = {
                "sample": sample.astype(np.float32),
                "timestep": np.asarray([timestep], dtype=timestep_type),
                **conditioning,
                **extra,
            }
            return self.unet.run(None, feed)[0].astype(np.float64)

        if self.family == "lcm":
            timesteps = schedulers.lcm_timesteps(steps, self.train_steps, self.original_steps)
            extra = {"timestep_cond": schedulers.guidance_embedding(guidance_scale, LCM_EMBEDDING_DIM)}
            for index, timestep in enumerate(timesteps):
                last = index + 1 == len(timesteps)
                prediction = predict(latents, int(timestep), extra)
                latents = schedulers.lcm_step(
                    latents,
                    prediction,
                    int(timestep),
                    None if last else int(timesteps[index + 1]),
                    self.alphas_cumprod,
                    None if last else rng.standard_normal(latents.shape),
                )
                on_step(index)
            return latents

        timesteps = schedulers.trailing_timesteps(steps, self.train_steps)
        sigmas = schedulers.euler_sigmas(timesteps, self.alphas_cumprod)
        latents = latents * np.sqrt(sigmas[0] ** 2 + 1.0)
        for index, timestep in enumerate(timesteps):
            sigma, next_sigma = float(sigmas[index]), float(sigmas[index + 1])
            prediction = predict(latents / np.sqrt(sigma**2 + 1.0), int(timestep), {})
            latents = schedulers.euler_ancestral_step(
                latents, prediction, sigma, next_sigma, rng.standard_normal(latents.shape) if next_sigma > 0 else None
            )
            on_step(index)
        return latents

    def _decode(self, latents: np.ndarray) -> Image.Image:
        feed = self.vae_decoder.get_inputs()[0].name
        image = self.vae_decoder.run(None, {feed: (latents / VAE_SCALE[self.family]).astype(np.float32)})[0]
        pixels = np.clip(image[0].transpose(1, 2, 0) / 2.0 + 0.5, 0.0, 1.0)
        return Image.fromarray((pixels * 255.0).round().astype(np.uint8))

    def __call__(
        self,
        prompt: str,
        width: int,
        height: int,
        num_inference_steps: int,
        guidance_scale: float = 1.0,
        generator: Any = None,
        callback_on_step_end: StepCallback | None = None,
    ) -> _Output:
        if width % 8 or height % 8:
            raise ValueError("Width and height must be multiples of 8")
        seed = int(generator.initial_seed()) if generator is not None else 0
        rng = np.random.default_rng(seed)
        self.num_timesteps = num_inference_steps
        latents = rng.standard_normal((1, 4, height // 8, width // 8))
        conditioning = self._conditioning(prompt, width, height)

        def on_step(index: int) -> None:
            if callback_on_step_end is not None:
                callback_on_step_end(self, index, index, {})

        latents = self._denoise(latents, conditioning, num_inference_steps, guidance_scale, rng, on_step)
        return _Output(images=[self._decode(latents)])
