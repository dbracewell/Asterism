# Knowledge Retrieval and Image Captioning

The knowledge subsystem uses separate stores for private retrieval and its
locally provisioned model artifacts. Every eligible uploaded file has a
file-owned artifact generation independent of knowledge-base membership. Image
captioning is globally disabled by default. When an administrator enables it,
generated captions are canonical file metadata and are indexed as draft text;
users can edit, regenerate, or clear that shared caption in the File Manager.
Image CLIP vectors remain independently indexed throughout.

| Data | Owner | Storage |
| --- | --- | --- |
| File artifacts, ordered knowledge-base memberships, and agent assignments | Relational database | SQLite through the existing SQLAlchemy/migration path |
| Chunk content, provenance IDs, and vectors | `LanceDbVectorStore` | `STORAGE_ROOT/knowledge/lancedb` |
| Pinned local embedding model and tokenizer/processor assets | Operator | `STORAGE_ROOT/models/knowledge-clip` |
| Pinned local caption bundle and its integrity manifest | Admin or operator | `STORAGE_ROOT/models/captioning-smolvlm2` |

`knowledge_chunks` is one LanceDB table. Every row includes `user_id`, `file_id`,
and artifact generation provenance. Retrieval resolves an agent's assigned
knowledge-base memberships to allowed file IDs before it queries LanceDB; the
adapter exposes only owner- and allowed-file-filtered search, file/chunk
deletion, and no unfiltered search API.

## Model contract

The pinned initial provider is `Xenova/clip-vit-base-patch32` at reviewed
revision `dcb5f6119fdbb94f1053e98bd74da0ac582ed2a7`, selected by the
repository's `onnx/model_quantized.onnx` SHA-256:

```text
90d3b30b11fc99c781a147df7cb3b8dff38b02b2d838b3b28392e7dfb34920b9
```

The artifact is exactly 152,998,734 bytes (about 146 MiB), produces normalized
512-dimensional image and text vectors, and is executed with CPU ONNX Runtime.
The provider accepts no model-defined Python code and loads tokenizer/processor
assets only from the local directory (`local_files_only=True`). Its combined
CLIP graph requires both modality inputs, so it supplies deterministic blank
images for text embedding and empty text for image embedding; only the requested
output (`text_embeds` or `image_embeds`) is retained.

At startup, Asterism automatically provisions the reviewed bundle when it is
missing or invalid. It downloads only the following allowlisted files from that
exact revision into a temporary sibling directory, verifies every required file
and the exact ONNX size/SHA-256, writes a manifest of file digests, then atomically
promotes the bundle to `STORAGE_ROOT/models/knowledge-clip`. The selected ONNX
artifact is renamed to `model.onnx`:

- `onnx/model_quantized.onnx` → `model.onnx`
- `config.json`, `preprocessor_config.json`, `tokenizer.json`, `tokenizer_config.json`
- `special_tokens_map.json`, `vocab.json`, `merges.txt`

Startup creates/opens LanceDB without blocking on the model download. Files that
arrive while provisioning is in progress remain pending and are automatically
resumed only after the verified bundle is promoted. The admin settings page exposes
safe readiness/progress diagnostics; there is no manual embedding-model install
step. A failed provisioning attempt remains retryable on a later runtime start.

## Local image-captioning provisioning and benchmark

Image captioning is disabled unless an administrator selects a provider model or
local mode. A provider selection must be active and have provider/catalog-derived
vision capability; manually asserted or unknown vision metadata is insufficient.
The local adapter is CPU-only and never downloads a model during initialization
or captioning. It loads with `local_files_only=True` and `trust_remote_code=False`.
In provider mode, source image data is sent only to the exact administrator-selected
vision-capable provider model; there is no provider fallback. Administrators should
therefore choose a provider consistent with their data-processing requirements.

Operators must review and download a specific SmolVLM2 revision out of band into
`STORAGE_ROOT/models/captioning-smolvlm2`. No unreviewed model ID or revision is
implicitly selected by Asterism. For local mode, Asterism supports two provisioning paths:

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
  --model-id HuggingFaceTB/SmolVLM2-256M-Video-Instruct \
  --revision 067788b187b95ebe7b2e040b3e4299e342e5b8fd
```

The manifest hashes every regular bundle file. Set its emitted checksum in
`LOCAL_CAPTION_MODEL_BUNDLE_SHA256` for manual provisioning. Missing, modified,
external, or malformed artifacts leave local captioning unavailable with a safe
readiness error; caption requests never make a network call. Keep the model
bundle backed up alongside knowledge files and the relational database.

Before enabling local mode in production, benchmark every supported CPU target:

```bash
uv run python scripts/benchmark_local_captioning.py \
  --model-root /storage/models/captioning-smolvlm2 \
  --bundle-sha256 <manifest-sha256> --concurrency 1 \
  --output caption-benchmark-$(uname -s)-$(uname -m).json
```

The record includes disk size, cold initialization/caption latency, warm latency,
concurrent elapsed time, peak RSS, and generated fixture captions for manual
quality review.

### SmolVLM2 CPU benchmark record

The pinned bundle was benchmarked on 2026-09-22 with Python 3.13, Torch 2.13,
Transformers 5.14.1, `torchvision` 0.28, and `num2words` 0.5.14. The fixture is
a generated 224px red square. Its returned caption accurately identifies the
red, otherwise-empty image. Each value is one run; the Linux container shares
the Apple M5 Max host but is a separate Linux arm64 runtime.

| Target | Bundle | Initialize | Cold caption | Warm caption | 2 concurrent captions | Peak RSS (1 / 2) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| macOS arm64, Apple M5 Max | 983 MiB | 2.66 s | 3.98 s | 3.78 s | 6.56 s | 2.53 / 3.72 GiB |
| Linux arm64, Docker/Colima on same host | 983 MiB | 2.65 s | 11.94 s | 11.86 s | 26.66 s | 2.56 / 3.38 GiB |

**Deployment threshold:** local mode defaults to one concurrent caption and
requires at least 4 GiB process RSS headroom. Do not enable it on
memory-constrained hosts. Two concurrent captions do not improve throughput on
the measured targets and increase RSS substantially, so retain the default of
one unless the deployment is independently benchmarked.

## Bounds and lifecycle

`MAX_CONCURRENT_KNOWLEDGE_EMBEDDINGS` and
`MAX_CONCURRENT_KNOWLEDGE_VECTOR_OPERATIONS` both default to 2 and are validated
between 1 and 16. Blocking ONNX and LanceDB calls run in worker threads behind
those semaphores. `MAX_CONCURRENT_LOCAL_CAPTIONS` defaults to 1 and is validated
from 1 through 4; its CPU-only provider has a separate semaphore. The caption
bundle is never fetched during initialization or inference. The admin download
service permits only one in-flight download, exposes safe status/progress,
supports cancellation/retry, and validates the pinned manifest before reporting
an existing bundle ready.

`init_system` opens LanceDB and starts bounded ingestion and caption-job recovery; FastAPI
shutdown cancels caption jobs and downloads, releases caption/embedding runtime
references, closes the vector-store service, then closes the database engine.
Caption jobs are one per file artifact generation, have a strict timeout and bounded
concurrency. Their status, source/model identity, and safe error reason remain on
the file artifact; ordinary structured logs omit image bytes and caption text. A
failed or canceled replacement keeps the prior current artifact available.
Ingestion jobs are likewise bounded and idempotent; their processing status and
safe error reason are available from the File Manager, which offers retry and
cancellation.

For a vector schema/version migration, create a new LanceDB table/version,
re-embed from the relational file artifacts, validate counts and retrieval,
then atomically switch the configured table/version and retain/remove the old
one under an explicit operator decision. Do not mutate vectors in place or rely
on `Base.metadata.create_all` for relational upgrades.

## Operations, limits, and security

Back up `STORAGE_ROOT` together with the relational database. In particular,
preserve `knowledge/lancedb`, `models/knowledge-clip`,
`models/captioning-smolvlm2`, and uploaded source files; LanceDB vectors alone
cannot recreate the immutable source files and their relational artifact records. The caption bundle is
reprovisionable from its pinned revision, but preserve its manifest/checksum so
an operator can verify the restored bundle before enabling local mode.
To rebuild a damaged or upgraded index, stop ingestion, retain the old LanceDB
directory as a rollback copy, create the new table/version, re-ingest the ready
relational file artifacts, validate file/chunk counts and representative
queries, then switch the configured version atomically. Never delete the old
index until that validation and a tested backup are complete.

Defaults bound local work to two concurrent embedding, vector, and ingestion
operations; a file artifact produces at most 200 chunks of 1,000 characters with a
150-character overlap. Retrieval accepts at most 10 results and returns at most
16 KiB of excerpts. Source file conversion remains bounded by
`MAX_PROCESS_FILE_SIZE_BYTES` (100 MiB), `MAX_CONVERTED_CHARS` (100,000), and
`FILE_CONVERSION_TIMEOUT_S` (60 seconds). Operators may tune the documented
configuration values only within their validated ranges and must reserve at
least 1.25 GiB RSS per embedding worker.

Knowledge bases are private ordered collections owned by their user. The relational
assignment is an explicit allowlist: only ready file artifacts whose memberships
belong to bases assigned to the active agent are searched. `search_knowledge` is
offered and automatically authorized only in that case; it cannot be enabled by an
agent tool preference or an invented tool name. Every LanceDB query filters the
owner and resolved allowed file IDs. Results label their provenance as `caption`
or `text`; image artifacts contribute a visual embedding and captions contribute
indexed text when present. Runtime
traces record safe IDs, counts, duration, and model/index versions—not queries,
document text, caption text, or full files.

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

## File-centric processing

`UserFile` is the immutable source revision. `FileKnowledgeArtifact` owns each
derived generation, including extraction, chunks, embeddings, and canonical
image captions. A `knowledge_base_files` row is only an ordered collection
membership. Retrieval resolves assigned memberships before searching and sends
both owner and allowed file IDs to LanceDB; it never searches globally then
filters in application code. Removing a membership preserves the file and its
artifacts; deleting a file cancels work and removes memberships, artifacts,
vectors, and source bytes. An administrator updates the one global
`knowledge.processing` policy; a policy identity change creates and queues
replacement generations for the full eligible library, while a ready previous generation remains searchable
until its replacement is complete.
