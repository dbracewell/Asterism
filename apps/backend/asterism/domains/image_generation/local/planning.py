"""Whether a catalog model fits the hardware, how it would run, and which to recommend (US-76.2)."""

from typing import Literal

from pydantic import BaseModel

from .catalog import CATALOG, CatalogEntry
from .hardware import HardwareReport

RunMode = Literal["device", "offload", "none"]

# Room for the OS, the backend and activations beyond the estimate.
CUDA_HEADROOM_GB = 2.0
# macOS lets the GPU use about this share of unified memory.
MPS_SHARE = 0.7
CPU_SHARE = 0.8


class Plan(BaseModel):
    fits: bool
    mode: RunMode
    detail: str


def plan(entry: CatalogEntry, hardware: HardwareReport) -> Plan:
    if hardware.device == "cuda":
        if hardware.memory_gb >= entry.memory_gb + CUDA_HEADROOM_GB:
            return Plan(fits=True, mode="device", detail=f"Runs fully on {hardware.name}")
        if hardware.memory_gb >= entry.offload_gb + CUDA_HEADROOM_GB and hardware.system_ram_gb >= entry.memory_gb:
            return Plan(
                fits=True,
                mode="offload",
                detail="Runs with parts moved to system memory between steps (slower)",
            )
        return Plan(
            fits=False,
            mode="none",
            detail=f"Needs about {entry.offload_gb + CUDA_HEADROOM_GB:.0f} GB of GPU memory; this GPU has "
            f"{hardware.memory_gb:.0f} GB",
        )
    share = MPS_SHARE if hardware.device == "mps" else CPU_SHARE
    usable = hardware.memory_gb * share
    if usable >= entry.memory_gb:
        detail = (
            "Runs on Apple Silicon (Metal)"
            if hardware.device == "mps"
            else "Runs on the CPU; expect several minutes per image"
        )
        return Plan(fits=True, mode="device", detail=detail)
    return Plan(
        fits=False,
        mode="none",
        detail=f"Needs about {entry.memory_gb / share:.0f} GB of memory; this machine has {hardware.memory_gb:.0f} GB",
    )


def recommend(hardware: HardwareReport) -> CatalogEntry | None:
    """The first catalog model that fits, in catalog (preference) order."""
    return next((entry for entry in CATALOG if plan(entry, hardware).fits), None)
