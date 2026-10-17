# EPIC-30: Provider Settings Editing

## US-30.1: Responsive model controls and a shared Save action

As an administrator, I want all model controls to fit the settings panel and one Save action to apply my provider and model edits.

Acceptance criteria:

- Model activation, context window, vision, tool calls, and draft selection remain accessible in narrow panels, including inside a wide viewport.
- Expanding a model catalog sets `provider=<id>` through `useReadWriteSearchParams`, preserving all existing URL parameters.
- The bottom-right Save applies all staged edits across providers, catalog searches, pages, and collapsed catalogs; model rows have no separate Save button.
- Select All, Unselect All, and Set draft stage changes for Save. Catalog refresh saves staged edits before discovery.
- Invalid context windows prevent saving; failed requests retain drafts for retry and do not report success.
- Existing generated endpoints and shared mutation-cache invalidation remain in use. Saves are sequential and may partially persist on failure; retry reapplies retained edits.

Tasks:

- [x] Replace fixed-width model rows with a layout that wraps within its container.
- [x] Keep model drafts in the provider form and save all staged changes from the shared action.
- [x] Preserve capability provenance, validate context windows, and retain failed edits.
- [x] Verify provider regressions, lint, type checks, formatting, and responsive browser behavior.
- [x] Record the remaining agent-settings failures separately; the user authorized merging with these known failures on 2026-10-17.
- [x] Obtain user completion confirmation before commit and merge (2026-10-17).

Branch: `fix/provider-model-settings-save`.

## Verification (2026-10-17)

- Provider unit/integration regressions: 9 passed, including shared Save, page navigation, live-query refresh, retry, draft deactivation, and hidden-field validation.
- Provider Playwright regressions: 4 passed without retries, including a 390px viewport, a 640px settings panel inside a 1100px viewport, and preservation of existing URL parameters when expanding a catalog.
- Frontend lint and TypeScript: passed.
- Production frontend build: passed.
- Frontend migration checks: 6 passed using disposable storage.
- Changed-file Prettier and `git diff --check`: passed.
- Broader frontend unit run after the requested test-setup repair: 124 passed, 9 failed. Added TooltipProvider to both agent-settings wrappers and both custom-query-client render paths. Tooltip context errors are resolved. Remaining failures expose unnamed icon dialog triggers, obsolete Fixed model label/display assertions, and an unavailable-model alert assertion against the current icon-only status. The combined frontend test command still fails; migrations were run separately.
- No backend or API-contract changes; generated client remains unchanged. The working database was not reset.

The user confirmed the changes and authorized committing and merging everything into `main` on 2026-10-17. Provider implementation is complete; the broader frontend suite remains non-green with the nine documented agent-settings failures. These are deferred follow-up work, not passing checks. Completed checklist history is preserved in [the dated archive](../archive/todo-completed-2026-10-17.md).

## US-30.2: Repair agent-settings regressions

As a user, I want agent controls to remain accessible and saved model bindings to display accurately while catalogs load or fail.

Branch: `fix/agent-settings-regressions`.

Acceptance criteria:

- Main-agent and sub-agent icon controls expose accessible names. Model availability is conveyed with accessible status text.
- The model picker derives its label from the current selected ID and catalog, including asynchronous loading, unavailable bindings, and parent value changes. Catalog refresh never selects a replacement or invokes a selection callback.
- Model fields connect their label to the picker button; current UI labels and card layout are covered by meaningful assertions.
- Empty sub-agent lists expose one create action without nested duplicate form triggers.
- All nine previously failing tests and the full frontend suite pass, with browser checks for create/edit/delete, failure/retry, pagination, and narrow layouts.

Tasks:

- [x] Repair accessible controls, model-field labeling, and model availability status.
- [x] Make the shared model picker controlled and update both callers; preserve filtering and explicit selection.
- [x] Update agent-settings tests for current labels and add model-picker regressions.
- [x] Complete lint, type checks, formatting, frontend tests, build, and browser verification.
- [x] Obtain user completion confirmation before commit and merge (2026-10-17).

### US-30.2 verification (2026-10-17)

- All nine previously failing agent-settings tests pass without mocking the model picker or weakening binding/retry checks.
- Full frontend unit/integration suite: 135 tests passed across 35 files; no unhandled errors.
- Frontend migration checks: six passed using disposable databases.
- Focused Chromium: six passed without retries (two agent-settings scenarios and four provider scenarios). Agent checks cover create/edit/delete, persisted main settings, explicit worker models, unavailable bindings, query failure/retry, pagination, and desktop/mobile layouts.
- Frontend lint, TypeScript, changed-file formatting, production build, and diff integrity passed.
- The shared picker is now controlled through `value`; both agent and General settings callers were updated. Catalog loads and parent selection changes update the label without an effect or implicit selection; absent IDs remain visible as unavailable.
- Removed the duplicate create-form trigger in the empty sub-agent list, retaining the header create action. Availability icons now include accessible status text.
- Tests use current Model, Top P, and Seed labels, and assert the current card and pagination layout. Behavioral checks for fixed bindings, numeric validation, and retained edits remain intact.
- No backend/API changes, database reset, remote CI, or push. Earlier US-30.1 failure notes describe the pre-repair run; this follow-up resolves those nine failures.

Status: user-confirmed complete on 2026-10-17; authorized commit and local merge into `main`. Completed checklist history is preserved in [the dated archive](../archive/todo-completed-2026-10-17.md).
