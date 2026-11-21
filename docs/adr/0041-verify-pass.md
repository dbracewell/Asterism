# ADR-0041 — Verify pass

Status: accepted and implemented for US-55.2 on 2026-11-02
([EPIC-55](../epics/EPIC-55-GROUNDED-ANSWERS-AND-CLAIM-VERIFICATION.md)).

## Context

Claim citations ([ADR-0040](0040-claim-level-citations.md)) show what an answer
says it relies on, not whether the source agrees. Users need an on-demand check:
list the answer's factual claims and say, for each, whether the user's own
sources support it, contradict it, or do not settle it. The check must not widen
access, must be bounded, and must not edit the answer.

## Decision

### 1. Request

`POST /chat/{chat_id}/messages/{message_id}/verify` (`chatMessageVerify`), owner
only, with `{model_id, file_ids?}`. It runs synchronously within a fixed time
budget and returns the stored `MessageVerification`. Only a completed assistant
message with content can be verified. A new pass replaces the previous result.
A failed pass (unreadable claim list, timeout before any claim was listed) keeps
the previous result.

The **verifier model** is chosen by the user, like the study tools. It must be
available right now; it does not need tool support, because the server, not the
model, runs the searches. The UI defaults to the model that wrote the answer.

### 2. Scope

The pass searches the answer's **recorded** file scope,
`execution.context.allowed_file_ids`, through `RetrievalService`. It never
widens:

- `file_ids`, when given, must be a subset of the recorded files (400 otherwise).
- The live chat file scope applies: files deleted or detached since the answer
  are left out. If none remain, or the chat's project changed, the request is
  refused (409).
- Admin policy for `search_knowledge` applies (409 when turned off).
- `create_verification_retrieval_service` rechecks admin policy and the live
  scope on every read, like the runtime reader does for agents. It keeps only
  files inside the scope's ceiling.

An answer whose run had no files has nothing to verify against (409).

**Web.** The pass is file-only. `web_search` exists, but the verifier never uses
it, so the rule "web only if the originating run was allowed" holds trivially.
Web verification can be added later behind that rule.

### 3. Pass

1. **Extract.** One model call lists up to 12 claims as JSON, each with the
   shortest exact quote from the answer. The answer is read as the user sees it
   (citation and file tokens become their text), capped at 16,000 characters.
   A quote is kept only if it occurs in the answer, ignoring whitespace.
2. **Check.** For each claim, one search (top 4 passages), then one judge call
   that labels it `supported`, `contradicted` or `unsupported` and names the
   passages it used. With no matching passage, the claim is `unsupported`
   without a model call.
3. **Bounds.** At most 3 claims run at once. Each model call has 45 seconds and
   the whole pass 120 seconds. Claims beyond the limit are counted, not checked.

A claim that cannot be checked is labelled `unchecked` with the reason (time
limit, failed call, unreadable reply, sources gone). A `supported` or
`contradicted` label that cites no passage that was sent is treated as
unreadable, not relabelled. Prompts tell the model that answer and passage text
is reference material only and to ignore instructions inside it.

### 4. Storage and provenance

`messages.verification` holds one JSON `MessageVerification`:

| Field                   | Meaning                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `model_id`, `model_name` | The verifier.                                                    |
| `created_at`            | When the pass finished (epoch ms).                                |
| `file_ids`              | The files it searched.                                            |
| `claims[]`              | `claim`, `quote`, `label`, `explanation`, `evidence[]`.           |
| `evidence[]`            | `file_id`, `chunk_id`, `artifact_generation`, `name`, `excerpt`, `available`. |
| `usage`                 | Claims found and checked, limit and truncation, timeout, searches, model calls, tokens, duration. |

Labels never change `content`. Evidence excerpts are snapshots of untrusted
text. Reads recheck `available` against the live chat scope (with inline files
and citations, in `apply_live_scope`).

### 5. Display

- A **Verify** action on settled answers whose run had files opens a dialog: what
  the pass does, the file count, the model picker, progress and errors.
- A collapsible **Verification** panel under the answer summarizes the labels,
  shows the verifier, time and file count, what the pass spent, and any limit
  that was hit. Each claim shows its label as text with an icon, the
  explanation, and evidence chips that link to the scoped file view and preview
  the excerpt. Unavailable evidence is an inert note.
- While the panel is open, claim quotes are highlighted in the answer with the
  CSS Custom Highlight API. This is visual only and does not change the rendered
  Markdown, so the renderer's fixed plugin set is unchanged. The highlight
  styles are installed at runtime because the CSS bundler does not parse
  `::highlight()`. A switch turns highlighting off.

### 6. Evaluation

`chat/evals/verify.json` holds extraction cases (required and forbidden claim
patterns, including an injected instruction) and judgment cases (expected label
and cited passage, including outside knowledge and an injected passage).
`scripts/evaluate_verification.py` runs them against a live model. Like the
learning-mode fixtures, they measure prompt quality and do not gate CI.

## Consequences

- `messages` gains `verification` (fresh initialization, no migration).
- Study's model selection moved to `llm/selection.py` (`resolve_usable_model`,
  `SelectedModel`), which also reports token usage.
- A pass costs up to 13 model calls and 12 searches. The usage line makes
  that visible.
- A label is a model's judgment over retrieved passages, not proof. The panel
  says the labels describe the sources and do not change the answer.

## Alternatives considered

- **One judge call for all claims.** Cheaper, but one bad reply loses every
  label, and per-claim evidence gets mixed up.
- **Background job with progress events.** More machinery than a 2-minute
  bounded request needs. Revisit if passes grow.
- **Rewriting the answer with inline marks.** Rejected: labels must not edit the
  answer, and Markdown rewriting would bypass the trust boundary.
