# ADR-0079 — Multilingual text embeddings; images found by caption

Status: accepted. The provider, its pinned bundle and the benchmark are
implemented for US-99.1 (2026-11-24); switching search and memory to it, and
re-embedding on upgrade, is US-99.2
([EPIC-99](../epics/EPIC-99-MULTILINGUAL-E5-EMBEDDINGS.md)). Amends
[ADR-0077](0077-torch-free-default-image.md) (the search embedding) and
[ADR-0078](0078-long-term-memory.md) (memory vectors).

## Context

Knowledge search, similar files and memory ranking all use one CLIP model,
`Xenova/clip-vit-base-patch32` (quantized ONNX, 153 MB, 512 dimensions), for text
and images alike:

- **It reads 77 tokens.** Chunks are 1,000 characters, so most of each chunk is
  never embedded. Text goes through CLIP's joint text-and-image graph with a blank
  image.
- **It is an English model.** Asterism is used by schools whose files, questions
  and memories are not all in English.
- **Images get two vectors:** the CLIP image vector, and the caption's text
  vector. An image is searchable only once it has a caption
  (`artifact.searchable`), but the image vector then also joins text searches and
  similar files.

## Decision: multilingual-e5-small for all text

**Every knowledge and memory vector comes from `Xenova/multilingual-e5-small`**,
the ONNX export of `intfloat/multilingual-e5-small` (MIT licence). It is
implemented in `OnnxE5EmbeddingProvider` (`knowledge/e5_embedding.py`):

- **Pinned bundle.** Revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`
  (2025-07-22). Every file is pinned by SHA-256 (`PinnedModel.files`), as the
  captioning bundle is (ADR-0077): `onnx/model_quantized.onnx` (118 MB),
  `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json` and
  `config.json`, 135 MB in all.
- **No PyTorch, no `transformers`.** The tokenizer is `tokenizers.Tokenizer` from
  `tokenizer.json`, padded with `<pad>` and truncated at 512 tokens. Inference is
  ONNX Runtime on the CPU.
- **Pooling.** The vector is the attention-masked mean of `last_hidden_state`,
  L2-normalised, 384 dimensions. A dot product is the cosine similarity.
- **Prefixes.** e5 is trained with role prefixes, and the provider adds them:
  `"query: "` for the retrieval query and for ranking memories against a turn;
  `"passage: "` for file chunks, captions and memory text. Callers say which they
  are embedding (`embed_query`, `embed_passage`), never the prefix.
- **Quantized, not full precision.** The full-precision export is 470 MB. The
  quantized one scored perfectly on the benchmark below, so it is the one
  pinned.

## Decision: an image is found by its caption

The provider has no `embed_image`. An image's only vector is its caption's, as a
passage. **Captioning is therefore required for an image to be found** by search
or similar files, and the Image captioning settings say so. Images without a
caption are stored, previewed and attachable as before.

## Decision: vectors are keyed by model

The LanceDB tables are named for the model and vector size
(`knowledge_chunks__e5-small-384`, `memory_vectors__e5-small-384`), not reused
across models. Changing the model makes new tables and leaves the old ones to
be dropped, rather than writing 384-dimension vectors into a 512-dimension
table. Upgrading re-embeds every file as a new knowledge processing generation,
from text and stored captions, without captioning again; memory vectors are
rebuilt from the rows, as on every start (ADR-0078). US-99.2 implements this.

## Comparison

`apps/backend/scripts/benchmark_knowledge_embeddings.py` ranks 12 passages in
English, Spanish, French, German and Chinese for 12 queries, 6 of them in
another language from their best passage. On an Apple M-series CPU
(2026-11-24):

| Model                            | Top-1 | MRR  | Top-1 across languages | Embed all 24 texts |
| -------------------------------- | ----- | ---- | ---------------------- | ------------------ |
| multilingual-e5-small, quantized | 1.00  | 1.00 | 1.00                   | 0.04 s             |
| clip-vit-base-patch32, quantized | 0.75  | 0.86 | 0.58                   | 0.20 s             |

"Across languages" counts the best passage in a language other than the
query's. The corpus is small and only a smoke test of the choice; the script
fails if e5 ranks fewer than three in four queries' topic first.

## Consequences

- Text search reads up to 512 tokens of each chunk, and works across languages.
- Images are found only through captions. Installations with captioning off
  find no images, which is now said in the settings and the guide.
- The download on first start is 135 MB instead of 153 MB, under
  `models/knowledge-e5-small`.
- An upgrade re-embeds every file, which takes time on a large library; search
  keeps using the previous generation until the new one is ready.
- Chunk size stays at 1,000 characters for now (EPIC-99, open question 2).
