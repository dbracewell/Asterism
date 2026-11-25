# Completed checklist: 2026-11-24

## Admin, study and setup epics

EPIC-96 through EPIC-101 are complete: every story was confirmed and merged on 2026-11-24 through pull requests #84 to #106, in the order 96 → 97 → 99 → 98 → 100 → 101. Along the way US-101.4 fixed a damaged image upload showing as ready since EPIC-99.

Source: user request (2026-11-24). Suggested order: EPIC-96 → 97 → 99 → 98 → 100 → 101. EPIC-97 depends on EPIC-96; EPIC-101 builds on EPIC-97, 99 and 100. Work one story at a time.

### [EPIC-96: Admin policy changes show up without a reload](../epics/EPIC-96-LIVE-POLICY-AVAILABILITY.md)

- [x] US-96.1: One availability query (merged 2026-11-24, PR #84)
  - [x] Add `GET /availability`, built from the existing policy checks with no new policy logic. Tests: each feature's available and unavailable reasons, group-limited policies, and owner-only access. Regenerate the client.
  - [x] Add a frontend `useFeature()` hook over the generated query (`staleTime` 30s, refetch on focus).
  - [x] Move `memory_allowed` and `canvas_allowed` readers (`memory-sections.tsx`, `general-settings.tsx`, `chat-session.tsx`) to the hook. Remove those fields from `GET /settings/user`, since the frontend and backend ship together.
  - [x] Unit tests: the memory checkbox enables after the availability query is invalidated, without a new `UserProvider` value.
- [x] US-96.2: Admin saves invalidate what depends on them (merged 2026-11-24, PR #85)
  - [x] Give every admin settings mutation (memory, canvas, skills, ChatGPT plans, image generation policy and provider, tools, groups, providers and models, captioning) `meta.invalidates` that includes the availability key and the keys of the user-facing queries it affects, such as `toolsGetActiveOptions` and `skillAvailabilityOptions`. Or leave it on global invalidation where that is deliberate.
  - [x] Remove the dead `userSettingsGetQueryKey` invalidation.
  - [x] A test lists the admin settings mutations and fails if one neither reaches the availability query nor uses global invalidation.
- [x] US-96.3: End-to-end check (merged 2026-11-24, PR #86)
  - [x] Playwright: an admin turns memory on, switches to User Settings → Your Asterism, and can tick "Use memory" without a reload. Repeat for canvas. The tool allowlist is covered by `admin-invalidation.test.ts`, which checks that its save refreshes the agent form's tool picker.
  - [x] Playwright: a second user's tab shows the change after it regains focus.
  - [x] Update `docs/architecture` where the user context is described, and add a Behavior line in the release notes.

### [EPIC-97: Hide what the admin has not enabled](../epics/EPIC-97-HIDE-DISABLED-FEATURES.md)

Complete (2026-11-24); archive with EPIC-96.

- [x] US-97.1: Settings navigation built from availability (merged 2026-11-24, PR #87)
  - [x] Build the User Settings section list from `useFeature()`. Skills and ChatGPT plans are left out when unavailable.
  - [x] Remove the code execution placeholder from Admin Settings.
  - [x] Memory and canvas toggles: hidden when unavailable, with the kept-data line where the user has saved items.
  - [x] Unit tests per feature, on and off.
- [x] US-97.2: Chat and composer (merged 2026-11-24, PR #88)
  - [x] "+" menu: hide Skills when skills are unavailable. Image generation already works this way.
  - [x] `/` discovery: show nothing (no "disabled by an administrator" list) when skills are off.
  - [x] Canvas: no create affordance when unavailable. Existing canvases open read-only.
  - [x] Tests for each, including a group-limited policy.
- [x] US-97.3: Projects, agents and classes (merged 2026-11-24, PR #89)
  - [x] Hide the project Sub-agents tab, Agents → Sub-agents and the General sub-agents card when delegation is unavailable, unless the user has definitions, in which case use the kept-data line.
  - [x] Hide the project memory section and the class memory switch when memory is unavailable.
  - [x] Hide the sub-agent skills picker when skills are off.
  - [x] Tests.
- [x] US-97.4: Help, tour and verification (merged 2026-11-24, PR #90)
  - [x] Add a `feature` key to help topics and tour steps. Filter by availability, and replace `needsSkills`.
  - [x] Playwright: with every policy off, a student sees no memory, canvas, skills, sub-agent, image or ChatGPT entry points. With each turned on, the entry point appears without a reload (EPIC-96).
  - [x] Update the user guide where it says features "start off", and refresh the screenshots (`pnpm docs:check`). Add a Behavior line to the release notes.

### [EPIC-98: Decks and quizzes from chat](../epics/EPIC-98-STUDY-TOOLS-IN-CHAT.md)

Decided 2026-11-24: admin switch (on by default, by group), class switch (on by default), no edits to existing decks.

Complete (2026-11-24) once US-98.5 merges.

- [x] US-98.1: Policy, class switch and ADR (merged 2026-11-24, PR #95)
  - [x] Write the ADR (gate, propose-then-save, provenance) and amend the `areas.py` docstring, ADR-0065 and CLAUDE.md §2.4.
  - [x] Admin `study_chat` policy (`{enabled, group_ids}`, default on), its admin endpoints and Admin Settings section, and `study_chat` in `GET /availability`.
  - [x] Class switch `study_chat_enabled` (default on) on the class mode policy, with a migration and an upgrade test, and the switch in the class page.
  - [x] Settings export covers the admin policy (EPIC-100's registry, or the current export until then).
  - [x] Tests: defaults, group limits, the class switch, availability.
- [x] US-98.2: Draft storage (merged 2026-11-24, PR #96)
  - [x] Add a `study_proposals` table: owner, project, chat, message, execution, kind, payload, status. Ship it with an Alembic migration, an upgrade test from the previous revision, and Download my data coverage.
  - [x] Add `origin="chat"` and proposal provenance columns on decks and quizzes, as a migration.
- [x] US-98.3: The tools (merged 2026-11-24, PR #97)
  - [x] Add `propose_deck` and `propose_quiz` in `domains/tools/builtin/`, with their constants in `tools/catalog.py` (internal, policy-gated), a gate `_offers_study`, a branch in `require_internal_tool`, and prompt guidance.
  - [x] Tests:
    - offered only when the project, the Study area, the admin and class switches and model tools all line up;
    - never offered to sub-agents or in General chats;
    - re-checked at execution time;
    - payload validation and caps;
    - one proposal per tool per run.
- [x] US-98.4: Review and save in chat (merged 2026-11-24, PR #98)
  - [x] Save and dismiss endpoints: owner-only; recheck the project, the Study area, the switches and file membership; the save is idempotent. Regenerate the client.
  - [x] Frontend `StudyProposalCards` in `message-item.tsx`: preview, edit before saving, Save to Study (with a link to the new deck or quiz), Dismiss, and timeline labels in `agent-timeline.ts`.
  - [x] Unit tests and a Playwright test: ask for a deck in a project chat, then save it and see it under Study.
- [x] US-98.5: Docs (merged 2026-11-24, PR #99)
  - [x] Hide the mention of the tools in help when unavailable (EPIC-97).
  - [x] Update `docs/architecture/study-tools.md`, the user guide pages (`05-studying/flashcards.md`, `practice-quizzes.md`), the educator and admin guide pages for the two switches, and the release notes.

### [EPIC-99: Multilingual text embeddings, images found by caption](../epics/EPIC-99-MULTILINGUAL-E5-EMBEDDINGS.md)

Complete (2026-11-24) once US-99.4 merges; archive with EPIC-96 and EPIC-97.

- [x] US-99.1: The e5 provider (merged 2026-11-24, PR #91)
  - [x] Write the ADR.
  - [x] Add a pinned e5 bundle: a `PinnedModel` with files, hashes and sizes, and the models directory `knowledge-e5-small`, migrating the old `knowledge-clip` directory away.
  - [x] Implement a text-only `EmbeddingProvider` with pooling, prefixes and truncation.
  - [x] Update `scripts/benchmark_knowledge_embeddings.py` and record quality and speed against CLIP on English and non-English samples in the ADR. Choose quantized or full precision from that.
  - [x] Tests: download verification, dimensions, prefixes, truncation, and that the image stays torch-free (`pnpm check:image`).
- [x] US-99.2: Model-keyed vectors and re-embedding on upgrade (merged 2026-11-24, PR #92)
  - [x] Switch to the e5 provider: download it into `models/knowledge-e5-small`, remove the old `knowledge-clip` directory, and split callers into `embed_query` and `embed_passage`.
  - [x] Add model-keyed table names for knowledge chunks and memory vectors, with the dimension taken from the manifest.
  - [x] A startup comparison of the stored model with the code's model triggers a new processing generation. Images re-embed from the stored caption.
  - [x] Drop the old tables once the new generation is complete.
  - [x] Alembic data migration plus an upgrade test seeded with CLIP-era files, captions and memories: after the upgrade, search finds the same files and memories.
  - [x] Remove `embed_image`, image chunks and `visual_ready`, and update retrieval and similar files.
- [x] US-99.3: Captioning is required for image search (merged 2026-11-24, PR #93)
  - [x] Add the captioning pane copy, the mode picker line, and a count of uncaptioned images in status.
  - [x] When captioning is turned on, images that are already stored get captioned (check that this already happens through the generation change; add it if not).
  - [x] Unit tests for the copy and the count.
- [x] US-99.4: Docs and release notes (merged 2026-11-24, PR #94)
  - [x] Update:
    - `docs/architecture/knowledge-retrieval.md` and `overview.md`
    - `data-and-storage.md`
    - `docs/deployment.md` (first-start download and its size)
    - `docs/terminology.md`, `docs/guide/glossary.md`
    - `docs/guide/08-for-administrators/policies.md`
    - `docs/guide/03-files-and-projects/the-files-library.md` (images need captions to be found)
    - the help pages (`help/pages.ts:162,1080`)
    - ADR-0077 and ADR-0078
  - [x] Release notes:
    - Data: every file is re-embedded on upgrade, and memories are rebuilt.
    - Configuration: `EMBEDDING_DIMENSION` is removed.
    - Behavior: multilingual search; images are found only by caption.

### [EPIC-100: The settings export covers all of Admin Settings](../epics/EPIC-100-COMPLETE-SETTINGS-EXPORT.md)

- [x] US-100.1: Coverage registry and test (merged 2026-11-24, PR #100)
  - [x] Add the section registry (backend) and a test that fails on any stored admin setting not marked exported or excluded. It would fail today on `usage_timezone`, group budgets, memory and image groups, licenses and themes.
  - [x] Add an ADR-0052 addendum for v2 and the registry.
- [x] US-100.2: Export and import what is missing (merged 2026-11-24, PR #101)
  - [x] Export and import `usage_timezone`, group budgets, memory and image generation groups by name, accepted ONNX licenses, and themes, as `format_version: 2`. v1 files still import.
  - [x] Preview lists every section and what will change, including groups to be created.
  - [x] Tests:
    - round trip into an empty installation and into one with differently numbered groups;
    - a v1 file imports;
    - wrong passphrase;
    - a theme that fails validation is refused with the rest of the import.
- [x] US-100.3: Frontend and docs (merged 2026-11-24, PR #102)
  - [x] The Export pane lists what is and isn't included, generated from the registry so it stays accurate.
  - [x] Update `docs/guide/08-for-administrators` (export and import) and `docs/deployment.md`, and add release notes (Data: export format 2; Behavior: what is now included).

### [EPIC-101: Guided install and setup](../epics/EPIC-101-GUIDED-INSTALL.md)

- [x] US-101.1: Setup command (merged 2026-11-24, PR #103)
  - [x] Add an entrypoint `setup` command and `pnpm configure`. Both are interactive and use the config contract to generate secrets and write `.env`. A non-interactive mode takes flags or environment variables, for scripts.
  - [x] Tests: the written file passes `pnpm config:check`; no overwrite without `--force`; secrets have the required length.
  - [x] Rewrite the README quick start and `docs/deployment.md` §2 around it, and keep the manual path as a reference.
- [x] US-101.2: Setup walkthrough frame (merged 2026-11-24, PR #104)
  - [x] Store setup progress server-side (`setup_progress` in app settings: step states and timestamps), with an Alembic migration if a table is needed, and export it per EPIC-100's registry (or mark it excluded).
  - [x] Build the step frame from the section registry: explanation, embedded section, Skip and Next, and resume where the admin left off.
  - [x] Fold the existing provider, import and default-model steps (EPIC-48) into it.
  - [x] Unit tests and Playwright: a fresh install goes through every step, skips some, and resumes after a reload.
- [x] US-101.3: Explanations and summary (merged 2026-11-24, PR #105)
  - [x] Write each step's explanation: what it does, its default, what users see when it is off, and a link to the guide page.
  - [x] Add the summary page and Admin Settings → Setup.
  - [x] Add the first backup step: explain `SYSTEM_KEY`, run or show the backup command, and record that the step was done.
- [x] US-101.4: Docs (merged 2026-11-24, PR #106)
  - [x] Rewrite `docs/guide/08-for-administrators/first-time-setup.md` around the walkthrough, with refreshed screenshots (`pnpm docs:check`), and update `docs/deployment.md` §5.
  - [x] Release notes: Behavior (setup walkthrough); Image (the `setup` command).

## Maintenance follow-ups (2026-11-21)

Completed items from the maintenance list; the base image update for `zlib1g` stays open in the live checklist.

- [x] Fix the flaky class E2E test: `apps/frontend/e2e/classes.spec.ts:84` sometimes fails with "Run by …" not visible, and passes on a rerun (seen on 2026-11-21). Find what the assertion races and wait on that instead.
- [x] Move provider discovery off openai's legacy httpx client. openai 3 uses httpx2 by default, and `apps/backend/asterism/domains/settings/discovery.py` still passes an `httpx.AsyncClient`, which openai accepts only through a temporary legacy path. Port the response-size limit (`_SizeLimitedStream`, the `response` event hook) and the no-redirects setting to httpx2, with tests, before openai removes that path.

## Setup walkthrough follow-ups

EPIC-102 is complete: every story was confirmed and merged on 2026-11-24 through pull requests #109, #110, #111 and #113, in the order US-102.1 → 102.2 → 102.3 → 102.4.

Source: user review of the EPIC-101 install flow (2026-11-24). See [EPIC-102](../epics/EPIC-102-SETUP-WALKTHROUGH-FOLLOW-UPS.md). Suggested order: US-102.1 → 102.2 → 102.3 → 102.4. Work one story at a time.

### [EPIC-102: Setup walkthrough follow-ups](../epics/EPIC-102-SETUP-WALKTHROUGH-FOLLOW-UPS.md)

#### US-102.1: Remove theme, educators and first backup from setup

- [x] Remove `theme_editor`, `educators` and `backup` from `SETUP_STEPS`; list the first two in `NOT_STEPS` with reasons.
- [x] Delete `SetupBackupStep`, the `standalone` and `guideHref` fields, and the backup branch; update `lazy-sections.test.tsx`.
- [x] Test that stored progress with the removed ids still counts 12 steps and summarises correctly.
- [x] Update `e2e/setup-walkthrough.spec.ts`.

#### US-102.2: First-run checklist shows the rest of setup

- [x] Four-step `SetupSteps` with "Review the remaining settings (optional)" third; the ready card marks step 3 current.
- [x] Build step 3's description and the ready card's list from `SETUP_STEPS`.
- [x] Unit tests per card; update `first-run-setup.spec.ts` and `provider-setup.spec.ts`.

#### US-102.3: Next saves, Skip discards

- [x] Add the setup draft context and `useSetupDraft` (no-op outside the walkthrough).
- [x] Register drafts in every pane that has one, including captioning's unsaveable provider-without-model case.
- [x] Walkthrough: Save and continue / Next, failed save keeps the step, blocked reason, discard prompt on Skip and step-list navigation, "Reviewed" chip, drop the old hint.
- [x] Unit tests and Playwright (time zone saved by Save and continue; Skills toggle discarded by Skip).

#### US-102.4: Docs and release notes

- [x] Update `first-time-setup.md` with refreshed screenshots (`pnpm docs:check`) and `docs/deployment.md` §5 if needed.
- [x] Release notes (Behavior).
