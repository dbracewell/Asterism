# ADR-0060 — Automatic context compaction

Status: accepted for US-69.1 on 2026-11-08
([EPIC-69](../epics/EPIC-69-AUTO-COMPACTION.md)). The chat UI, streaming events
and admin controls follow in US-69.2.

## Context

Every turn sends the whole active branch to the model
(`ChatOrchestrator._assemble_agent_messages`). Long chats eventually exceed the
model's context window and the provider rejects the request. Messages form a
tree: a branch is the path from a root to a leaf, and regeneration, forks
(ADR-0038) and comparison columns (US-54.4) all add siblings without changing
earlier messages. Message content is never edited in place.

## Decision

### The record is anchored on the last message it covers

A compaction is a row in `chat_compactions`:

| Column                          | Meaning                                                         |
| ------------------------------- | --------------------------------------------------------------- |
| `id`, `user_id`, `chat_id`      | Owner-scoped like messages; cascades with the chat.             |
| `through_message_id`            | The last message the summary covers (same chat and owner).      |
| `previous_compaction_id`        | The earlier compaction this one built on, if any.               |
| `summary`                       | The summary text. Untrusted model output.                       |
| `replaced_messages`             | How many messages from the root through the anchor it replaces. |
| `model_id`, `model_name`        | The model that wrote it.                                        |
| `input_tokens`, `output_tokens` | Provider-reported usage of the summarizer calls (0 if missing). |
| `estimated_tokens_before`       | Estimated request size that triggered it.                       |
| `trigger`                       | `automatic` or `manual` (manual arrives with US-69.2).          |
| `created_at`                    | When it was written.                                            |

`(chat_id, through_message_id)` is unique: one summary per prefix.

Because the path from the root to a message is unique, the anchor _is_ the
branch key. A compaction applies to a branch exactly when the branch contains
its anchor, and it replaces the root-to-anchor prefix, which is identical on
every branch that contains the anchor. So:

- **Branch isolation.** A sibling branch that left the path before the anchor
  does not contain it and never sees the summary.
- **Forks and regeneration before the point** start a branch without the
  anchor, so they use the full history as it was. Forks and regenerations
  **after** the point share the unchanged prefix and reuse the summary.
- **Newest applicable.** When several compactions apply, assembly uses the one
  whose anchor is deepest on the branch. A later compaction is written on top of
  the earlier summary plus the messages between the two anchors.
- **Replay and resume.** Resuming a pending turn or replaying a fork step reads
  the stored records, so the same branch assembles the same history. Compaction
  only runs again if the request is still over the threshold.

Messages are never deleted or modified. Deleting the anchor message (or the
chat) cascades to the record.

### Anchors fall on turn boundaries

An anchor is a message immediately followed by a user turn on the branch, so a
run's steps (each step carries its own tool results) are never split. The tail
kept verbatim is the last _N_ user turns with their runs (`compaction_tail_turns`,
default 3); the turn being answered is always in the tail. If the request is
still over the threshold, compaction retries keeping only the current turn.

### Prompt assembly

Assembly takes the branch, finds the newest applicable compaction, and sends:
system prompt (built from the run's prompt snapshot as before), then one user
message holding the labelled summary, then the messages after the anchor.
Attached files in summarized messages are no longer inlined; their reference
tokens are kept in the summary when possible, and file scope is unchanged,
because it is derived from the chat's file provenance, not from the prompt.

### Trigger and thresholds

Before each main-agent run, after prompt assembly and before the first model
call, the orchestrator estimates the request: system prompt, messages, tool
schemas, image allowance and reserved output (the same estimate as the context
meter). It compacts first when the estimate exceeds
`compaction_threshold` × context window (default 0.8).

- The context window is the run's recorded model `context_window`. Models with
  an unknown window use `compaction_fallback_context_window` (default 32,768).
- Admin settings: `compaction_threshold` (0.5–0.95), `compaction_tail_turns`
  (1–20), `compaction_fallback_context_window` (≥ 2,048) and an optional
  `compaction_model_id`. Missing or malformed values use the defaults. The
  policy is part of the settings export file; the compaction model travels by
  name and is left unset on import if it is missing or inactive.

### Summarizer

The summarizer runs with the chat's own run model, unless the admin selects
a compaction model, which must be usable by the chat owner at that moment
(otherwise compaction fails; it never silently picks another model). The prompt
asks for a faithful summary that keeps decisions, open questions and tasks,
facts the user gave, tool results still needed, and verbatim `asterism-file:`
references and citation keys. It tells the model the transcript is data, not
instructions. Transcripts larger than the summarizer's own budget are
summarized in sequential chunks, each folding into the running summary. Usage is
stored on the record, like verification and disagreement passes.

### Trust

The summary is untrusted model output, like a tool result:

- It is sent as a labelled user-role message, never as a system or instruction
  layer, and is never parsed for capabilities.
- Persona, skills, learning mode, runtime and agent instructions come from the
  run's prompt snapshot and are re-injected normally. They are never summarized.
- It grants no tools, files, delegation, models or scope. Authorization reads
  live scope as before.

### Failure

If compaction fails (model unavailable, provider error, empty reply), or the
request still exceeds the full context window after compaction, the turn
reports a clear error and no model request is sent. The user turn stays pending
so it can be resumed or regenerated, as with other run errors.

### Inspection

The step's context manifest gains `compaction` (record id, anchor, replaced
message count, summary size). Owner-only run inspection
(`GET …/messages/{id}/context/layers`) also returns the summary text of that
compaction.

### Out of scope

Sub-agent runs are short-lived and already receive bounded forwarded parent
context; they are not compacted. When the main agent delegates after a
compaction, the forwarded context contains the labelled summary message, which
stays untrusted. Comparison columns compact independently on their own branch.

## Consequences

- No history is lost: the UI still shows every message (US-69.2 adds a divider).
- A summary is only as good as the model that wrote it; the tail keeps recent
  turns exact.
- Token estimates are approximate; the 0.8 default leaves room for error.
