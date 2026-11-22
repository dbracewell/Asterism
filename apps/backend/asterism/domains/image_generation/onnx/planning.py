"""Whether an ONNX catalog model fits this machine, and which to recommend (US-94.4).

Everything runs on the CPU, so fit is system memory: the measured peak plus a
tenth, at least 1 GB, within 80% of RAM (the rest is for Asterism and the OS).
"""

from pydantic import BaseModel

from ..local.hardware import system_ram_gb
from .catalog import CATALOG, OnnxCatalogEntry

RAM_SHARE = 0.8
MIN_HEADROOM_GB = 1.0


class OnnxPlan(BaseModel):
    fits: bool
    detail: str


def needed_gb(entry: OnnxCatalogEntry) -> float:
    return entry.memory_gb + max(MIN_HEADROOM_GB, entry.memory_gb * 0.1)


def plan(entry: OnnxCatalogEntry, ram_gb: float) -> OnnxPlan:
    if ram_gb * RAM_SHARE >= needed_gb(entry):
        seconds = f"{entry.seconds_per_image:.0f}"
        return OnnxPlan(fits=True, detail=f"Runs on the CPU; about {seconds} s per image on a fast one")
    return OnnxPlan(
        fits=False,
        detail=f"Needs about {needed_gb(entry) / RAM_SHARE:.0f} GB of memory; this server has {ram_gb:.0f} GB",
    )


def recommend(ram_gb: float) -> OnnxCatalogEntry | None:
    """The first catalog model that fits; the catalog is in order of preference."""
    return next((entry for entry in CATALOG if plan(entry, ram_gb).fits), None)


def server_ram_gb() -> float:
    return round(system_ram_gb(), 1)
