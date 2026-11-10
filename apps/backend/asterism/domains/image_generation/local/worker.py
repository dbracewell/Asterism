"""The diffusion worker process (US-76.2).

Runs in its own process (spawn) so a pipeline can't block the event loop, and
a crash or out-of-memory error can't take the API down. It loads one pipeline
and answers jobs over a pipe:

- parent → worker: ``("generate", job)`` or ``("stop",)``
- worker → parent: ``("loaded",)``, ``("progress", step, total)``,
  ``("result", [(png_bytes, seed), …])`` or ``("error", kind, message)``

``kind`` is ``"oom"`` or ``"error"``. A stub pipeline (``pipeline="stub"``)
lets tests exercise the real process without a model.
"""

import inspect
import io
import os
import traceback
from multiprocessing.connection import Connection
from typing import Any


class _StubPipeline:
    """Solid-colour images; prompts "crash" and "oom" test failure handling."""

    num_timesteps = 3

    def __call__(
        self,
        prompt: str,
        width: int,
        height: int,
        num_inference_steps: int = 3,
        callback_on_step_end=None,
        generator=None,
        **_: Any,
    ):
        from PIL import Image

        if "crash" in prompt:
            os._exit(3)
        if "oom" in prompt:
            raise MemoryError("stub out of memory")
        for step in range(self.num_timesteps):
            if callback_on_step_end is not None:
                callback_on_step_end(self, step, step, {})
        seed = generator.initial_seed() if generator is not None else 0
        image = Image.new("RGB", (width, height), (seed % 256, 80, 160))
        return type("Output", (), {"images": [image]})()


def _load(model_dir: str, pipeline: str, device: str, mode: str, dtype: str, scheduler: str | None = None):
    if pipeline == "stub":
        return _StubPipeline()
    from pathlib import Path

    import diffusers
    import torch

    cls = getattr(diffusers, pipeline)
    options: dict[str, Any] = {"torch_dtype": getattr(torch, dtype), "local_files_only": True}
    # Repositories that ship fp16 weights next to fp32 ones download only the fp16 files.
    if any(Path(model_dir).glob("*/*.fp16.safetensors")):
        options["variant"] = "fp16"
    # Stable Diffusion's separate image safety checker isn't downloaded; the
    # platform's prompt check governs (ADR-0064).
    if "safety_checker" in inspect.signature(cls.__init__).parameters:
        options.update(safety_checker=None, feature_extractor=None, requires_safety_checker=False)
    pipe = cls.from_pretrained(model_dir, **options)
    if scheduler:
        pipe.scheduler = getattr(diffusers, scheduler).from_config(pipe.scheduler.config)
    if mode == "offload":
        pipe.enable_model_cpu_offload()
    else:
        pipe.to(device)
    return pipe


def _is_oom(error: BaseException) -> bool:
    return (
        isinstance(error, MemoryError) or "OutOfMemory" in type(error).__name__ or "out of memory" in str(error).lower()
    )


def _generator(seed: int, pipeline: str):
    if pipeline == "stub":
        return type("Generator", (), {"initial_seed": lambda self: seed})()
    import torch

    # A CPU generator gives the same image for a seed on every device.
    return torch.Generator("cpu").manual_seed(seed)


def _generate(pipe, pipeline: str, job: dict[str, Any], conn: Connection) -> list[tuple[bytes, int]]:
    accepted = inspect.signature(pipe.__call__).parameters
    count = int(job["count"])
    results: list[tuple[bytes, int]] = []
    for index in range(count):
        seed = int(job["seed"]) + index

        def on_step(pipe_, step, _timestep, kwargs, index=index):
            total = int(getattr(pipe_, "num_timesteps", 0) or job.get("steps") or 0)
            conn.send(("progress", index * total + step + 1, total * count))
            return kwargs

        arguments: dict[str, Any] = {
            "prompt": job["prompt"],
            "width": job["width"],
            "height": job["height"],
            "generator": _generator(seed, pipeline),
        }
        if job.get("steps") and "num_inference_steps" in accepted:
            arguments["num_inference_steps"] = job["steps"]
        if job.get("guidance") is not None and "guidance_scale" in accepted:
            arguments["guidance_scale"] = job["guidance"]
        if job.get("negative_prompt") and "negative_prompt" in accepted:
            arguments["negative_prompt"] = job["negative_prompt"]
        if "callback_on_step_end" in accepted:
            arguments["callback_on_step_end"] = on_step
        for key, value in (job.get("extra") or {}).items():
            if key in accepted:
                arguments[key] = value
        image = pipe(**arguments).images[0]
        out = io.BytesIO()
        image.save(out, format="PNG")
        results.append((out.getvalue(), seed))
    return results


def worker_main(
    conn: Connection, model_dir: str, pipeline: str, device: str, mode: str, dtype: str, scheduler: str | None = None
) -> None:
    try:
        pipe = _load(model_dir, pipeline, device, mode, dtype, scheduler)
    except BaseException as error:  # noqa: BLE001 - reported to the parent, then exit
        conn.send(("error", "oom" if _is_oom(error) else "error", f"Loading the model failed: {error}"))
        traceback.print_exc()
        return
    conn.send(("loaded",))
    while True:
        try:
            message = conn.recv()
        except EOFError:
            return
        if message[0] == "stop":
            return
        try:
            conn.send(("result", _generate(pipe, pipeline, message[1], conn)))
        except BaseException as error:  # noqa: BLE001
            traceback.print_exc()
            conn.send(("error", "oom" if _is_oom(error) else "error", str(error)[:500]))
            if _is_oom(error) and device == "cuda":
                import torch

                torch.cuda.empty_cache()
