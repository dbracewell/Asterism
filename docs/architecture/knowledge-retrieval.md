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
