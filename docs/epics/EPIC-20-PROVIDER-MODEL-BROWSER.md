# EPIC-20 — Provider Model Browser

## Goal

Keep Admin Settings responsive when one provider exposes a very large model
catalog. Provider configuration must load without model rows; models are
searched and fetched in bounded pages only when an administrator opens a
provider's catalog.

## US-20.1 — Browse large provider model catalogs without blocking settings

**As an administrator**, I want to search and edit a provider's model catalog
in small pages so that a large provider does not block the Providers tab.

- [ ] Return provider summaries, model counts, and current draft-model display
      data from the provider-settings contract without eagerly loading models.
- [ ] Add an admin-authorized, bounded, stable paginated provider-model search
      endpoint and a focused model-update endpoint.
- [ ] Preserve provider create/update/delete and draft-model behavior without
      deleting models that are not in the current page.
- [ ] Load a provider's model browser only on expansion; provide debounced
      search, page navigation, model activation, capability editing, and draft
      selection.
- [ ] Regenerate the Hey API client and add large-catalog, authorization,
      pagination, update, and UI regression coverage.

**Acceptance criteria**

- Opening Providers transfers and renders provider summaries only, independent
  of catalog size.
- A catalog request returns at most 50 matching models, supports search, and
  has a deterministic next page.
- Editing one model does not require submitting or deleting unseen models.
- Captioning continues to receive its eligible vision-model choices through a
  focused contract.
- Provider and model mutations invalidate only the affected views and preserve
  default/draft-model validity.

## Verification

- Focused backend provider-settings tests: 16 passed.
- Frontend typecheck and lint passed.
- Frontend unit tests: 68 passed.
- Focused Playwright scenario passed: a mocked 1,000-model provider renders no
  model search/control DOM until its catalog is opened, then requests and
  displays only the first 50-model page.

**Status: Implemented and verified; awaiting user confirmation before merge.**
