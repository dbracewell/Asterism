# EPIC-99: Multilingual text embeddings, images found by caption

Status: in progress (2026-11-24). US-99.1 to US-99.3 done. Source: user request (2026-11-24): "Instead of our
current text/image embedding use Xenova/multilingual-e5-small, and for images
embed the caption, meaning captioning is now required for images to be found in
search."

## Objective

Knowledge search, similar files and memory ranking use one multilingual text
embedding model, `Xenova/multilingual-e5-small` (ONNX, 384 dimensions). An image
is found only through its caption. The docs and the Image captioning settings
say plainly that turning captioning off means images cannot be found. Existing
installations re-embed automatically on upgrade, with no lost files or memories.

Out of scope: a choice of embedding model in Admin Settings; GPU runtimes;
changing the captioning models.

## Where things stand (verified 2026-11-24)

- **One CLIP model for text and images.** `Xenova/clip-vit-base-patch32`
  (quantized ONNX, about 153 MB, revision and SHA-256 pinned) runs on ONNX
  Runtime CPU (`domains/knowledge/embedding.py:36-205`).
  - Text is embedded through the joint graph with a blank image, cut to CLIP's
    77 tokens. Chunks are 1,000 characters (`core/config.py:156`), so most of
    each chunk is never embedded.
  - There are no query or passage prefixes.
- **Callers:**
  - file chunks: `knowledge/ingestion.py:111-130`
  - captions: `knowledge/captioning.py:279`
  - the retrieval query: `retrieval/service.py:365`
  - memory writes: `memory/service.py:71`
  - turn memory ranking: `memory/turns.py:59`
  - similar files, as a centroid of stored vectors: `knowledge/artifacts.py:211-247`
- **Vectors.** `knowledge_chunks` and `memory_vectors` are fixed-size
  512-dimension LanceDB tables (`embedding_dimension = 512`, `config.py:135`).
  They are opened with `exist_ok=True` and are not keyed by model. A 384-dimension
  provider would be refused on every write and search.
- **Re-embedding.** Knowledge reprocessing is driven by `processing_identity`,
  which hashes the stored `embedding_model` label `"onnx-clip-v1"`
  (`knowledge/policy.py:39-71`). Nothing at startup compares the stored label
  with the code, so changing the default re-embeds nothing. Memory vectors are
  rebuilt when a row's revision changes, not when the model does
  (`memory/rebuild.py:32-56`).
- **Captions are already the search gate.** An uncaptioned image is READY but
  `searchable=False` (`ingestion.py:311`). A caption chunk makes it searchable
  (`captioning.py:279-305`). Once captioned, the CLIP image vector also takes
  part in text search and similar files.
  - Captioning defaults to `disabled` (`caption_schemas.py:41-57`).
  - The captioning pane (`admin-settings/captioning-settings.tsx:84-230`) never
    says that images cannot be found without a caption.
- **Provisioning.** The model is downloaded on first start into
  `/storage/models/knowledge-clip` (`knowledge/runtime.py:128-153`,
  `model_download.py:312-330`). It is not in the image. Files uploaded before the
  model is ready stay pending.

## Decisions (to record in a new ADR, amending ADR-0077 and ADR-0078)

- **The model is `Xenova/multilingual-e5-small`,** pinned by revision, with a
  SHA-256 and size for the ONNX file (quantized, if quality holds in the
  benchmark) and the tokenizer files. It is MIT-licensed.
  - Mean pooling over `last_hidden_state` with the attention mask, then L2
    normalisation.
  - `"query: "` prefix for retrieval queries and turn memory ranking;
    `"passage: "` for chunks, captions and memories.
  - 512-token limit.
  - The tokenizer loads through `tokenizers` (already a dependency through
    `transformers`), so the image stays torch-free.
- **`EmbeddingProvider` becomes text-only.** `embed_image`, the image chunk and
  the `visual_ready` payload are removed. An image's only vector is its caption's.
- **Vectors are keyed by model.** The tables become `knowledge_chunks__<model-key>`
  and `memory_vectors__<model-key>` (the key names the model and dimension).
  `embedding_dimension` comes from the model manifest, not configuration;
  `EMBEDDING_DIMENSION` is removed and listed in the release notes.
- **Upgrade re-embeds automatically.** At startup, a stored `embedding_model`
  label that differs from the code's model bumps the knowledge processing
  generation, which re-queues every file. Images keep their caption text and are
  re-embedded from it without captioning again. Memory vectors are rebuilt into
  the new table, as they already are on every start.
  - Old tables are dropped once the new generation is complete.
  - Search keeps using the old generation until the new one is ready, as with
    today's processing changes.
  - The relational change (the label, plus a stored caption text if it is not
    already kept) ships as an Alembic data migration with an upgrade test.
- **Say it where admins decide.** The captioning pane states: "Images are found
  in search only by their caption. With captioning off, images are stored and
  can be attached to chats, but search will not find them." The mode picker
  shows the same line next to Disabled. The status view counts uncaptioned
  images.

## User stories

Suggested order: US-99.1 → 99.2 → 99.3 → 99.4.

### US-99.1: The e5 provider

Done 2026-11-24, unwired: CLIP keeps serving search until US-99.2 switches the
tables, because the two models' vectors differ in size.

- [x] Write the ADR ([ADR-0079](../adr/0079-multilingual-text-embeddings.md)).
- [x] Add a pinned e5 bundle: a `PinnedModel` with files, hashes and sizes
      (`knowledge/e5_embedding.py`). The models directory `knowledge-e5-small`
      and moving the old `knowledge-clip` directory away come with the switch, in
      US-99.2.
- [x] Implement a text-only `EmbeddingProvider` with pooling, prefixes and
      truncation (`OnnxE5EmbeddingProvider`, `embed_query` and `embed_passage`;
      `tokenizers` is now a direct dependency).
- [x] Update `scripts/benchmark_knowledge_embeddings.py` and record quality and
      speed against CLIP on English and non-English samples in the ADR. Choose
      quantized or full precision from that: quantized (e5 top-1 1.00 across 5
      languages, CLIP 0.75).
- [x] Tests: prefixes, masked pooling, dimensions, refusals for bad bundles and
      shapes, and the pins (`tests/test_e5_embedding.py`). The image stays
      torch-free: no new package, checked by `pnpm check:image` in CI.

### US-99.2: Model-keyed vectors and re-embedding on upgrade

- [x] Switch to the e5 provider: download it into `models/knowledge-e5-small`,
      remove the old `knowledge-clip` directory, and split callers into
      `embed_query` and `embed_passage`.
- [x] Add model-keyed table names for knowledge chunks and memory vectors, with
      the dimension taken from the manifest.
- [x] A startup comparison of the stored model with the code's model triggers a
      new processing generation. Images re-embed from the stored caption.
- [x] Drop the old tables once the new generation is complete. Done on start
      instead: the old vectors can't answer the new model's queries, so a file
      isn't found until it is re-embedded (ADR-0079, release notes).
- [x] Alembic data migration plus an upgrade test seeded with CLIP-era files,
      captions and memories: after the upgrade, search finds the same files and
      memories.
- [x] Remove `embed_image`, image chunks and `visual_ready`, and update
      retrieval and similar files.

### US-99.3: Captioning is required for image search

- [x] Add the captioning pane copy, the mode picker line, and a count of
      uncaptioned images in status. The count is in the captioning pane, from
      `GET /settings/app/image-search/status`.
- [x] When captioning is turned on, images that are already stored get captioned
      (check that this already happens through the generation change; add it if
      not). It does: a captioning change queues every file
      (`test_knowledge_processing.py`), and an image's new generation asks for
      a caption unless the current captioner already made one.
- [x] Unit tests for the copy and the count.

### US-99.4: Docs and release notes

- [ ] Update:
  - `docs/architecture/knowledge-retrieval.md` and `overview.md`
  - `data-and-storage.md`
  - `docs/deployment.md` (first-start download and its size)
  - `docs/terminology.md`, `docs/guide/glossary.md`
  - `docs/guide/08-for-administrators/policies.md`
  - `docs/guide/03-files-and-projects/the-files-library.md` (images need captions
    to be found)
  - the help pages (`help/pages.ts:162,1080`)
  - ADR-0077 and ADR-0078
- [ ] Release notes:
  - Data: every file is re-embedded on upgrade, and memories are rebuilt.
  - Configuration: `EMBEDDING_DIMENSION` is removed.
  - Behavior: multilingual search; images are found only by caption.

## Settled questions

1. **Captioning stays off by default** (decided 2026-11-24). The setup
   walkthrough (EPIC-101) offers it, with clear text that images can't be found
   in search while captioning is off.

## Open questions

1. Should the larger chunk window that e5's 512 tokens allows change the chunk
   size? The proposal is to keep 1,000 characters and revisit after the
   benchmark.
