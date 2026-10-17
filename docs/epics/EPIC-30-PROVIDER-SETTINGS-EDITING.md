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
