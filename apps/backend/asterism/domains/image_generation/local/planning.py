"""Whether a catalog model fits the hardware, how it would run, and which to recommend (US-76.2)."""

from typing import Literal

from pydantic import BaseModel

from .catalog import CATALOG, CatalogEntry
from .hardware import HardwareReport

RunMode = Literal["device", "offload", "none"]
Dtype = Literal["bfloat16", "float16", "float32"]

# Room for the CUDA context and fragmentation beyond the estimate: a tenth of
# it, at least 1 GB.
MIN_HEADROOM_GB = 1.0
# macOS lets the GPU use about this share of unified memory.
MPS_SHARE = 0.7
CPU_SHARE = 0.8
# Models up to this estimate take tens of seconds per image on a CPU, larger ones minutes.
SMALL_MODEL_GB = 4.0


class Plan(BaseModel):
    fits: bool
    mode: RunMode
    detail: str


def dtype_for(entry: CatalogEntry, hardware: HardwareReport) -> Dtype:
    """bf16 where the device does it natively; otherwise fp16 on a GPU for
    models trained in it, else float32 (fp16 is slow on CPUs too)."""
    if hardware.bf16:
        return "bfloat16"
    if hardware.device != "cpu" and entry.fp16_ok:
        return "float16"
    return "float32"


def estimate(entry: CatalogEntry, hardware: HardwareReport, offload: bool = False) -> float:
    """The catalog's bf16 estimate, doubled in float32."""
    base = entry.offload_gb if offload else entry.memory_gb
    return base * (2.0 if dtype_for(entry, hardware) == "float32" else 1.0)


def _with_headroom(estimate: float) -> float:
    return estimate + max(MIN_HEADROOM_GB, estimate * 0.1)


def plan(entry: CatalogEntry, hardware: HardwareReport) -> Plan:
    if hardware.device == "cuda":
        full, peak = estimate(entry, hardware), estimate(entry, hardware, offload=True)
        if hardware.memory_gb >= _with_headroom(full):
            return Plan(fits=True, mode="device", detail=f"Runs fully on {hardware.name}")
        if hardware.memory_gb >= _with_headroom(peak) and hardware.system_ram_gb >= full:
            return Plan(
                fits=True,
                mode="offload",
                detail="Runs with parts moved to system memory between steps (slower)",
            )
        return Plan(
            fits=False,
            mode="none",
            detail=f"Needs about {_with_headroom(peak):.0f} GB of GPU memory; this GPU has {hardware.memory_gb:.0f} GB",
        )
    share = MPS_SHARE if hardware.device == "mps" else CPU_SHARE
    needed = estimate(entry, hardware)
    if hardware.memory_gb * share >= needed:
        if hardware.device == "mps":
            detail = "Runs on Apple Silicon (Metal)"
        elif entry.memory_gb <= SMALL_MODEL_GB:
            detail = "Runs on the CPU; expect tens of seconds per image"
        else:
            detail = "Runs on the CPU; expect several minutes per image"
        return Plan(fits=True, mode="device", detail=detail)
    return Plan(
        fits=False,
        mode="none",
        detail=f"Needs about {needed / share:.0f} GB of memory; this machine has {hardware.memory_gb:.0f} GB",
    )


def recommend(hardware: HardwareReport) -> CatalogEntry | None:
    """The first catalog model that fits, in catalog (preference) order.

    On the CPU speed matters more than quality, so the smallest model that fits wins.
    """
    fitting = [entry for entry in CATALOG if plan(entry, hardware).fits]
    if hardware.device == "cpu":
        fitting.sort(key=lambda entry: entry.memory_gb)
    return fitting[0] if fitting else None
