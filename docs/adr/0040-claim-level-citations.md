# ADR-0040 — Claim-level citations

Status: accepted and implemented for US-55.1 on 2026-11-02
([EPIC-55](../epics/EPIC-55-GROUNDED-ANSWERS-AND-CLAIM-VERIFICATION.md)).

## Context

Answers that use `search_knowledge` already list their retrieved files as
numbered "Sources" chips (`RetrievalCitations`). Those chips are built from a
step's tool results. They show which files were retrieved, not which sentence
relies on which passage. Final answers usually come in a later step than the
search, so the chips also sit on a different step from the claims.

[ADR-0039](0039-inline-file-references-in-markdown.md) gives the pattern for
Markdown that points at user files: an opaque link token, resolved on the server
at save time, rechecked live on read, and inert without a resolved entry.
Citations follow it.

## Decision

### 1. Syntax

A claim citation is a Markdown **link** whose destination is exactly:

```
asterism-cite:<key>[,<key>]{0,3}
```

A `<key>` is 12 lowercase hex characters. Both sides use the same grammar:

```
^asterism-cite:[0-9a-f]{12}(?:,[0-9a-f]{12}){0,3}$
```

The link text is the **claim span**: `[Revenue grew 12% in Q3.](asterism-cite:0123456789ab)`.
One claim may cite up to four chunks. An image with this destination, a
near-miss (uppercase, a fifth key, trailing `?x`, another scheme in front) or a
token in code is not a citation. It is blocked by the URL policy like any other
non-HTTP link.

A link wraps the claim, so the span is explicit, survives every Markdown parser
as one node and degrades to the plain claim when copied. Footnotes were rejected:
they mark a point, not a span, and GFM footnotes already have their own meaning.

### 2. Keys

`citation_key(file_id, chunk_id)` is the first 12 hex characters of
`sha256("<file_id>:<chunk_id>")`. Every `search_knowledge` hit carries a ready
token in its `citation` field, so the model copies the key instead of deriving
it. Chunk IDs are 64-character hashes, too long to copy reliably. A key is a
lookup handle only: it grants nothing.

### 3. Resolution at save time

The chat domain resolves citations wherever it resolves file references
(`add_message` for every assistant step, including cancelled partial steps,
and `write_fork_step`). It scans with the token pattern, not a Markdown parser.

A key resolves when it matches a hit that the **saving execution retrieved**,
and that hit's file is in both the run's recorded `context.allowed_file_ids` and
the chat's live file scope.

- The main agent may cite hits from any step of its run so far, including this
  step and every delegation in the run. Delegations run under the same or a
  narrower scope, so this never widens access.
- A sub-agent's output may cite only hits in its own `DelegationRecord.tool_results`.
- A step saved without a recorded run resolves nothing. A later run in the same
  chat cannot cite an earlier run's hits; it must search again.

At most **64 distinct keys** resolve per saved text, in order of first
occurrence. Later keys are stored as unavailable.

### 4. Storage

`SpanCitation` is stored as JSON in `messages.citations` and
`DelegationRecord.citations`:

| Field                 | Meaning                                                    |
| --------------------- | ---------------------------------------------------------- |
| `key`                 | The cited key, as written.                                 |
| `available`           | Whether it resolved at save time; rechecked live on read.  |
| `file_id`, `chunk_id` | The cited chunk.                                           |
| `artifact_generation` | The knowledge generation the chunk came from.              |
| `match_kind`          | `text` or `caption`.                                       |
| `name`                | The file's name at save time.                              |
| `excerpt`             | The retrieved excerpt, whitespace-collapsed, ≤ 1,000 chars. |

An unresolved key stores only `key` and `available = false`. A guessed or
foreign key therefore reveals nothing that a typo would not. The excerpt is a
snapshot of text the model already received. It is untrusted and always
rendered as text.

### 5. Live recheck

The chat, run-inspection and comparison reads mark a citation unavailable once
its file leaves the live chat scope (deleted, detached, branch change). The
saved snapshot stays, as with file references. Opening the file still goes
through the scoped route, which returns the same 404 for every unavailable case.

### 6. Rendering

The URL transform lets an exact citation destination reach the `a` component,
which renders `CitedClaim` instead of an anchor:

- The claim text gets a dotted underline. Each key becomes a superscript marker.
- Markers are numbered by the key's position in the message's resolved list,
  which is first-occurrence order. The same key always shows the same number.
- An **available** marker is a link to the scoped file view
  (`/c/<chat>/files/<file>`), named "Citation n: name". Hover or focus shows a
  tooltip with the file name, the excerpt as text, and the generation and match
  kind. No request is made to show it.
- An **unavailable** or unknown key renders an inert, focusable note
  ("Citation n unavailable", or "?" for a key with no entry). Its tooltip reads
  "Source unavailable in this chat".
- While a step is streaming, there is no resolved list. Markers are inert
  "pending" markers until the saved message arrives.
- Surfaces without a provider (study tools, notes) render the claim with inert
  markers. A sub-agent's output uses only its own record's citations.
- Copying a message replaces each cited claim with its plain text.

The existing per-step "Sources" chips stay. They describe what was retrieved;
span markers describe what each claim relies on.

### 7. Model guidance

`build_runtime_prompt` appends `CITATION_GUIDANCE` when `search_knowledge` is
among the run's effective tools. It explains the link form, the four-key limit,
and that only citations returned in this run should be used. It is recorded with
the runtime context, so resume replays the same text. Like ADR-0039 §9, the
guidance grants nothing; resolution is the only authority.

## Consequences

- `messages` and `DelegationRecord` gain `citations`, and `RetrievalHit` gains
  `citation`. Per project policy these are schema changes with fresh
  initialization, not migrations.
- Resolution adds one query per save that cites something: the run's earlier
  steps, read for their tool results and delegations. Saves without citations
  do no extra work.
- A model can write any key. An unknown key gets the same inert marker as a
  typo. A model can also cite a real chunk that does not support the claim:
  span citations show what was cited, not that it is correct. Checking that is
  the verify pass (US-55.2).

## Alternatives considered

- **Raw chunk IDs.** Rejected: 64-character hashes are copied unreliably.
- **Per-run ordinals (`[1]`, `[2]`).** Rejected: numbers depend on search order
  across steps and sub-agents, and collide when results are merged.
- **Resolving at render time.** Rejected for the same reasons as ADR-0039: the
  client would need the run's tool results across steps, and probing becomes an
  existence oracle.
