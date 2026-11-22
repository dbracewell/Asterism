"""Build the int8 ONNX image models Asterism downloads (US-94.4, ADR-0077).

Making an int8 copy holds about three copies of a model's weights (31.5 GB for
SDXL Turbo's UNet), too much to do on the server that downloads it, so the
copies are made once with this script and published under
``huggingface.co/davidb727``. Asterism pins the published repositories by
revision and SHA-256 like any other model.

The conversion is deterministic: the same source revision and tool versions give
byte-identical files, so anyone can check a published repository by running this
again and comparing ``conversion.json``. Run it in an isolated environment, not the
project's (unset ``VIRTUAL_ENV``), with the tool versions it records pinned:

    env -u VIRTUAL_ENV uv run --isolated --no-project --python 3.13 \\
      --with onnx==1.23.2 --with onnxruntime==1.32.0 --with numpy==2.5.5 \\
      --with huggingface_hub==2.4.0 python -I \\
      apps/backend/scripts/convert_onnx_image_model.py lcm-dreamshaper-v7-int8 OUT_DIR

``--source-dir`` uses files already downloaded at the recipe's revision.

It needs no Asterism code. Publishing is a separate, deliberate step:

    hf upload davidb727/<recipe> OUT_DIR --repo-type model
"""

import argparse
import hashlib
import importlib.metadata
import json
import platform
import shutil
import sys
import tempfile
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

PUBLISHER = "davidb727"
TOOLS = ("onnx", "onnxruntime", "numpy", "huggingface_hub")
# The tool versions the published files were made with; others may give different bytes.
EXPECTED_TOOLS = {"onnx": "1.23.2", "onnxruntime": "1.32.0", "numpy": "2.5.5", "huggingface_hub": "2.4.0"}


@dataclass(frozen=True)
class Quantize:
    """Dynamic int8 weights for these operator types, leaving out nodes whose name contains a pattern."""

    ops: tuple[str, ...]
    exclude: tuple[str, ...] = ()


@dataclass(frozen=True)
class LicenseText:
    url: str
    sha256: str
    filename: str


@dataclass(frozen=True)
class Recipe:
    title: str
    source: str
    revision: str
    family: str
    copy: tuple[str, ...]
    quantize: dict[str, Quantize]
    license_id: str
    license_name: str
    license_text: LicenseText
    notice: str
    card_notes: str
    steps: int
    resolution: int
    extra_tags: tuple[str, ...] = field(default_factory=tuple)


OPENRAIL_M = LicenseText(
    url="https://huggingface.co/spaces/CompVis/stable-diffusion-license/raw/"
    "14d42d09bffd871b1666a084fc954a50cff72ac0/license.txt",
    sha256="be351ebe7ac01bcdbb018639aadcfd38f136b7dc3f2a3d4d3a24db51d1b210ef",
    filename="LICENSE",
)
STABILITY_COMMUNITY = LicenseText(
    url="https://huggingface.co/stabilityai/sdxl-turbo/raw/71153311d3dbb46851df1931d3ca6e939de83304/LICENSE.md",
    sha256="d6f6b1a4dce5c852bd6d7d9482d002baf0ccdb71e662250b73be9eec8764ee8d",
    filename="LICENSE.md",
)

RECIPES: dict[str, Recipe] = {
    "lcm-dreamshaper-v7-int8": Recipe(
        title="LCM DreamShaper v7, ONNX int8",
        source="SimianLuo/LCM_Dreamshaper_v7",
        revision="a85df6a8bd976cdd08b4fd8f3b73f229c9e54df5",
        family="lcm",
        copy=(
            "scheduler/scheduler_config.json",
            "tokenizer/merges.txt",
            "tokenizer/special_tokens_map.json",
            "tokenizer/tokenizer_config.json",
            "tokenizer/vocab.json",
            "text_encoder/model.onnx",
            "vae_decoder/model.onnx",
        ),
        quantize={"unet": Quantize(ops=("MatMul", "Conv"))},
        license_id="creativeml-openrail-m",
        license_name="CreativeML Open RAIL-M",
        license_text=OPENRAIL_M,
        notice=(
            "This model is derived from LCM DreamShaper v7 (SimianLuo/LCM_Dreamshaper_v7), a Latent Consistency\n"
            "Model distilled from DreamShaper 7, a fine-tune of Stable Diffusion 1.5. The upstream repository is\n"
            "tagged MIT; the weights it derives from are under the CreativeML Open RAIL-M license, whose use-based\n"
            "restrictions (paragraph 5 and Attachment A of LICENSE) apply to this model and to your use of it.\n"
        ),
        card_notes=(
            "The upstream repository is tagged MIT, but its weights derive from DreamShaper 7 and Stable "
            "Diffusion 1.5 under the CreativeML Open RAIL-M license. This copy is distributed under that "
            "license, and its use-based restrictions apply."
        ),
        steps=4,
        resolution=512,
        extra_tags=("latent-consistency-model", "stable-diffusion"),
    ),
    "sdxl-turbo-int8": Recipe(
        title="SDXL Turbo, ONNX int8",
        source="stabilityai/sdxl-turbo",
        revision="71153311d3dbb46851df1931d3ca6e939de83304",
        family="sdxl",
        copy=(
            "scheduler/scheduler_config.json",
            "tokenizer/merges.txt",
            "tokenizer/special_tokens_map.json",
            "tokenizer/tokenizer_config.json",
            "tokenizer/vocab.json",
            "tokenizer_2/merges.txt",
            "tokenizer_2/special_tokens_map.json",
            "tokenizer_2/tokenizer_config.json",
            "tokenizer_2/vocab.json",
            "text_encoder/model.onnx",
            "vae_decoder/model.onnx",
        ),
        quantize={
            # The cross-attention keys and values read the prompt; in int8 the images ignore it.
            # Convolutions in int8 leave mosaic artifacts, so they stay float32.
            "unet": Quantize(ops=("MatMul",), exclude=("attn2/to_k", "attn2/to_v")),
            "text_encoder_2": Quantize(ops=("MatMul",)),
        },
        license_id="other",
        license_name="Stability AI Community License",
        license_text=STABILITY_COMMUNITY,
        notice=(
            "This Stability AI Model is licensed under the Stability AI Community License, Copyright © Stability AI\n"
            "Ltd. All Rights Reserved.\n\n"
            "Changed by davidb727 for Asterism: the ONNX export of stabilityai/sdxl-turbo was converted to\n"
            "dynamic int8 weights (the UNet's MatMul nodes other than the cross-attention keys and values, and\n"
            "text_encoder_2's MatMul nodes). Everything else is copied unchanged. The attribution above applies\n"
            "to the Stability AI Materials.\n"
        ),
        card_notes=(
            "**Powered by Stability AI.** Free for research and non-commercial use, and for commercial use by "
            "organizations under US $1M annual revenue that register with Stability AI. See LICENSE.md, NOTICE "
            "and Stability AI's acceptable use policy."
        ),
        steps=1,
        resolution=512,
        extra_tags=("sdxl-turbo", "stable-diffusion-xl"),
    ),
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tool_versions() -> dict[str, str]:
    versions = {name: importlib.metadata.version(name) for name in TOOLS}
    versions["python"] = platform.python_version()
    return versions


def upstream_files(recipe: Recipe) -> list[str]:
    files = list(recipe.copy)
    for component in recipe.quantize:
        files += [f"{component}/model.onnx", f"{component}/model.onnx_data"]
    return files


def fetch_sources(recipe: Recipe, work: Path, source_dir: Path | None = None) -> dict[str, str]:
    """Download the recipe's files at its revision; check LFS files against the Hub's SHA-256.

    With ``source_dir``, files already downloaded at the recipe's revision are copied
    from there instead, and checked the same way.
    """
    from huggingface_hub import HfApi, snapshot_download

    wanted = upstream_files(recipe)
    info = HfApi().model_info(recipe.source, revision=recipe.revision, files_metadata=True)
    lfs = {s.rfilename: s.lfs.sha256 for s in info.siblings or [] if s.lfs is not None}
    listed = {s.rfilename for s in info.siblings or []}
    present = [path for path in wanted if path in listed]
    missing = sorted(set(wanted) - listed - {p for p in wanted if p.endswith("model.onnx_data")})
    if missing:
        raise SystemExit(f"{recipe.source}@{recipe.revision} has no {', '.join(missing)}")
    if source_dir is None:
        snapshot_download(recipe.source, revision=recipe.revision, local_dir=work, allow_patterns=present)
    else:
        for path in present:
            (work / path).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source_dir / path, work / path)
    digests: dict[str, str] = {}
    for path in present:
        digest = sha256_file(work / path)
        if path in lfs and lfs[path] != digest:
            raise SystemExit(f"{path} does not match the Hub's SHA-256")
        digests[path] = digest
    return digests


def quantize(source: Path, target: Path, recipe: Quantize) -> None:
    import onnx
    from onnxruntime.quantization import QuantType, quantize_dynamic

    exclude: list[str] = []
    if recipe.exclude:
        graph = onnx.load(str(source), load_external_data=False).graph
        exclude = [node.name for node in graph.node if any(pattern in node.name for pattern in recipe.exclude)]
    target.parent.mkdir(parents=True, exist_ok=True)
    quantize_dynamic(
        str(source),
        str(target),
        weight_type=QuantType.QInt8,
        op_types_to_quantize=list(recipe.ops),
        nodes_to_exclude=exclude,
        use_external_data_format=True,
    )


def fetch_license(text: LicenseText, target: Path) -> None:
    with urllib.request.urlopen(text.url) as response:  # noqa: S310 - a fixed https URL
        data = response.read()
    if hashlib.sha256(data).hexdigest() != text.sha256:
        raise SystemExit(f"{text.url} does not match its pinned SHA-256")
    target.write_bytes(data)


def model_card(name: str, recipe: Recipe, record: dict) -> str:
    def origin(path: str) -> str:
        if path.split("/")[0] in recipe.quantize:
            return "int8, this conversion"
        if path == recipe.license_text.filename:
            return f"license text, from {recipe.license_text.url}"
        if path == "NOTICE":
            return "written for this copy"
        return "copied unchanged"

    rows = "\n".join(
        f"| `{path}` | {origin(path)} | `{digest}` |" for path, digest in sorted(record["outputs"].items())
    )
    steps = "1 step" if recipe.steps == 1 else f"{recipe.steps} steps"
    quantized = "\n".join(
        f"- `{component}`: dynamic int8 weights for {', '.join(q.ops)}"
        + (f", leaving out nodes named like {', '.join(f'`{p}`' for p in q.exclude)}" if q.exclude else "")
        for component, q in recipe.quantize.items()
    )
    tools = ", ".join(f"{k} {v}" for k, v in record["tools"].items())
    tags = "\n".join(f"- {tag}" for tag in ("onnx", "text-to-image", "int8", "asterism", *recipe.extra_tags))
    license_line = f"license: {recipe.license_id}"
    if recipe.license_id == "other":
        license_line += f"\nlicense_name: {recipe.license_name.lower().replace(' ', '-')}\nlicense_link: LICENSE.md"
    return f"""---
{license_line}
base_model: {recipe.source}
pipeline_tag: text-to-image
library_name: onnx
tags:
{tags}
---

# {recipe.title}

An int8 copy of the ONNX export of [{recipe.source}](https://huggingface.co/{recipe.source}) at revision
`{recipe.revision}`, made for [Asterism](https://github.com/dbracewell/Asterism)'s CPU image generator
(ADR-0077). It needs only ONNX Runtime and a NumPy pipeline: {steps} at {recipe.resolution} px.

{recipe.card_notes}

## What changed

{quantized}

Every other file is copied unchanged. Making these copies needs tens of GB of memory, which is why they are
published here rather than made on each server.

## Provenance

The conversion is deterministic. To check this repository, run Asterism's
`apps/backend/scripts/convert_onnx_image_model.py {name}` with the same tool versions ({tools}) and compare
`conversion.json`.

| File | Source | SHA-256 |
| --- | --- | --- |
{rows}

Upstream file digests are in `conversion.json` under `sources`.
"""


def convert(name: str, out: Path, keep_work: bool, source_dir: Path | None = None) -> dict:
    recipe = RECIPES[name]
    tools = tool_versions()
    for tool, version in EXPECTED_TOOLS.items():
        if tools[tool] != version:
            print(f"warning: {tool} {tools[tool]} is not the pinned {version}; the output may differ", file=sys.stderr)
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} is not empty")
    out.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=f"asterism-{name}-"))
    try:
        sources = fetch_sources(recipe, work, source_dir)
        for path in recipe.copy:
            (out / path).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(work / path, out / path)
        for component, plan in recipe.quantize.items():
            print(f"quantizing {component}…", flush=True)
            quantize(work / component / "model.onnx", out / component / "model.onnx", plan)
    finally:
        if not keep_work:
            shutil.rmtree(work, ignore_errors=True)
    fetch_license(recipe.license_text, out / recipe.license_text.filename)
    (out / "NOTICE").write_text(recipe.notice, encoding="utf-8")
    outputs = {
        str(path.relative_to(out)): sha256_file(path)
        for path in sorted(out.rglob("*"))
        if path.is_file() and path.parts[len(out.parts)] not in {".cache"}
    }
    record = {
        "recipe": name,
        "family": recipe.family,
        "source": {"repo": recipe.source, "revision": recipe.revision},
        "sources": sources,
        "quantize": {k: {"ops": list(v.ops), "exclude": list(v.exclude)} for k, v in recipe.quantize.items()},
        "tools": tools,
        "outputs": outputs,
    }
    (out / "conversion.json").write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (out / "README.md").write_text(model_card(name, recipe, record), encoding="utf-8")
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("recipe", choices=sorted(RECIPES))
    parser.add_argument("out", type=Path)
    parser.add_argument("--keep-work", action="store_true", help="keep the downloaded source files")
    parser.add_argument(
        "--source-dir", type=Path, help="use files already downloaded at the recipe's revision (still checked)"
    )
    args = parser.parse_args()
    record = convert(args.recipe, args.out, args.keep_work, args.source_dir)
    size = sum((args.out / path).stat().st_size for path in record["outputs"])
    print(f"Wrote {len(record['outputs'])} files ({size / 1e9:.2f} GB) to {args.out}")


if __name__ == "__main__":
    main()
