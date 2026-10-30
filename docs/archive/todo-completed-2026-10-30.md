# Completed checklist — 2026-10-30

The user confirmed US-46.3 completion and authorized a local merge on
2026-10-30. EPIC-46 (US-46.1 through US-46.3) is complete; each story was
confirmed and merged with `--no-ff` before the next began. US-46.3 does not
show a thinking capability: models carry no thinking/reasoning capability data.

### [EPIC-46: Settings and admin visual coherence](../epics/EPIC-46-SETTINGS-AND-ADMIN-VISUAL-COHERENCE.md)

- [x] US-46.1: Settings hierarchy
  - [x] Add a settings section primitive; migrate the user and admin panes; test the sticky save bar's dirty state.

- [x] US-46.2: Theme gallery
  - [x] Build the preview tile from the theme variables; replace the selector; test selection, keyboard use and admin-only editing.

- [x] US-46.3: Provider and model identity
  - [x] Add a provider icon map (monochrome, theme-aware) and capability badges; test the labels for accessibility.

The user confirmed EPIC-47 completion and authorized a local merge on
2026-10-30. EPIC-47 (US-47.1 through US-47.4) is complete; the stacked story
branches were merged into `main` in order with `--no-ff`. GitHub CI had not yet
run on these changes at merge time.

### [EPIC-47: Quality baseline cleanup](../epics/EPIC-47-QUALITY-BASELINE-CLEANUP.md)

- [x] US-47.1: Format gate
  - [x] Format the existing drift; add backend and frontend `format:check` scripts and a root script; run it in CI.

- [x] US-47.2: Unit test baseline
  - [x] Triage and fix the failing frontend unit test(s); confirm the backend suite stays green.

- [x] US-47.3: Browser test baseline
  - [x] Run the full isolated suite; triage and fix each failing spec.

- [x] US-47.4: Deterministic local browser runs
  - [x] Find the source of the cold-start failures; warm or otherwise stabilize the server before specs; verify with repeated runs.
