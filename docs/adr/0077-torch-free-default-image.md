# ADR-0077 — A torch-free default image

Status: accepted. Captioning implemented for US-94.1, Diffusers as an optional
install for US-94.2 and an ONNX image generator for US-94.4, all on 2026-11-22
([EPIC-94](../epics/EPIC-94-TORCH-FREE-DEFAULT-IMAGE.md)). Amends
[ADR-0064](0064-image-generation.md) on where local image generation runs.

## Context

Local captioning loaded `HuggingFaceTB/SmolVLM2-256M-Video-Instruct` (revision
`067788b187b95ebe7b2e040b3e4299e342e5b8fd`) as safetensors with `transformers` on
PyTorch. Captioning and the local Diffusers generator were the only users of
torch, which is 635 MB of the image. Search embeddings already run a pinned ONNX
CLIP on ONNX Runtime. The same SmolVLM2 revision publishes ONNX exports: a
`vision_encoder`, an `embed_tokens` and a `decoder_model_merged` with a
key/value cache, each in several precisions.

The old bundle was also checked only against a manifest written at download time:
every file was hashed after the download, but nothing in the code said what the
hashes should be.

## Decision: captioning on ONNX Runtime

**Captioning runs SmolVLM2 on ONNX Runtime, in every build.**
`OnnxSmolVlm2CaptionProvider` (`knowledge/captioning.py`) replaces
`LocalSmolVlm2CaptionProvider`; the inference is in `knowledge/onnx_captioning.py`:

- The tokenizer (`AutoTokenizer`) and the PIL image processor
  (`SmolVLMImageProcessorPil`) come from `transformers`, which needs no torch for
  them. `SmolVLMProcessor` itself can't be built without torch (its video
  processor requires it), so the prompt is built in Asterism: the chat template's
  one user turn, with the image expanded into `rows × cols` tiles plus a global
  view, `image_seq_len` (64) image tokens each, as the processor does.
- The vision encoder runs **one 512 px tile at a time**. Encoding a large image's
  17 tiles as one batch peaks at 3.4 GB; one at a time peaks under 1 GB. In fp32
  the features match the batched ones to 2e-4; in int8 they differ slightly,
  because dynamic quantization scales each run's activations.
- The image features replace the `<image>` token embeddings, and a greedy decode
  over `decoder_model_merged` carries its key/value cache in NumPy: the first step
  feeds the whole prompt with an empty cache, each later step one token. Decoding
  stops at `<end_of_utterance>` (the end token), at 128 new tokens, or with a
  `timeout` error at `FILE_CONVERSION_TIMEOUT_S`, checked between tokens. The
  caption is then bounded to `MAX_CAPTION_CHARS` as before.

**The int8 export is used.** It was chosen by the comparison below: its captions
are as accurate as the torch model's, often shorter. It is the fastest and smallest
variant and peaks at about half the torch model's memory.

**The bundle is a pinned file list.** `PinnedModel.files` names every file and its
SHA-256: the ten tokenizer and processor configuration files and the three int8
graphs (265,041,118 bytes). `ModelDownloadService` downloads exactly those files
into `<root>.staging`, checks each digest, and only then writes the manifest and
swaps the directory in for the model root, so the old safetensors bundle (and
anything else in the root) is removed. A file with the wrong digest is deleted and
the attempt fails, so a retry fetches it again. The staging folder persists between
attempts, so an interrupted download resumes. A swap interrupted after the old root
was moved out is completed at the next check. A bundle is ready only when its
manifest lists exactly the pinned files at their pinned digests and every file on
disk matches.

**Captioning stays off until the bundle verifies.** A local caption job whose
bundle isn't ready leaves the caption pending rather than failing it. When local
captioning is on and the bundle is missing or stale, startup starts the download
(as it does for the embedding bundle), so an upgrade needs no admin step. When the
bundle verifies, pending captions resume. Stored captions are not touched.

## Decision: local image generation is an optional install

**The default install has no PyTorch.** `diffusers`, `accelerate`, `torch` and
`torchvision` are the `local-image` extra in `pyproject.toml`, with the PyTorch
CPU index source for Linux. `onnxruntime` is required at 1.32 or later, which
dropped its `sympy` dependency, so sympy (74 MB) goes too. One `uv.lock`
resolves both installs. `scripts/check_default_install.py` reads it, follows the
default dependencies and the extras they request on every platform, and fails
naming the chain when one of the four is reached; CI runs it
(`pnpm check:default-install`).

**Only the GPU build installs it.** The Dockerfile's default CPU build, which is
the published image, syncs without extras. `TORCH_VARIANT=gpu` syncs with
`--extra local-image`, then swaps in CUDA torch as before. `pnpm check:image`
fails when the CPU image's backend can import any of the four packages
(`--variant gpu` checks the reverse). Local generation on a CPU is too slow for a
class, and a Mac checkout can still install the extra.

**Nothing switches silently.** `local/availability.py` finds the four packages
without importing them (importing torch takes seconds). Without them:

- the Diffusers component isn't registered, so the generator picker offers only
  ComfyUI, and saving Diffusers is refused as an unknown provider;
- a saved Diffusers choice stays stored and readable; the provider status, and so
  the chat's availability, reads "Diffusers is not available in this image", so
  `generate_image` and Create image aren't offered, as for any unready generator;
- `GET /settings/app/image-generation/local` reports `installed: false` with the
  saved settings and no hardware or catalog, and every change or download is
  refused. Downloaded model files stay on disk until the GPU build removes them.

Backend tests run on both installs: the default one in the quality job, and the
image-generation tests again with the extra (`test:local-image`). Tests that need
torch skip without it; the rest register the Diffusers component themselves.

## Decision: an ONNX image generator in every build

Taking Diffusers out of the published image would leave it with no local image
generation, and on a Mac, Docker can't reach Metal, so the CPU is all an in-image
generator gets anyway. So every build has a second local generator, **ONNX**: few-step
Stable Diffusion models on ONNX Runtime and NumPy, on the CPU, with no new runtime
dependency (US-94.4). Diffusers stays the GPU build's generator, and ComfyUI the
choice for larger models.

**Pipelines** (`image_generation/onnx/pipeline.py`). Two families, each a text
encoder step, a UNet loop and a VAE decode:

- `lcm`: Stable Diffusion 1.5 with a Latent Consistency Model UNet. Guidance is
  distilled into the UNet as a 256-wide sinusoidal embedding of `scale − 1`
  (`timestep_cond`), so each step is one UNet run; LCM's scheduler takes evenly
  spaced timesteps from its 50-step distillation schedule.
- `sdxl`: SDXL Turbo. The two CLIP encoders' penultimate hidden states are joined
  (768 + 1280), with the second's pooled embedding and the size conditioning
  (`time_ids`); Euler ancestral sampling with trailing timesteps (one step is
  t = 999), no classifier-free guidance.

The schedulers are short NumPy ports of diffusers' (`onnx/schedulers.py`). Noise
comes from NumPy, so a seed gives the same image on every machine, not the one
diffusers would. Sessions run without ONNX Runtime's memory arena, memory pattern or
weight prepacking, which cuts about 2 GB per image at the same speed. A pipeline is
called like a diffusers pipeline, so the existing worker process runs it
(`pipeline="onnx-<family>"`) with the same progress, cancellation, out-of-memory
handling and idle stop.

**int8 copies, made once and published.** The upstream ONNX exports are fp32: LCM
DreamShaper v7 peaks at 7.7 GB and SDXL Turbo at 15 GB per image. Dynamic int8
weights bring that to 5.2 and 7.9 GB, but ONNX Runtime's quantizer holds about three
copies of a model (11.8 GB for LCM, 32.6 GB for SDXL Turbo), too much to do on the
server that downloads it. So `scripts/convert_onnx_image_model.py` makes the copies
once and they are published under `huggingface.co/davidb727`, each with its
upstream license, a `NOTICE` saying what changed, a model card and
`conversion.json` (source revision and file digests, tool versions, output digests).
The conversion is deterministic (the same inputs and tools gave byte-identical files
across runs and NumPy versions), so anyone can check a published repository by
running it again. Third-party int8 uploads exist but can't be checked that way.

**What is int8 was chosen by looking at the images.** For LCM, the UNet's MatMul
and Conv weights. For SDXL Turbo, the defaults broke it: with the UNet's MatMuls in
int8 the images ignored the prompt (every prompt gave the same river landscape), and
with its Convs in int8 they had mosaic artifacts. Keeping the cross-attention keys
and values (`attn2/to_k`, `attn2/to_v`, which read the prompt) and every Conv in
float32, with the second text encoder's MatMuls in int8, matches the fp32 images.

**The catalog** (`onnx/catalog.py`) pins each published repository's revision and
the SHA-256 of every file Asterism uses, its LICENSE and NOTICE included, through
the pinned-bundle download of US-94.1. A model fits when its measured peak plus a
tenth (at least 1 GB) is within 80% of the server's memory.

| Model                            | License                                                  | Download | Steps | Per image | Peak memory |
| -------------------------------- | -------------------------------------------------------- | -------: | ----: | --------: | ----------: |
| LCM DreamShaper v7 (the default) | CreativeML Open RAIL-M                                   |  1.56 GB |     4 |     4.3 s |      5.2 GB |
| SDXL Turbo                       | Stability AI Community License, accepted before download |  6.19 GB |     1 |     2.8 s |      7.9 GB |

Measured at 512 px on an Apple M5 Max CPU through the production pipeline, first
image excluded (5.1 and 3.3 s). LCM DreamShaper v7's repository is tagged MIT, but
its weights derive from DreamShaper 7 and Stable Diffusion 1.5 under CreativeML Open
RAIL-M, whose use restrictions travel with it. SDXL Turbo's license allows free
commercial use below US $1M revenue with registration, so it goes through the same
acceptance step as non-commercial models, and "Powered by Stability AI" is shown
beside it. Left out: SDXL base (25-50 steps at 1024 px is minutes per image on a
CPU), and SD 3.5 Medium (only an unofficial 32.5 GB export, and a different
pipeline).

**Admin.** The ONNX generator has its own models page (`/settings/app/image-generation/onnx`:
server memory, fit, licenses, downloads) and setting (`image_generation_onnx`),
exported with the other settings. A saved Diffusers choice in an image without it
reads "Diffusers is not available in this image. Choose ONNX to generate images on
this server's CPU"; nothing switches by itself.

## Comparison

Twelve images: six photos from Wikimedia Commons, fetched at 800 px wide (a fly
agaric, a tabby cat, cumulus clouds, the Golden Gate Bridge, hot air balloons, a
red apple), and six generated with PIL: two diagrams (a bar chart and a flowchart),
two UI screenshots (a sign-in form and a chat app) and two text images (a notice
and a sale sign). Same prompt, greedy decoding, 128 new tokens at most. Each
variant ran in its own process on macOS arm64 (Apple M5 Max), Python 3.13, torch
2.13 with transformers 5.23, ONNX Runtime 1.32 CPU. Peak RSS is the process's
high-water mark over the whole set. ONNX variants encode one tile at a time.

| Variant          | Download | Initialize | Mean / slowest per image | Peak RSS | Captions                                                                  |
| ---------------- | -------: | ---------: | -----------------------: | -------: | ------------------------------------------------------------------------- |
| torch (previous) |  1.03 GB |     1.55 s |          3.56 s / 4.51 s | 3.13 GiB | The reference                                                             |
| ONNX fp32        |  1.03 GB |     0.84 s |          3.34 s / 4.44 s | 2.50 GiB | The same as torch, nearly word for word                                   |
| **ONNX int8**    |   260 MB |     0.75 s |          2.60 s / 3.04 s | 1.69 GiB | Accurate on all twelve, often shorter                                     |
| ONNX uint8       |   260 MB |     0.70 s |          2.60 s / 3.47 s | 1.68 GiB | Invents detail: a rock formation in the clouds, the chat app as a table   |
| ONNX q4          |   264 MB |     0.67 s |          4.91 s / 5.99 s | 1.74 GiB | Slowest; loops ("the wall is a bit white" ×6), wrong axes on the chart    |
| ONNX bnb4        |   250 MB |     0.61 s |          3.53 s / 5.25 s | 2.04 GiB | Wrong on the chart (three products) and the chat app; the bridge unnamed  |
| ONNX fp16, q4f16 |   515 MB |          — |                        — |        — | Do not run on CPU ONNX Runtime 1.32: a Cast node it inserts fails a shape |

Download is the three graphs; every variant adds the same 5 MB of configuration.

Some int8 captions next to the torch model's:

| Image          | torch                                                                                       | int8                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Fly agaric     | A red mushroom with white spots on its cap … surrounded by green grass and other plants.    | A red mushroom with white spots on its cap                                                                    |
| Cat            | A tabby cat is sitting on a stone wall.                                                     | A tabby cat sitting on a stone wall. The cat has a striped coat … looking directly at the camera.             |
| Bar chart      | A bar chart titled "Monthly sales." … four vertical bars … labeled from January to May.     | A bar chart titled "Monthly sales." … five vertical bars … January, February, March, April, and May.          |
| Sign-in form   | A screenshot of a webpage displaying a sign-in form …                                       | A screenshot of a webpage. The page is titled "Acme Portal" … a navigation menu with the heading "Sign in".   |
| Library notice | … reads "LIBRARY NOTICE" … "The library will be closed on Monday for maintenance. Please …" | … reads "LIBRARY NOTICE" on top … "The library will be closed on Monday for maintenance. Please return all …" |
| Sale sign      | A promotional graphic for a sale … "SALE" in capital letters … "50% off everything" …       | A sale advertisement with the word "SALE" in large red letters on a beige background.                         |

The int8 chart caption counts the bars correctly where torch doesn't; the sale-sign
caption leaves out "50% off everything". Neither is a pattern across the set.

To measure a deployment target with its own images:

```bash
cd apps/backend
uv run python scripts/benchmark_local_captioning.py \
  --model-root /storage/models/captioning-smolvlm2 \
  --images <directory> --output caption-benchmark-$(uname -s)-$(uname -m).json
```

## Consequences

- The published image has no PyTorch, sympy or diffusers, and new torch releases
  no longer grow it. US-94.3 lowers its size budget to keep the gain.
- Local captioning downloads 265 MB instead of about 1 GB and needs about 2 GiB of
  memory headroom instead of 4 GiB.
- Every build generates images locally on the CPU with the ONNX generator. Diffusers
  needs the GPU build: an instance upgraded from an image with it keeps its saved
  Diffusers choice and downloaded models, but generates no images until an admin
  chooses ONNX or ComfyUI, or moves to the GPU build.
- The ONNX models depend on repositories under `davidb727`. A new model or revision
  means running the conversion script, checking the images, publishing, and pinning
  the new revision and digests in the catalog.
- A Mac checkout doesn't install local image generation by default; a developer
  working on it runs `uv sync --extra local-image`.
- Deployments with local captioning on download the new bundle once, on the first
  start after the upgrade. Images uploaded while it downloads are captioned once it
  verifies.
- Captions written by the torch model stay as they are. Regenerating a file
  captions it again with the ONNX model, whose wording differs.
- The prompt construction copies `SmolVLMProcessor`'s image-token expansion. A
  `transformers` upgrade that changes it does not affect Asterism, but a new model
  revision would need the expansion checked again.
- Linux targets were not measured for this record. The previous torch
  measurements are in the
  [2026-09-22 benchmarks](../reviews/2026-09-22-knowledge-model-benchmarks.md).
