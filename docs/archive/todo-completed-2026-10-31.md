# Completed checklist — 2026-10-31

The user confirmed US-49.4 completion and authorized a local merge on
2026-10-31. EPIC-49 (US-49.1 through US-49.4) is complete; each story was
confirmed and merged with `--no-ff` before the next began. All ChatGPT plan
behavior is verified against local OAuth, models and Responses doubles; no
live ChatGPT account was used. See ADR-0025.

### [EPIC-49: ChatGPT plan connection](../epics/EPIC-49-CHATGPT-PLAN-CONNECTION.md)

- [x] US-49.1: Responses API streaming adapter
  - [x] Add the Responses streaming client and event reducer behind the existing LLM interface.
  - [x] Add per-provider request capabilities for generation parameters and tool kinds.
  - [x] Test streaming, tool calls in the agent loop, interrupted and failed streams against a local double.

- [x] US-49.2: Per-user ChatGPT connection
  - [x] Add the admin policy (default disabled) and the encrypted per-user connection store.
  - [x] Implement registration, reauthorization, loopback callback, ID-token validation and disconnect.
  - [x] Implement serialized refresh with terminal-error handling; test ownership isolation, rotation and policy changes.
  - [x] Write the ADR (connection ownership, loopback limit, no fallback, preview constraints).

- [x] US-49.3: Plan models in the pickers
  - [x] Sync owner-scoped plan models and expose them through the chat model choices.
  - [x] Mark unavailable bindings without replacement; cover chats, sub-agents and project selections.
  - [x] Test owner isolation, provenance and availability changes.

- [x] US-49.4: Plan usage experience and limits
  - [x] Add the plan label, Manage usage link and first-use notice.
  - [x] Map usage-limit, unavailable and revoked errors to their recovery UI.
  - [x] Add unit and isolated browser tests with a local OAuth and Responses double.

The user confirmed US-50.1 on 2026-10-31. EPIC-50 (US-50.1) is complete:
without a usable draft model, chat titles run on the owner's own ChatGPT plan.

### [EPIC-50: ChatGPT plan chat titles](../epics/EPIC-50-CHATGPT-PLAN-CHAT-TITLES.md)

- [x] US-50.1: Plan fallback for chat titles
  - [x] Resolve the title model (draft first, then the owner's plan) in the chat domain.
  - [x] Test draft precedence, plan fallback and selection, other-user isolation, unavailable plans and the text fallback.
  - [x] Document the fallback in ADR-0025 and the provider docs.

The user confirmed US-51.7 completion and authorized a local merge on
2026-10-31. EPIC-51 (US-51.1 through US-51.7) is complete; each story was
confirmed and merged with `--no-ff` before the next began. US-51.7 depended
on US-54.4, which was pulled ahead of EPIC-52 and is tracked under EPIC-54.

### [EPIC-51: Prompt frameworks and templates](../epics/EPIC-51-PROMPT-FRAMEWORKS-AND-TEMPLATES.md)

- [x] US-51.1: Template document and framework catalog
  - [x] Write an ADR for the template document format, placeholder grammar and catalog versioning.
  - [x] Implement the domain model, queries, service and router, and regenerate the client.
  - [x] Ship the initial framework catalog (RTF, CO-STAR, CRAFT, few-shot, step-by-step).
  - [x] Test parsing limits, owner isolation, revision conflicts and catalog immutability.
- [x] US-51.2: Template builder with live preview
  - [x] Build the schema-driven form and preview with field/segment linking.
  - [x] Add composer insertion and responsive layout; add unit and Playwright tests.
- [x] US-51.3: Composer integration and provenance
  - [x] Extend slash discovery and message provenance; regenerate the client.
  - [x] Test label rendering, missing-template history and branch regeneration.
- [x] US-51.4: Template library and editor
  - [x] Build the library list, duplicate action and editor with preview.
  - [x] Test editing, conflicts and accessibility (axe, keyboard).
- [x] US-51.5: Scaffolding levels
  - [x] Add level definitions to the template schema and the builder UI.
  - [x] Test that each level renders the right fields and that provenance records the level.
- [x] US-51.6: Prompt coach
  - [x] Add the coach endpoint and rubric prompt, reusing title-model resolution.
  - [x] Build the suggestion checklist and apply actions in the composer.
  - [x] Test model resolution, unavailable state, ephemerality and the UI flow.
- [x] US-51.7: Before/after comparison
  - [x] Wire the coach's before/after pair into the comparison flow; test it end to end.
