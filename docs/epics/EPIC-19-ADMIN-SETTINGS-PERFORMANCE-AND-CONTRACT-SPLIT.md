# EPIC-19 — Admin Settings Performance and Contract Split

## Goal

Make opening Admin Settings responsive by loading and mounting only the active
settings pane, then replace the broad application-settings read model with
small, ownership-safe admin read models. Each screen must receive all and only
the data it needs, while writes remain correct and cache invalidation stays
coherent.

**Status: In progress — US-19.1 through US-19.3 complete; US-19.4 next.**

## Product and architecture decisions

- An inactive settings pane must not mount, execute effects, subscribe, or
  issue data requests. Switching panes may mount the selected pane on demand.
- Admin Settings itself is mounted only when selected. The Admin tab trigger
  may prefetch the minimal data needed for its default pane on hover/focus;
  prefetch must not block navigation and must respect TanStack Query caching.
- Pane implementations are client-code-split with `next/dynamic` where that
  produces a measurable initial-JS improvement. The active pane retains an
  accessible loading and error state.
- The current `GET /settings/app` response is a transitional aggregate, not a
  long-term screen contract. Replace its frontend uses with resource-oriented,
  admin-authorized read contracts:
  - provider settings: providers (with their models) and draft-model selection;
  - tool settings: enabled-tool state and configured component selections;
  - captioning configuration/status remains its existing separate contract;
  - future panes own their data contracts instead of extending an aggregate.
- Read endpoints must use typed response schemas and explicit query loading
  plans. They must preserve current values, validation, admin authorization,
  provider/model association, and write semantics. No client derives a
  security-sensitive value by joining unrelated endpoint responses.
- Retain or remove the aggregate endpoint only after all consumers are
  migrated. If retained temporarily, document it as deprecated and verify it
  remains authorization-equivalent. Mutations return/invalidate the specific
  resource contract(s) they changed.

## User stories

### US-19.1 — Mount only the active settings pane (completed)

**As an administrator**, I want inactive settings screens not to do work so
that opening or switching settings is fast and does not generate unrelated
requests.

- [x] US-19.1-T1: Make the nested settings card select its current section and
      render only that pane; preserve deep links, default selection, browser
      URL updates, keyboard tab behavior, and user/admin tab isolation.
- [x] US-19.1-T2: Verify that hidden admin panes do not mount or execute their
      queries/effects; retain an explicit loading/error state for the selected
      pane.
- [x] US-19.1-T3: Add frontend tests covering default/deep-linked selection,
      pane switching, and the absence of inactive-pane requests/mounts.
- [x] US-19.1-T4: Profile the before/after request count and render work for a
      cold Admin Settings visit; record the result and run focused quality
      gates.

**Acceptance criteria**

- A cold visit mounts only one admin settings pane.
- Switching panes mounts the requested pane without remounting unrelated ones.
- Deep links continue to select the requested pane and URL state stays correct.

### US-19.2 — Defer the admin settings subtree and prefetch intentionally (completed)

**As an administrator**, I want the User Settings landing path to avoid admin
work while still making Admin Settings feel immediate when I select it.

**Dependencies:** US-19.1.

- [x] US-19.2-T1: Mount `AdminSettingsTab` only while the top-level admin tab is
      selected, including direct URL navigation and back/forward behavior.
- [x] US-19.2-T2: Optionally prefetch the default admin-pane data on Admin tab
      trigger hover/focus without rendering the subtree or issuing unrelated
      requests.
- [x] US-19.2-T3: Add tests for user/admin selection, direct links, cache reuse,
      and no admin request on a User Settings-only visit.
- [x] US-19.2-T4: Profile cold and warm navigation and document the chosen
      prefetch policy.

**Acceptance criteria**

- Visiting User Settings does not request or mount admin settings.
- A direct admin deep link loads the correct pane.
- Prefetch, if enabled, is non-blocking and never fetches every pane.

## Profiling evidence and prefetch policy

Measurements compare the `main` baseline with this branch in authenticated
Next.js development sessions, excluding shared shell/auth/folder/chat requests:

| Scenario | Baseline | Branch |
| --- | ---: | ---: |
| Cold direct Admin Settings application-settings reads | 1 | 1 |
| Nested admin `TabsContent` instances rendered | 9 | 1 |
| Cold User Settings admin application-settings reads | 1 | 0 |
| Completed hover prefetch reads | n/a | 1 |
| Additional application-settings reads on navigation after completed prefetch | n/a | 0 |

The Admin trigger prefetches only the default pane's current aggregate read on
pointer hover or keyboard focus. A 30-second freshness window lets immediate
navigation reuse that completed request without mounting the admin subtree or
prefetching every pane. Direct admin deep links still perform one required read.
Mutations continue to invalidate queries through the application QueryClient.

### US-19.3 — Code-split admin pane implementations (completed)

**As an administrator**, I want initial Admin Settings JavaScript limited to
what I am viewing so that heavy editors do not delay the default Providers
screen.

**Dependencies:** US-19.1 and US-19.2.

- [x] US-19.3-T1: Measure the settings route bundle and identify pane-only
      dependencies, including Theme Editor/color picker and tool configuration
      forms.
- [x] US-19.3-T2: Dynamically import selected admin panes with loading and
      error boundaries that preserve accessibility and deep-link behavior.
- [x] US-19.3-T3: Verify client/server boundaries and avoid changing theme or
      provider write behavior.
- [x] US-19.3-T4: Add regression coverage and record bundle/request metrics.

**Acceptance criteria**

- Default Admin Settings does not download code unique to unvisited heavy panes.
- A selected lazy pane has a clear loading/failure state and functions normally.

**Bundle and request evidence**

Production-build browser captures compare the post-US-19.2 baseline with this
story on a cold default Admin Settings visit:

| Metric | Baseline | Code-split |
| --- | ---: | ---: |
| Initial JavaScript chunks | 22 | 25 |
| Initial JavaScript transfer (uncompressed build bytes) | 1,431,483 | 1,378,142 |
| Application-settings reads | 1 | 1 |

Code splitting reduced initial JavaScript by 53,341 bytes (3.7%) despite the
expected increase in chunk count. The Theme Editor's `color` and
`react-colorful` implementation chunk (50,135 bytes) was absent from the
default Providers visit. Selecting Theme Editor loaded two chunks on demand,
including that implementation chunk, and displayed the editor normally.
Tool/component forms and every other non-selected pane likewise remain behind
their own dynamic import. Production build/type validation passed without
changing the pane implementation modules or their write paths.

### US-19.4 — Replace the aggregate application-settings read contract

**As an operator**, I want each admin pane to use a focused, correct backend
contract so that performance improvements do not lose settings or introduce
inconsistent writes.

**Dependencies:** US-19.1 through US-19.3.

- [ ] US-19.4-T1: Inventory all `GET /settings/app` consumers and each returned
      field; define typed resource read schemas, endpoint ownership,
      authorization, query loading plans, response-size expectations, and a
      deprecation/migration plan for the aggregate endpoint.
- [ ] US-19.4-T2: Implement focused provider-settings and tool-settings reads
      using explicit SQLAlchemy loading strategies, preserving provider/model
      associations, active tools, component selections, and admin-only access.
- [ ] US-19.4-T3: Align writes and TanStack Query invalidation with the resource
      contracts; ensure a successful mutation refreshes every affected view and
      no pane observes stale or partially assembled data.
- [ ] US-19.4-T4: Regenerate the Hey API client and migrate frontend consumers
      one resource at a time; remove the aggregate client use only after all
      consumers have equivalent replacements.
- [ ] US-19.4-T5: Add backend integration tests for authorization, empty/large
      provider/model sets, exact field/value preservation, association
      correctness, mutation/read round trips, and query-count bounds; add
      frontend integration tests for cache invalidation and error states.
- [ ] US-19.4-T6: Document endpoint contracts, aggregate-endpoint status, and
      measured payload/latency improvements; run full quality gates.

**Acceptance criteria**

- Every migrated pane receives a typed, admin-authorized contract containing
  exactly its required state.
- Provider/model and tool/component relationships are preserved across reads
  and writes.
- No frontend consumer depends on `GET /settings/app` once its replacement is
  available; removal occurs only after inventory-backed migration verification.

## Execution

Order: **US-19.1 → US-19.2 → US-19.3 → US-19.4**. Work on one story at a time.
Regenerate the Hey API client after every OpenAPI change. Each story requires
passing relevant quality gates and user confirmation before merge.
