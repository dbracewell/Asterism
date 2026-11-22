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


CATALOG: tuple[OnnxCatalogEntry, ...] = (
    OnnxCatalogEntry(
        id="lcm-dreamshaper-v7",
        name="LCM DreamShaper v7",
        repo=f"{PUBLISHER}/lcm-dreamshaper-v7-int8",
        revision="d3bc0838ec4708d292d867b51484dfb0c351c7e7",
        family="lcm",
        license="CreativeML Open RAIL-M",
        license_url="https://huggingface.co/davidb727/lcm-dreamshaper-v7-int8/blob/"
        "d3bc0838ec4708d292d867b51484dfb0c351c7e7/LICENSE",
        commercial_use=True,
        description="Versatile Stable Diffusion 1.5 images (paintings, photos, illustrations) in 4 steps; "
        "the smallest and the default.",
        files={
            "LICENSE": "be351ebe7ac01bcdbb018639aadcfd38f136b7dc3f2a3d4d3a24db51d1b210ef",
            "NOTICE": "5965cd4c89f55fef37fe7f0513bac2d64715dcbd2c8122d4defaea6dcc1ef4e6",
            "scheduler/scheduler_config.json": "53b92058338ac5bee0713c90078f5ae113fe4372ee4d0b728dc5ca6b02f10482",
            "text_encoder/model.onnx": "767d3fad6f9d5c0067f420f7227cb2b9816b6237216d35dcad006bcad9a1f65c",
            "tokenizer/merges.txt": "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a",
            "tokenizer/special_tokens_map.json": "92e1e31d71a7f63cd75b4dfa1469377bd2cd6b8292cf70b3ff5b7082b0edc1c9",
            "tokenizer/tokenizer_config.json": "47c69084af647bc277b858faaa9871175a95eb4d36cd98a6d04039305613ceff",
            "tokenizer/vocab.json": "e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349",
            "unet/model.onnx": "487cddff25f4e2fdf4e8f09f23e54fe4a2aa68afe710645c5441401091773745",
            "unet/model.onnx.data": "5e254ceb35b79da4ec472c282456110073e7af31a8224691af870b8f0134e4c1",
            "vae_decoder/model.onnx": "0ea3df9f76ff9de5cea29106f246bf9b71297d418b013404f91dae5a0ddba98e",
        },
        download_gb=1.56,
        memory_gb=5.2,
        seconds_per_image=5,
        steps=4,
        max_steps=8,
        guidance=8.0,
    ),
    OnnxCatalogEntry(
        id="sdxl-turbo",
        name="SDXL Turbo",
        repo=f"{PUBLISHER}/sdxl-turbo-int8",
        revision="06e90d3a720429a1dfe988afa1909272503908fe",
        family="sdxl",
        license="Stability AI Community License",
        license_url="https://huggingface.co/davidb727/sdxl-turbo-int8/blob/"
        "06e90d3a720429a1dfe988afa1909272503908fe/LICENSE.md",
        # Free below US $1M revenue (commercial use needs registering with Stability AI), so it is accepted first.
        commercial_use=False,
        attribution="Powered by Stability AI",
        description="Sharper, more detailed SDXL images in a single step; needs more memory and a license.",
        files={
            "LICENSE.md": "d6f6b1a4dce5c852bd6d7d9482d002baf0ccdb71e662250b73be9eec8764ee8d",
            "NOTICE": "127e36ecff7fc8c0b4017fc149b8ea27da6df60be90f7bdfbc6276475f15c528",
            "scheduler/scheduler_config.json": "13847eb34084bc56e9f8b10f84d2c650cf8cb00016b2530429af0b894d4e1aa2",
            "text_encoder/model.onnx": "5522ae5f760e4864c20424c514cfa585cb4afb672b71b962f29a97c4f457383c",
            "text_encoder_2/model.onnx": "cac57ee0cad456b22da16cf023f21dec530d566e648c64af658664e886b5a928",
            "text_encoder_2/model.onnx.data": "1be6606dd69c63acae99760a05407525aa843e7a954c4053fc1cf2cb84ab548f",
            "tokenizer/merges.txt": "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a",
            "tokenizer/special_tokens_map.json": "6a757fc443f84ad1def3b893aac3858178f2a1513e3cf97b35ff131b5d88edd5",
            "tokenizer/tokenizer_config.json": "7eb36a76a02551ce8583dbee08d062e672997a5fe1db82ebc642d88c7e79cc96",
            "tokenizer/vocab.json": "e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349",
            "tokenizer_2/merges.txt": "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a",
            "tokenizer_2/special_tokens_map.json": "f118ab3a983206e4f32583448de6bd6aae4ee21869135cef1f5848a753cdaab6",
            "tokenizer_2/tokenizer_config.json": "516314ccab66918d7cb647480ac27abd3520d14e1e5825aac99f50c851c16071",
            "tokenizer_2/vocab.json": "e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349",
            "unet/model.onnx": "20c8df98de9a89c5937152c4592994dbee6d72f4871f475b70fc3763239a13d7",
            "unet/model.onnx.data": "ac62e495a757a9053650138a8c1704fbc8eca9577c6d23e96b9bd43b1f4b394b",
            "vae_decoder/model.onnx": "558225daaa98ae7e67594d10a1ac3e546c67b12094836f8788036aaba652e159",
        },
        download_gb=6.19,
        memory_gb=7.9,
        seconds_per_image=3,
        steps=1,
        max_steps=4,
        guidance=0.0,
    ),
)

BY_ID = {entry.id: entry for entry in CATALOG}


def entry(model_id: str) -> OnnxCatalogEntry | None:
    return BY_ID.get(model_id)
