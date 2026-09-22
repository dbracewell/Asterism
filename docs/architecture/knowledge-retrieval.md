# Knowledge Retrieval Storage and Embedding Foundation

EPIC-17 uses separate stores for private knowledge retrieval:

| Data | Owner | Storage |
| --- | --- | --- |
| Knowledge-base/document metadata, state, and later agent assignments | Relational database | SQLite through the existing SQLAlchemy/migration path |
| Chunk content, provenance IDs, and vectors | `LanceDbVectorStore` | `STORAGE_ROOT/knowledge/lancedb` |
| Pinned local embedding model and tokenizer/processor assets | Operator | `STORAGE_ROOT/models/knowledge-clip` |

`knowledge_chunks` is one LanceDB table. Every row includes `user_id` and
`knowledge_base_id`; every retrieval query applies both filters before the
limit. The adapter exposes only add, filtered search, document deletion, and
base deletion. It never exposes an unfiltered search API.

## Model contract

The pinned initial provider is `Xenova/clip-vit-base-patch32` revision selected
by the repository's `onnx/model_quantized.onnx` SHA-256:

```text
0898a3facfdb27f0a041e57649b4989cfd094e4a0040d6ae75ed69917dfc7328
```

The artifact is exactly 153,695,702 bytes (about 147 MiB), produces normalized
512-dimensional image and text vectors, and is executed with CPU ONNX Runtime.
The provider accepts no model-defined Python code and loads tokenizer/processor
assets only from the local directory (`local_files_only=True`). Its combined
CLIP graph requires both modality inputs, so it supplies deterministic blank
images for text embedding and empty text for image embedding; only the requested
output (`text_embeds` or `image_embeds`) is retained.

To provision an offline runtime, download these files from the reviewed model
revision into `STORAGE_ROOT/models/knowledge-clip`, renaming the selected ONNX
artifact to `model.onnx`:

- `onnx/model_quantized.onnx` → `model.onnx`
- `config.json`, `preprocessor_config.json`, `tokenizer.json`, `tokenizer_config.json`
- `special_tokens_map.json`, `vocab.json`, `merges.txt`

Startup creates/opens LanceDB but does not load the model. The model is checked
for its exact configured size and SHA-256 only on first embedding request; a
missing/corrupt model fails that operation without making a network request.

## Local image-captioning provisioning and benchmark

Image captioning is disabled unless an administrator selects a provider model or
local mode. A provider selection must be active and have provider/catalog-derived
vision capability; manually asserted or unknown vision metadata is insufficient.
The local adapter is CPU-only and never downloads a model during initialization
or captioning. It loads with `local_files_only=True` and `trust_remote_code=False`.

Operators must review and download a specific SmolVLM2 revision out of band into
`STORAGE_ROOT/models/captioning-smolvlm2`. No unreviewed model ID or revision is
implicitly selected by Asterism. After downloading, generate the manifest and set
its emitted checksum in `LOCAL_CAPTION_MODEL_BUNDLE_SHA256`:
For local mode, Asterism supports two provisioning paths:

1. **Admin-initiated download:** An administrator triggers `POST /api/py/settings/app/caption-model/download`
   from the configuration UI. A background task downloads the pinned, reviewed
   SmolVLM2 revision (`HuggingFaceTB/SmolVLM2-256M-Video-Instruct`), builds the
   integrity manifest, and activates the local runtime once verified.
2. **Manual operator provisioning:** Operators may download the bundle out of band into
   `STORAGE_ROOT/models/captioning-smolvlm2` and generate the manifest:

```bash
cd apps/backend
uv run python scripts/provision_local_caption_bundle.py \
  --model-root /storage/models/captioning-smolvlm2 \
  --model-id HuggingFaceTB/SmolVLM2-256M-Instruct --revision <reviewed-revision>
  --model-id HuggingFaceTB/SmolVLM2-256M-Video-Instruct --revision <reviewed-revision>
```

The manifest hashes every regular bundle file. Missing, modified, external, or
malformed artifacts leave local captioning unavailable with a safe readiness
error; no request makes a network call. Keep the model bundle backed up alongside
error; caption requests never make a network call. Keep the model bundle backed up alongside
knowledge files and the relational database.

Before enabling local mode in production, benchmark every supported CPU target:

```bash
uv run python scripts/benchmark_local_captioning.py \
  --model-root /storage/models/captioning-smolvlm2 \
  --bundle-sha256 <manifest-sha256> --concurrency 1 \
  --output caption-benchmark-$(uname -s)-$(uname -m).json
```

The record includes disk size, cold initialization/caption latency, warm latency,
concurrent elapsed time, peak RSS, and generated fixture captions for manual
quality review. Record macOS and Linux results before approving a deployment.
Until those measurements exist, run one local caption at a time and reserve at
least 4 GiB process RSS; do not enable local mode on memory-constrained hosts.

## Bounds and lifecycle

`MAX_CONCURRENT_KNOWLEDGE_EMBEDDINGS` and
`MAX_CONCURRENT_KNOWLEDGE_VECTOR_OPERATIONS` both default to 2 and are validated
between 1 and 16. Blocking ONNX and LanceDB calls run in worker threads behind
those semaphores. `init_system` opens LanceDB; FastAPI shutdown drops runtime
references and closes the vector-store service before the database engine closes.
Ingestion work, document limits, retries, and rebuild orchestration are defined
in US-17.2; no unbounded ingestion registry is introduced by this foundation.

For a vector schema/version migration, create a new LanceDB table/version,
re-embed from the relational document revisions, validate counts and retrieval,
then atomically switch the configured table/version and retain/remove the old
one under an explicit operator decision. Do not mutate vectors in place or rely
on `Base.metadata.create_all` for relational upgrades.

## Operations, limits, and security

Back up `STORAGE_ROOT` together with the relational database. In particular,
preserve `knowledge/lancedb`, `models/knowledge-clip`, and uploaded source
files; LanceDB vectors alone cannot recreate the immutable document revisions.
To rebuild a damaged or upgraded index, stop ingestion, retain the old LanceDB
directory as a rollback copy, create the new table/version, re-ingest the ready
relational document revisions, validate document/chunk counts and representative
queries, then switch the configured version atomically. Never delete the old
index until that validation and a tested backup are complete.

Defaults bound local work to two concurrent embedding, vector, and ingestion
operations; a document produces at most 200 chunks of 1,000 characters with a
150-character overlap. Retrieval accepts at most 10 results and returns at most
16 KiB of excerpts. Source file conversion remains bounded by
`MAX_PROCESS_FILE_SIZE_BYTES` (100 MiB), `MAX_CONVERTED_CHARS` (100,000), and
`FILE_CONVERSION_TIMEOUT_S` (60 seconds). Operators may tune the documented
configuration values only within their validated ranges and must reserve at
least 1.25 GiB RSS per embedding worker.

Knowledge bases are private to their owning user. The relational assignment is
an explicit allowlist: only ready bases assigned to the active agent are
searched. `search_knowledge` is offered and automatically authorized only in
that case; it cannot be enabled by an agent tool preference or an invented tool
name. Every LanceDB query filters both user and base IDs, and runtime traces
record safe IDs, counts, duration, and model/index versions—not queries,
document text, or full files.

## Benchmark record

A deterministic benchmark was run on 2026-09-22 with Python 3.13 and ONNX
Runtime 1.20.1. Its fixed corpus contains generated 224px red and blue squares;
`a red square` must rank red above blue and `a blue square` must rank blue above
red. Both rankings passed on every measured target.

| Target | Initialize | 2 text embeddings | 2 image embeddings | Peak RSS |
| --- | ---: | ---: | ---: | ---: |
| macOS arm64, Apple M5 Max | 0.312 s | 0.044 s | 0.034 s | ~849 MiB |
| Linux arm64, Docker/Colima on the same host | 0.406 s | 0.031 s | 0.018 s | ~1.11 GiB |

The artifact bundle satisfies the <400 MB disk-model constraint and the
relevance smoke threshold, so it is the selected initial provider. Its CPU
process RSS is substantially larger than its artifact; operators must reserve
at least 1.25 GiB per embedding worker process until a deployment-specific
measurement proves a lower safe bound. Linux x86_64 and macOS Intel remain
release-environment preflight targets, not an untested alternative runtime.
