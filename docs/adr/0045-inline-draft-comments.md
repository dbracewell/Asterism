# ADR-0045 — Inline comments on a learner's draft

Status: accepted and implemented for US-57.2 on 2026-11-03
([EPIC-57](../epics/EPIC-57-WRITING-FEEDBACK-AND-AI-USE-TRANSPARENCY.md)).

## Context

Draft feedback (ADR-0044) quotes passages of the learner's draft. Learners want
each comment pinned to the sentence it is about, like margin comments, a list
of comments that cannot be placed, and a way to mark comments resolved as they
revise. The draft may be pasted into the message or attached as a text or
document file, whose extracted text the browser cannot read.

## Decision

### 1. One note per quote (mode version 2)

The Draft feedback instructions now ask, per criterion, for pairs of a quoted
passage (`>` lines, copied exactly, a sentence or part of one) and a note
directly below it, then an optional `Next step:` line. Bumping the mode to
version 2 affects only newly accepted turns. `learning/rubric_replies.py` is the
one Python parser for this format (headings, level lines, quote/note pairs). The
evaluation uses it and now also requires at least one quote with a note.

### 2. Comments are parsed when the reply is saved

When the final step of a run whose execution has a rubric is saved,
`build_comments` parses it against the execution's rubric labels. Each quote and
note becomes a `DraftComment` (`c1`, `c2`, …, at most 40; quote ≤ 500 and note
≤ 1,000 characters) with its criterion and level, stored in
`messages.draft_comments`. Replies that are not rubric feedback, or that have
no quotes, store nothing. Only `resolved_at` changes afterwards. Messages expose
`draft_comment_summary` (total and resolved).

### 3. Anchoring when read, never stored

`GET /chat/{chat_id}/messages/{message_id}/draft-review` (`chatDraftReviewGetOne`,
owner only) returns:

- `documents`: the request turn's message text (when not blank), then each
  attached file. A file has text only if it is still in the chat's live scope,
  is not an image, and has ready extracted text. Otherwise it is listed as
  unavailable with a reason.
- `comments`: each comment with an `anchor` (`document_id`, `start`, `end`) or
  `null`.

A quote is matched against each available document in order. Matching collapses
whitespace, ignores case and emphasis marks (`*`, `_`, `` ` ``), and treats
typographic quotes, dashes and `…` like their ASCII forms. It tries the quote as
written, then without edge punctuation, then the longest fragment of 12 or more
characters around an ellipsis. Offsets are UTF-16 code units so the browser can
slice the text directly. Because anchors are computed against live documents,
there are no stale offsets, and a file removed from scope simply unanchors its
comments.

`PUT …/draft-review/comments/{comment_id}` (`chatDraftReviewCommentUpdate`)
takes `{resolved}` and returns the new summary. It is idempotent and owner only.
A message without comments returns 400 and an unknown comment 404.

### 4. Review view

A reply with comments shows **Review draft with comments · N comments**. The
dialog shows each document's text with highlighted passages (overlapping
comments split into shared segments) beside the comment list, and stacks on
narrow screens. Selecting a comment highlights and scrolls to its passage;
selecting a passage selects its comment. Each comment has a **Resolved**
checkbox; resolved passages keep a dotted underline. Comments without an anchor
are listed under "Not found in your draft".

## Consequences

- Schema change (`messages.draft_comments`) needs the development reset.
- Matching is literal after normalization: a paraphrased quote is not placed,
  and is listed separately instead of being pinned to the wrong sentence.
- Converted documents (PDF, DOCX) are matched against their extracted text,
  which can differ from the original layout.
