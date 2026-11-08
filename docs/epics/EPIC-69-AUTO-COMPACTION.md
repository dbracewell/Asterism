# EPIC-69: Automatic context compaction

Status: complete (US-69.1 and US-69.2 confirmed and merged 2026-11-08). Source: user request (2026-11-08). Decision: [ADR-0060](../adr/0060-context-compaction.md).

## Objective

Every turn currently sends the whole branch history to the model
(`ChatOrchestrator._assemble_agent_messages`). The composer already shows context
usage (`ChatContextUsage`), but long chats eventually exceed the model's context
window and fail. Compact older turns into a summary automatically before that
happens, and let the user compact on demand.

## Ownership and delivery

- Compaction is per branch: a compaction record covers a contiguous range of
  messages on one branch, stores the summary, the model that wrote it, token
  counts and timestamps. Messages are never deleted; the UI still shows them.
- Prompt assembly uses the newest applicable compaction for the branch, then the
  messages after it. Forks and regeneration from before a compaction point use
  the history as it was at that point (consistent with ADR-0038 replay).
- Trigger: before a turn, if estimated input + reserved output exceeds a
  threshold of the model's `context_window` (default 80%, admin-configurable).
  Models with unknown context windows use an admin-set fallback size.
- The summary is untrusted model output: it cannot grant capabilities, and
  pinned skills, persona and system layers are re-injected normally, not summarized.
- Keep recent turns verbatim (a configurable tail) and preserve file references,
  tool results needed for open threads and citations keys where possible.
- Compaction runs with the chat's own model unless the admin selects a dedicated
  compaction model. Its usage is recorded like other background calls.
- Sub-agent runs are short-lived and are out of scope; record that in the ADR.

## US-69.1: Compaction records and prompt assembly

As a user, I want long chats to keep working instead of failing at the context limit.

Estimate: 2.5 days. Dependencies: none.

Acceptance: a compaction table keyed by chat and branch; prompt assembly uses it;
forks/regenerations before the compaction point ignore it; the context manifest
and run inspection show that a summary replaced N messages. A turn that would
exceed the threshold compacts first and then runs. If compaction itself fails the
turn reports a clear error rather than sending an oversized request.

- [x] Write the ADR (record shape, branch/fork rules, trust rules, thresholds).
- [x] Implement the record, the summarizer prompt and assembly changes.
- [x] Tests: threshold trigger, branch isolation, fork before/after the point, replay, unknown context window, failure path.

## US-69.2: Compaction in the chat UI and settings

As a user, I want to see when and where my chat was compacted and to compact it myself.

Estimate: 1.5 days. Dependencies: US-69.1.

Acceptance: a divider in the transcript marks the compaction point and can
expand to show the summary. The context usage meter has a "Compact now" action.
Streaming shows a "Compacting conversation…" state. Admin Settings exposes the
threshold, the verbatim tail size, the fallback window and the optional
compaction model. Help explains compaction.

- [x] Stream compaction events; add the divider, meter action and admin settings; regenerate the client.
- [x] Help and glossary; unit tests and an E2E with a small fake context window.
