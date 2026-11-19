# Knowledge model benchmarks (2026-09-22)

Measurements behind the choice of the embedding model and the local captioning
model, moved here from the knowledge architecture guides. The guides describe how
the models are used; this record keeps what was measured and when.

## Embedding model: CLIP ViT-B/32 (quantized ONNX)

`Xenova/clip-vit-base-patch32` at revision
`dcb5f6119fdbb94f1053e98bd74da0ac582ed2a7`, file `onnx/model_quantized.onnx`
(152,998,734 bytes), run with CPU ONNX Runtime 1.20.1 on Python 3.13.

The fixed corpus has two generated 224 px squares, one red and one blue. The query
"a red square" must rank red above blue, and "a blue square" the reverse. Both
rankings passed on every target.

| Target                                      | Initialize | 2 text embeddings | 2 image embeddings |  Peak RSS |
| ------------------------------------------- | ---------: | ----------------: | -----------------: | --------: |
| macOS arm64, Apple M5 Max                   |    0.312 s |           0.044 s |            0.034 s |  ~849 MiB |
| Linux arm64, Docker/Colima on the same host |    0.406 s |           0.031 s |            0.018 s | ~1.11 GiB |

The bundle met the under-400 MB disk constraint and the relevance check, so it was
selected. Its memory use is much larger than the file: reserve at least 1.25 GiB
per embedding worker until a deployment measures a lower bound. Linux x86_64 and
macOS Intel were not measured.

## Local captioning model: SmolVLM2 256M

`HuggingFaceTB/SmolVLM2-256M-Video-Instruct` at revision
`067788b187b95ebe7b2e040b3e4299e342e5b8fd`, with Python 3.13, Torch 2.13,
Transformers 5.14.1, torchvision 0.28 and num2words 0.5.14. The fixture is a
generated 224 px red square; the caption correctly described a red, otherwise
empty image. Each value is one run.

| Target                                  |  Bundle | Initialize | Cold caption | Warm caption | 2 concurrent captions | Peak RSS (1 / 2) |
| --------------------------------------- | ------: | ---------: | -----------: | -----------: | --------------------: | ---------------: |
| macOS arm64, Apple M5 Max               | 983 MiB |     2.66 s |       3.98 s |       3.78 s |                6.56 s |  2.53 / 3.72 GiB |
| Linux arm64, Docker/Colima on same host | 983 MiB |     2.65 s |      11.94 s |      11.86 s |               26.66 s |  2.56 / 3.38 GiB |

Two concurrent captions did not improve throughput and raised memory use
substantially, so local captioning defaults to one at a time
(`MAX_CONCURRENT_LOCAL_CAPTIONS=1`) and needs at least 4 GiB of headroom.

To measure a new target:

```bash
cd apps/backend
uv run python scripts/benchmark_local_captioning.py \
  --model-root /storage/models/captioning-smolvlm2 \
  --bundle-sha256 <manifest-sha256> --concurrency 1 \
  --output caption-benchmark-$(uname -s)-$(uname -m).json
```
