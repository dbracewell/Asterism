"""Detect what can run a diffusion pipeline here: CUDA, Apple MPS or CPU (US-76.2)."""

import os
import platform
from typing import Literal

from pydantic import BaseModel

Device = Literal["cuda", "mps", "cpu"]
GB = 1024**3


class HardwareReport(BaseModel):
    """What the backend can use. Memory is in GiB."""

    device: Device
    name: str
    # CUDA: the GPU's memory. MPS: unified memory. CPU: system RAM.
    memory_gb: float
    # CUDA only: free GPU memory right now.
    free_gb: float | None = None
    system_ram_gb: float
    cpu_count: int
    # Fast native bf16 math on the chosen device (see ``native_bf16``).
    bf16: bool
    # Other devices that are present, for the admin's override.
    available: list[Device]


def system_ram_gb() -> float:
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / GB
    except (ValueError, OSError, AttributeError):
        return 0.0


def cpu_capabilities() -> dict:
    import torch  # pyright: ignore[reportMissingImports] - the optional local-image extra

    try:
        return dict(torch.cpu.get_capabilities())
    except (AttributeError, RuntimeError):
        return {}


def cpu_name(capabilities: dict) -> str:
    return str(capabilities.get("cpu_name") or platform.processor() or platform.machine() or "CPU")


def cpu_bf16(capabilities: dict, system: str | None = None) -> bool:
    """Whether PyTorch has fast bf16 kernels on this CPU.

    x86 needs AVX-512 BF16 or AMX (Intel Cooper Lake / Sapphire Rapids and
    later, AMD Zen 4 and later); ARM Linux needs SVE BF16 (Graviton 3 and
    later). Apple CPUs report ARM bf16 but PyTorch runs it far slower than
    float32 (over 50 times on an M5 Max), so macOS never uses it.
    """
    if (system or platform.system()) == "Darwin":
        return False
    return bool(capabilities.get("avx512_bf16") or capabilities.get("amx_bf16") or capabilities.get("sve_bf16"))


def mps_bf16(chip: str, macos_14: bool) -> bool:
    """Apple GPUs have bf16 from M2 on; MPS needs macOS 14 for it."""
    return macos_14 and not chip.startswith("Apple M1")


def detect(preferred: Device | Literal["auto"] = "auto") -> HardwareReport:
    """The best device (CUDA, then MPS, then CPU), or ``preferred`` when it is present."""
    import torch  # pyright: ignore[reportMissingImports] - the optional local-image extra

    ram = round(system_ram_gb(), 1)
    cpus = os.cpu_count() or 1
    capabilities = cpu_capabilities()
    processor = cpu_name(capabilities)
    available: list[Device] = []
    if torch.cuda.is_available():
        available.append("cuda")
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        available.append("mps")
    available.append("cpu")
    device: Device = preferred if preferred != "auto" and preferred in available else available[0]

    if device == "cuda":
        free, total = torch.cuda.mem_get_info()
        return HardwareReport(
            device="cuda",
            name=torch.cuda.get_device_name(),
            memory_gb=round(total / GB, 1),
            free_gb=round(free / GB, 1),
            system_ram_gb=ram,
            cpu_count=cpus,
            # Native only (Ampere and later): emulated bf16 is slow.
            bf16=torch.cuda.is_bf16_supported(including_emulation=False),
            available=available,
        )
    if device == "mps":
        return HardwareReport(
            device="mps",
            name=f"{processor} GPU (Metal)",
            memory_gb=ram,
            system_ram_gb=ram,
            cpu_count=cpus,
            bf16=mps_bf16(processor, torch.backends.mps.is_macos_or_newer(14, 0)),
            available=available,
        )
    return HardwareReport(
        device="cpu",
        name=processor,
        memory_gb=ram,
        system_ram_gb=ram,
        cpu_count=cpus,
        bf16=cpu_bf16(capabilities),
        available=available,
    )


_CACHE: dict[str, HardwareReport] = {}


def cached_detect(preferred: Device | Literal["auto"] = "auto") -> HardwareReport:
    """Detection for hot paths (status checks each turn); the admin page detects fresh."""
    found = _CACHE.get(preferred)
    if found is None:
        found = _CACHE[preferred] = detect(preferred)
    return found


def clear_cache() -> None:
    _CACHE.clear()
