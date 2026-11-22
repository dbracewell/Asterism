"""The pinned ONNX model catalog (ADR-0077, US-94.4).

Each model is an int8 conversion published under ``huggingface.co/davidb727`` by
``scripts/convert_onnx_image_model.py``: making the copies needs tens of GB of
memory, so servers download them ready-made. Each is pinned by revision and the
SHA-256 of every file, including its LICENSE and NOTICE. Memory and time are
measured peaks for one 512 px image on the CPU (Apple M5 Max), with the lean
session options of ``pipeline.lean_session``.
"""

from dataclasses import dataclass, field

from asterism.domains.knowledge.model_download import PinnedModel

PUBLISHER = "davidb727"


@dataclass(frozen=True)
class OnnxCatalogEntry:
    id: str
    name: str
    repo: str
    revision: str
    family: str
    license: str
    license_url: str
    # False: the license is shown and accepted before download (ADR-0064).
    commercial_use: bool
    description: str
    # Every file of the repository Asterism uses, with its SHA-256.
    files: dict[str, str]
    download_gb: float
    memory_gb: float
    seconds_per_image: float
    steps: int
    max_steps: int
    guidance: float
    # The square side the model works at; larger requests are scaled down to its area.
    resolution: int = 512
    # Shown wherever the model is offered, when its license requires it.
    attribution: str | None = None
    extra: dict[str, object] = field(default_factory=dict)

    def pinned(self) -> PinnedModel:
        return PinnedModel(
            id=self.repo,
            revision=self.revision,
            allow_patterns=[],
            files=self.files,
            size_bytes=int(self.download_gb * 1e9),
        )


CATALOG: tuple[OnnxCatalogEntry, ...] = ()

BY_ID = {entry.id: entry for entry in CATALOG}


def entry(model_id: str) -> OnnxCatalogEntry | None:
    return BY_ID.get(model_id)
