# ADR-0027 — Side-by-side comparisons as sibling branches

Status: accepted for US-54.4 on 2026-10-31.

## Context

US-54.4 runs one prompt against two or three targets and shows the answers in
columns. Each column must be an ordinary chat branch the user can continue
from, and runs must stay within [ADR-0020](0020-chat-capacity-admission.md)
admission limits. US-51.7 will compare an original and an improved prompt on
the same model, so a column may need its own prompt.

The runtime has exactly one generation per chat, held in one work slot.

## Decision

**A comparison is a set of sibling user turns.** Two or three user messages share
a parent and a `comparison_id`, each with a `comparison_index` (0–2) and a fixed
`target_model_id`. A target is `{model_id, user_prompt?}`; without a prompt the
column uses the request's prompt. Columns must differ in model or prompt. All
columns share the same accepted inputs (files, skills, persona) and the
template label applies only to columns that use the templated prompt. The
three fields are set once and then immutable (SQLite trigger); a check
constraint keeps them on user turns only.

**Branch selection stays the existing pointer model.** The parent's
`active_child_id` selects the column the conversation continues from. Columns at
the start of a chat are sibling roots, so chats gain `active_root_id`; without it
the oldest root is active, as before. Siblings created together are ordered by
column index. Every active-branch reader (history, file scope, skills, send)
passes the root pointer.

**A column always runs on its target.** Execution snapshots use the turn's
`target_model_id` in place of the chat's selected model, including on
regeneration of a multi-step answer (resolved from the nearest user turn). The
chat's selection is unchanged, so follow-up turns use it as before.

**Columns run one after another in the chat's single work slot.** Resume finds
pending columns of the comparisons on the active branch and answers each, in
column order, on its own root-to-column history, so a column never sees another
column's answer. Parallel runs would multiply per-owner work slots and break the
one-generation-per-chat invariant; the cost is that columns answer in turn.
Cancelling stops the current column and marks the rest cancelled so a reconnect
does not run them. While any column is pending, new sends are refused (409).

**Packets name their column.** Every packet of a column's run carries
`comparison: {id, column_id}`; the client streams it into that column instead of
the transcript tail.

**Comparing an existing turn adds columns beside it.** The answered turn becomes
column 0 (its target is the model that answered it) and one or two new columns
rerun its accepted inputs. Its answer is not rerun and it stays active. The
receipt keys on the source turn, so replaying the request is idempotent.

## Consequences

- No new execution path: columns are user turns, answered by the same runtime
  with the same provenance and authorization checks.
- Total comparison time is the sum of the columns, not the slowest one.
- Only the active column offers regeneration; continuing from another column is
  an explicit, guarded branch switch.
- In-job message updates (regeneration and cancellation) now use an unguarded
  runtime write. The guarded public update refused changes while the chat's own
  job was running, which made socket regeneration fail with 409.
