# EPIC-22 — Configuration-Owned Knowledge Processing

## Goal

Replace the singleton `KnowledgeCaptionConfigurationModel` and
`KnowledgeProcessingProfileModel` tables with one validated application setting
that defines the platform-wide knowledge-processing policy. A changed extraction,
chunking, embedding, caption mode, or selected caption provider model must create
a new generation and queue the eligible file library.

**Status: Planned — no user story has started; the epic covers the complete knowledge-processing policy.**

## Product decisions

- Captioning is one platform-wide setting, not a user, file, or knowledge-base
  choice.
- The persisted application-settings key is `knowledge.processing`. Its value is
  a versioned JSON object containing `generation`, extraction/chunking/embedding
  policy identifiers, and nested captioning `mode` (`disabled`, `local`, or
  `provider`) with `provider_model_id` required only for `provider`. An absent
  setting resolves to the deterministic disabled default.
- Typed processing and captioning API contracts remain separate where that helps
  the UI, but they are projections of one domain configuration. Validation,
  normalization, fingerprint calculation, and transitions live in a dedicated
  domain service; `ApplicationSettingsModel` remains a generic JSON store and
  must not be treated as a schema-free public API.
- A meaningful configuration change is applied atomically with a generation
  transition. The resolved policy fingerprint is copied into each artifact, so
  every artifact remains self-describing even after current settings change.
- The pinned local ONNX embedding bundle is a required normal-install feature.
  When it is missing or fails verification, Asterism automatically provisions it
  in bounded background work; users and administrators do not need to download,
  copy, or configure model files manually. The UI reports progress and failures.
  Download remains restricted to the reviewed model revision and an explicit
  allowlist of required files; inference never enables remote code.
- Provider/model removal must use explicit business logic rather than relying on
  a database foreign key. The removal workflow must either reject removal while
  the model is selected or atomically disable captioning and transition the
  processing profile. Select and document one behavior before implementation.
- This is pre-release greenfield work. Remove both singleton tables, models, and
  migration references; do not add a legacy compatibility path or data
  migration. Fresh initialization and development reset must be deterministic.
- Knowledge lifecycle state remains visible on file artifacts and through safe
  structured logs, but the unbounded `KnowledgeAuditEventModel` event table is
  removed. This home-user application does not retain a separate persistent
  audit trail for each processing transition or search.

## Current-state replacement

Today `KnowledgeCaptionConfigurationModel` and
`KnowledgeProcessingProfileModel` are singleton relational tables. The first
stores caption mode and selected model; the second stores the current policy,
generation, and fingerprint. Neither table is a historical registry: artifacts
copy the relevant profile generation and identity instead of referencing it.
The tables therefore duplicate the application-settings role, and updating the
caption singleton does not update the processing profile or queue reprocessing.

This epic replaces both singletons with one `ApplicationSettingsModel` value and
a domain transition service. Artifacts retain their resolved generation and
fingerprint as immutable provenance, but current configuration has one home.

Today the embedding provider verifies an operator-provisioned ONNX bundle only
when embedding is first requested. A missing bundle makes the ingestion job fail,
even though the repository already has the nearby pattern needed to provision the
local SmolVLM2 caption bundle. This epic also makes the embedding bundle
available automatically and prevents an expected provisioning wait from becoming
a terminal file-processing failure.

## User stories

### US-22.1 — Store knowledge processing as a validated application setting

**As an administrator**, I want the complete knowledge-processing policy stored
as one validated application setting so that the platform has one configuration
boundary without singleton database tables.

**Dependencies:** None.

- [x] US-22.1-T1: Define the versioned `knowledge.processing` value contract,
      deterministic default, normalization, generation, fingerprint inputs, and
      safe malformed-setting recovery.
- [x] US-22.1-T2: Implement typed read/write and resolved-policy domain services
      backed by `ApplicationSettingsModel`; retain caption mode/provider-model
      validation against active vision-capable models.
- [x] US-22.1-T3: Move processing-profile and captioning routes/generated-client
      contracts to the service without exposing generic application-setting
      writes as a bypass for validation.
- [x] US-22.1-T4: Remove both singleton models, tables, initialization/migration
      references, and obsolete ORM dependencies.
- [x] US-22.1-T5: Add tests for missing/default, malformed, policy normalization,
      disabled/local/provider captioning, invalid model, inactive model, and
      unknown/non-vision model configurations; regenerate the Hey API client if
      the OpenAPI contract changes.
- [x] US-22.1-T6: Remove `KnowledgeAuditEventModel`, all event writes, schema
      migrations, and audit-only tests; retain artifact status and safe logs for
      diagnostics without a persistent per-search event row.

**Acceptance criteria**

- The database has no processing-profile or caption-configuration singleton table.
- A missing application setting resolves to one deterministic processing policy
  with captioning disabled.
- Only the typed processing service can persist a valid policy.

### US-22.2 — Transition and reprocess from one policy

**As an administrator**, I want every meaningful processing-policy change to
reprocess the library consistently so that current artifacts always identify the
exact policy that produced them.

**Dependencies:** US-22.1.

- [x] US-22.2-T1: Define one resolved policy representation and deterministic
      fingerprint, including extraction/chunking/embedding inputs plus
      disabled/local/provider captioning and selected model identity.
- [x] US-22.2-T2: Implement one transaction-oriented transition/reprocessing
      service used by every processing and captioning configuration update.
- [x] US-22.2-T3: Queue replacement file-artifact generations only after the
      configuration/profile transaction commits; preserve a ready prior
      generation when replacement work fails or is canceled.
- [x] US-22.2-T4: Select, implement, and document provider/model-removal
      behavior: reject removal while selected, or atomically disable captioning
      and transition the processing profile.
- [x] US-22.2-T5: Test no-op updates, mode changes, provider-model changes,
      local/disabled transitions, provider/model removal, queue failures,
      restart recovery, and old-generation retrieval isolation.

**Acceptance criteria**

- A meaningful processing policy change advances the generation and queues every
  eligible file once.
- The artifact profile identity accurately records the resolved policy.
- No stored configuration can reference a deleted or ineligible provider model.

**Provider/model removal behavior:** removal or an eligibility change is rejected
while the provider model is selected for captioning. The administrator must first
choose local or disabled captioning (which transitions the processing policy and
queues replacements) before removing the provider/model.

### US-22.3 — Provision the required embedding bundle automatically

**As a normal user**, I want Asterism to obtain its required reviewed embedding
model automatically so that uploading and searching files works without manual
model installation.

**Dependencies:** US-22.1, US-22.2.

- [x] US-22.3-T1: Define the reviewed embedding bundle manifest: pinned model
      ID/revision, exact required tokenizer/processor/ONNX files, expected ONNX
      size and SHA-256, and an explicit download allowlist.
- [x] US-22.3-T2: Implement an `EmbeddingModelDownloadService` with one active
      download, safe status/progress, retry/cancel, temporary staging, full
      integrity verification, and atomic promotion into
      `STORAGE_ROOT/models/knowledge-clip`.
- [x] US-22.3-T3: Have `initialize_knowledge_runtime()` detect a missing or
      invalid bundle and begin provisioning automatically without blocking app
      startup. Do not use `trust_remote_code` or download arbitrary artifacts.
- [x] US-22.3-T4: Coordinate `KnowledgeIngestionJobs` and
      `OnnxClipEmbeddingProvider` so files awaiting an embedding bundle remain
      recoverable/queued and are processed after readiness rather than being
      marked terminally failed for an expected provisioning wait.
- [x] US-22.3-T5: Add admin-readable status and diagnostics through typed API
      and UI, modeled on caption bundle status but without an end-user manual
      installation step. Expose only progress, reviewed identity, and safe
      errors—not model bytes, credentials, or file content.
- [x] US-22.3-T6: Test cold start/download, concurrent upload while downloading,
      cancellation/retry, restart recovery, corrupted/partial bundles, manifest
      verification, offline failure, and automatic processing after readiness.

**Acceptance criteria**

- A fresh normal installation automatically begins provisioning the reviewed
  embedding bundle when needed and does not require filesystem preparation.
- Only a fully verified bundle is promoted and used for embedding.
- Files uploaded during provisioning become searchable after the bundle is ready
  without manual retry, while genuine failures retain safe diagnostics.

### US-22.4 — Align administration, operations, and documentation

**As an administrator**, I want the settings UI and operational documentation to
describe one knowledge-processing configuration so that reprocessing behavior and
external-provider disclosure are predictable.

**Dependencies:** US-22.1, US-22.2, US-22.3.

- [x] US-22.4-T1: Update processing and captioning administration UI to display
      one policy, its resulting generation effect, and external-provider image
      disclosure before save.
- [x] US-22.4-T2: Add frontend integration coverage for disabled/local/provider
      selections, validation errors, profile transition feedback, and selected
      provider/model removal behavior.
- [x] US-22.4-T3: Update OpenAPI-generated client artifacts, architecture
      guides, root/app READMEs, and the terminology guide to remove singleton
      table references and explain the setting-to-profile transition.
- [x] US-22.4-T4: Run focused backend/frontend tests, database reset/init,
      generated-client checks, and relevant full quality gates.

**Acceptance criteria**

- The UI does not imply captioning can change independently of processing.
- The public and operational docs identify `knowledge.processing` as the
  canonical configuration store.
- Fresh initialization contains no obsolete singleton processing schema.

## Execution

Order: **US-22.1 → US-22.2 → US-22.3 → US-22.4**. Work on one story at a time. Create a
feature branch when starting each story. Regenerate the Hey API client after any
OpenAPI change; run focused and full relevant quality gates; request user
confirmation before merging each completed story.
