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
    bf16: bool
    # Other devices that are present, for the admin's override.
    available: list[Device]


def system_ram_gb() -> float:
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / GB
    except (ValueError, OSError, AttributeError):
        return 0.0


def detect(preferred: Device | Literal["auto"] = "auto") -> HardwareReport:
    """The best device (CUDA, then MPS, then CPU), or ``preferred`` when it is present."""
    import torch

    ram = round(system_ram_gb(), 1)
    cpus = os.cpu_count() or 1
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
            bf16=torch.cuda.is_bf16_supported(),
            available=available,
        )
    if device == "mps":
        return HardwareReport(
            device="mps",
            name=f"Apple {platform.machine()} (Metal)",
            memory_gb=ram,
            system_ram_gb=ram,
            cpu_count=cpus,
            bf16=True,
            available=available,
        )
    return HardwareReport(
        device="cpu",
        name=platform.processor() or platform.machine() or "CPU",
        memory_gb=ram,
        system_ram_gb=ram,
        cpu_count=cpus,
        bf16=True,
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
