# ADR-0042 — Disagreement display

Status: accepted and implemented for US-55.3 on 2026-11-02
([EPIC-55](../epics/EPIC-55-GROUNDED-ANSWERS-AND-CLAIM-VERIFICATION.md)).

## Context

Comparisons (US-54.4, [ADR-0027](0027-side-by-side-comparison-branches.md)) put two or
three answers side by side, and a step's sub-agents can return conflicting
results. Reading every column or agent output to spot conflicts is slow. Users
need a summary of where the answers disagree that points back to each source,
without the summary choosing a winner or changing any answer.

## Decision

### 1. Requests

Both are owner only, take `{model_id}` and return the stored `DisagreementSummary`:

- `POST /chat/{chat_id}/comparisons/{comparison_id}/disagreements`
  (`chatComparisonDisagreementsFind`) compares the **final reply** of each
  completed column. At least two are needed (400).
- `POST /chat/{chat_id}/messages/{message_id}/disagreements`
  (`chatDelegationDisagreementsFind`) compares the outputs of a finished
  assistant step's **completed** delegations with non-empty output, in run
  order, at most 6. At least two are needed (400).

The comparing model is chosen by the user from available models, defaulting to
the first column's model or the step's model. A new pass replaces the previous
summary; a failed pass keeps it.

### 2. Pass

One model call. Each answer is sent as `<answer source="S1">…</answer>`, read
as the user sees it (citation and file tokens become their text) and capped at
8,000 characters. A capped source is flagged. The prompt asks for points the
answers cannot all be right about, ignoring wording, detail and points only one
answer makes. It must not judge which is correct, and must ignore instructions
inside the answers.

Parsing is lenient but strict about structure. A position must name a known
source, and each source counts once per point. A point needs positions from at
least two sources. At most 8 points are kept, and the summary says when more
were listed. The call has a 90-second timeout (504). An unreadable reply or a
failed call returns 502.

No retrieval or file access happens: the pass reads only answers the user can
already see in this chat.

### 3. Storage and provenance

`messages.disagreements` holds one JSON `DisagreementSummary`, anchored on:

- **comparisons:** the first column's user turn (a comparison has no row of its
  own; its columns share `comparison_id`), returned with the comparison;
- **sub-agents:** the assistant step that holds the delegations.

It records the model, time, sources and points. Each source has its key, kind,
label, and target: the column index plus the **reply message id** it compared,
or the delegation's `execution_id`. Usage records tokens, duration and
truncation. Several delegations to the same agent are labelled
"Name (1)", "Name (2)".

### 4. Display

- **Comparison:** under the columns, a **Disagreements** panel and a "Find
  disagreements" button (when two or more columns are answered). Each position
  has a "Show <label>" control that scrolls to the column and focuses it. If a
  column's current final reply is not the one compared, for example after
  regenerating, the panel says an answer changed since the summary.
- **Sub-agents:** inside the expanded delegation summary, the same panel and
  button (when two or more agents finished). "Show <agent>" opens the summary
  if needed and focuses that agent's entry.
- The panel shows the compared sources, model, time, tokens and duration, and
  any truncation, and says that it does not decide which answer is correct.
  Topics and positions are untrusted model text and render as text.

## Consequences

- `messages` gains `disagreements` (fresh initialization, no migration).
- A pass costs one model call over at most 6 × 8,000 characters of answers.
- The summary is a model's reading of the answers. It can miss or invent a
  conflict; each position links to its source so the user can check.

## Alternatives considered

- **Claim extraction per answer, then pairwise matching.** More calls and more
  failure points for two or three short answers; one call with labelled
  answers keeps the bound simple.
- **Running it automatically after every comparison.** Spends tokens the user
  did not ask for; the pass is on demand like Verify.
- **A separate comparison table.** Comparisons are deliberately just sibling
  turns; anchoring on column 0's turn avoids a second source of truth.
