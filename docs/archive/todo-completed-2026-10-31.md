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
