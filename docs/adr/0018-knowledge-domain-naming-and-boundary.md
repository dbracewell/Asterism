# ADR-0018: Knowledge domain naming and boundary

- **Status:** Accepted; naming and boundary fixed 2026-10-21 by US-38.1
- **Original decision date:** 2026-10-21
- **Decision owners:** Asterism maintainers
- **Scope:** [Knowledge pipeline structure](../epics/EPIC-38-KNOWLEDGE-PIPELINE-STRUCTURE.md)

## Context

The knowledge pipeline was split across three domains. `files/processing.py` owned
the processing-policy transitions, `settings/knowledge.py` owned the policy's
persistence, and `domains/extraction/` owned the artifacts, ingestion, embeddings,
captioning, and vectors. `settings` imported `files` and `files` imported
`settings`, so the cycle was closed by deferring imports and by reaching into
another module's private functions.

The domain was also named for one of its facets. The package was `extraction` and
the table was `file_extractions`, but a single artifact holds a text extraction, an
embedding projection, and a generated caption. The product, the configuration keys,
the admin surface, and the documentation already called the whole thing
"knowledge".

The vocabulary was measured before the decision. Counting case-insensitive
occurrences across tracked source, test, script, and documentation files
(excluding build output and installed dependencies), the repository held roughly
2040 occurrences of "knowledge" and roughly 550 of "extraction". The existing
`knowledge` references are already correct: they name the config keys
(`knowledge.processing`, `KNOWLEDGE_*`), the admin surface, the storage root, and
the retrieval hits. The domain was the outlier.

## Decisions

### The domain is named `knowledge`

`asterism/domains/extraction/` becomes `asterism/domains/knowledge/`. The
artifact model is `FileKnowledgeArtifactModel` and its table is
`file_knowledge_artifacts`. The package gains an `__init__.py` that states its
ownership rule, matching every sibling domain.

"Knowledge" means the platform's derived, retrievable knowledge about a file. It
does not mean asserted facts, entities, or relations. No knowledge graph is
implemented and the name must not be read as promising one.

### Extraction is a facet, not the domain

The word "extraction" survives only where it names a single derived output of a
source file: the text-extraction policy (`extraction_policy`, `text-extraction-v1`),
the extracted text carried by the text-extraction output, and the extraction
stage named in a processing pipeline description. It no longer names a domain, a
package, a table, a model, or a configuration key.

The domain-named exception `ExtractionError` becomes `KnowledgeArtifactError`,
and the configuration field `max_concurrent_extractions` becomes
`max_concurrent_knowledge_jobs` with the environment variable
`MAX_CONCURRENT_KNOWLEDGE_JOBS`. The previous environment variable name is not
retained: this project is in active development, has no production users, and
does not preserve backwards compatibility.

### Target boundaries

```text
files        source files: bytes, metadata, converted text, the library API
   │  (files depends on knowledge; knowledge does not depend on files)
   ▼
knowledge    artifacts, extractions, ingestion, embedding, captioning,
             vectors, and the whole processing policy
   │
   ▼
settings     providers, models, generic application settings
```

`knowledge` owns the processing policy end to end — its schema, its persistence,
and its transitions — so no other domain has to import it. The knowledge admin
endpoints move to a knowledge router so `settings` no longer imports `knowledge`
either. The dependency direction becomes one-way.

This ADR fixes the naming and the boundary. The boundary is realized by the
remaining stories of
[EPIC-38](../epics/EPIC-38-KNOWLEDGE-PIPELINE-STRUCTURE.md): the processing
policy moves to the knowledge domain (US-38.2, complete), derived facets become
first-class rows (US-38.3), and the dependency direction becomes explicit
through a published artifact reader and an injected source reader (US-38.4).
Until US-38.4 lands, `knowledge` still reaches into `files` for source access;
that is a known, tracked boundary and not a regression.

### Rejected alternatives

**`common/`.** `asterism/common/` is a strict leaf layer: not one of its modules
imports anything from `asterism.*`. The knowledge pipeline owns ORM models,
routers, storage adapters, providers, and business rules, and already depends on
`db`, `core`, and other domains. Moving it into `common` would make `common` a
non-leaf and would not remove a single cycle.

**`file_processing` / `processing`.** Generic, and it names the operation rather
than the durable result. "Processing kind" for a caption is a category error: a
caption is an output, not a step.

**`derivation` / `analysis`.** More precise than "knowledge" and less readable,
for a larger rename with no user-visible gain.

**Renaming `knowledge` to `extraction` instead.** This is the opposite trade and
was rejected on measured cost: it is roughly a 2000-occurrence rename against
roughly 550 for the accepted direction, and the accepted direction is the one
whose existing references are already correct.

## Dependency direction and initialization

The renamed table is created by fresh initialization; there is no migration,
compatibility shim, or live-database reset. The artifact's unique
`(file_id, generation)` constraint and its partial unique current-generation
index are unchanged, and the index and constraint names already used the
`file_knowledge_artifacts` prefix.

The HTTP contract is unchanged by the rename. The API exposes the Pydantic schema
`FileKnowledgeArtifact`, which was already correctly named; the ORM model and
table name are not part of the OpenAPI document. The generated frontend client
therefore requires no regeneration.

US-38.2 keeps the same guarantee for the endpoints it moves. The knowledge
admin surfaces are served by the knowledge domain's router at their existing
URLs, operation ids, response shapes, and OpenAPI tag. The tag stays
`settings` because it names the public API resource group, which follows the
URL prefix; the owning module is an implementation detail that the OpenAPI
document does not publish. The only difference in the OpenAPI document is the
order in which the paths appear, because the knowledge router is registered
before the settings router so its more specific paths are matched first. The
generated client's content is therefore unchanged.

## Consequences and evidence

New work lands in `asterism/domains/knowledge/`, and the artifact vocabulary
("knowledge artifact", "artifact generation", "current artifact") is the only
one the product and the documentation use. A contributor who reaches for
"extraction" to mean the whole subsystem is naming a facet and will find the
facet's own row or field instead.

The rename is verified by the backend lint, type-check, and full test suite; by a
fresh database initialization that creates `file_knowledge_artifacts`; and by an
AST import-boundary test that keeps the knowledge package free of project, chat,
and model-registry imports. US-38.2 adds two more boundary tests: the settings
domain imports no knowledge module at any level, and the knowledge policy
modules import no files module. The current implementation is traced in
[file knowledge processing](../architecture/file-knowledge-processing.md),
[data model and storage](../architecture/data-and-storage.md), and
[knowledge retrieval](../architecture/knowledge-retrieval.md).

This ADR supersedes the "Extraction owns per-file generations" naming in
[ADR-0017](0017-project-file-and-chat-boundaries.md); that record's boundary
decisions are otherwise unchanged.
