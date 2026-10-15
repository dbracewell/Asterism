# Completed work — 2026-10-15

## US-29.2 — Chat model selection and model provenance

User confirmed completion on 2026-10-15 and authorized commit and merge into `main`.

- [x] US-29.2: Chat model selection and model provenance — confirmed complete 2026-10-15.
  - [x] US-29.2-T1: Define the available chat-model API from the existing provider/model catalog with enabled/authorized status, display identity, and relevant capabilities; return a clear state when no model is available.
  - [x] US-29.2-T2: Replace chat main-agent selection with persisted model selection, including draft/new chats and an explicit initialization policy; validate requested models server-side. Model changes apply on the next turn; reject changes during an active run.
  - [x] US-29.2-T3: Pass the selected model separately from main-agent configuration through runtime construction, token/context estimates, streaming, attachment/vision handling, background/resumed jobs, and regeneration. Snapshot the actual model/provider and configuration revision per turn; distinguish replay of a recorded turn from regeneration using the current selection.
  - [x] US-29.2-T4: Regenerate clients and test switching/reopen, concurrent update/send, unavailable or unauthorized models, model capability differences, retry/regeneration/replay, and sub-agents retaining their own fixed models. Never silently fall back to a different model.

Verification: 368 backend tests, 100 frontend tests, 15 isolated browser tests without retries, 6 auth database checks, and 29 root configuration tests passed. Backend/frontend lint, configured type checks, production build, dependency-cycle checks, and fresh OpenAPI client consistency passed. Focused backend static typing passed; a broader chat probe retains two pre-existing typing errors in controller.py and schemas.py.

The working database was retained; schema changes require a fresh development database.

Next recommended story: US-29.3 — Project-selected sub-agents.
