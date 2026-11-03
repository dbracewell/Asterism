# EPIC-55: Grounded answers and claim verification

Status: in progress (US-55.1 through US-55.3 complete; US-55.4 implemented). Source: product direction discussion (2026-10-31), core value proposition and learner track.

## Objective

Make it easy to check whether an answer is supported. Answers that use retrieval
cite specific sources for specific claims. An on-demand verify pass labels each
claim as supported, unsupported or contradicted by the user's sources.
Disagreements between agents or models are surfaced, not hidden. Learners can
practice spotting errors.

## Ownership and delivery

- Extends the existing structured `RetrievalCitations`. Citations remain separate
  from Markdown and grant no file access. Server-side scope still governs every
  read.
- The verifier is an internal pass that uses the message's recorded file scope,
  or a narrower one, through `RetrievalService`. It uses the web only if the
  originating run was allowed to.
- Verification results are stored on the message with model and timestamp
  provenance. They are labels, not edits to the answer.

## US-55.1: Claim-level citations

As a user, I want to know which source supports which sentence.

Estimate: 2.5 days. Dependencies: none.

Acceptance: when retrieval is used, citation markers attach to specific claim
spans. Hovering or focusing a marker shows the cited chunk and file, and opens
it through the existing scoped-file route. Spans whose citation is unavailable
are marked as such.

- [x] Define the span-citation format in the model output contract and parse it at persistence.
- [x] Render span markers and previews; test parsing, scope and unavailable files.

Implementation: [ADR-0040](../adr/0040-claim-level-citations.md). Search hits carry
an `asterism-cite:<key>` token; `chat/span_citations.py` resolves keys at save
time against the run's own retrievals and stores `citations` on messages and
delegation records; `CitedClaim` renders markers with scoped links and previews.

## US-55.2: Verify pass

As a user, I want to check an answer against my sources.

Estimate: 3 days. Dependencies: US-55.1.

Acceptance: "Verify" extracts the factual claims from an answer and checks each
one against the scoped sources. Each claim is labelled supported, unsupported or
contradicted, with evidence. The pass is bounded (claim count, time) and its
usage is shown.

- [x] Implement claim extraction and per-claim retrieval checks with limits.
- [x] Store results with provenance and build the claim overlay.
- [x] Test scope narrowing, limits and label rendering; add evaluation fixtures.

Implementation: [ADR-0041](../adr/0041-verify-pass.md). `chat/verification.py`
runs the bounded pass over the answer's recorded file scope (narrowable, never
widened) and stores `messages.verification`. The Verify dialog and Verification
panel show labels, evidence, provenance and usage, and highlight claims in the
answer. The pass is file-only; web verification is not included.

## US-55.3: Disagreement display

As a user, I want to know when agents or models disagree.

Estimate: 1.5 days. Dependencies: US-54.4.

Acceptance: in a comparison, or when sub-agents return conflicting results, a
"Disagreements" summary lists the conflicting claims with links to each source
column or agent.

- [x] Implement a bounded claim-comparison pass; build the summary; add tests.

Implementation: [ADR-0042](../adr/0042-disagreement-display.md). One bounded model
call compares a comparison's answered columns or a step's finished sub-agent
outputs; `messages.disagreements` stores the points with links to each column
or agent, and flags summaries whose column answers changed.

## US-55.4: Spot-the-error exercise

As a learner, I want to practice catching AI mistakes.

Estimate: 1.5 days. Dependencies: US-55.2, US-52.1.

Acceptance: in an exercise learning mode, the agent answers with exactly one
deliberate, recorded error. The learner highlights what they think is wrong and
gets feedback. Revealing the answer shows the error and the source that
disproves it. Exercise answers are clearly labelled as exercises everywhere,
including in exports.

- [x] Add the exercise mode with a recorded error and reveal flow.
- [x] Ensure exercise labelling in history and exports; add tests.

Implementation: [ADR-0043](../adr/0043-spot-the-error-exercise.md). The Spot the
error mode records its error in a block that is cut from the stream and the
saved answer. Selections are graded by overlap without a model call; reveal
shows the error, correction and source. Exercise answers are labelled in the
transcript, when copied and in later model history; no chat export exists yet,
and `Message.exercise` is the flag future exports must label.
