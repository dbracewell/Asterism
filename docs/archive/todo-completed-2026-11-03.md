# Completed checklist — 2026-11-03

The user confirmed US-55.4 completion and authorized a local merge on
2026-11-03. EPIC-55 (US-55.1 through US-55.4) is complete; each story was
confirmed and merged with `--no-ff` before the next began. See ADR-0040
(claim-level citations), ADR-0041 (verify pass), ADR-0042 (disagreement
display) and ADR-0043 (spot-the-error exercise).

### [EPIC-55: Grounded answers and claim verification](../epics/EPIC-55-GROUNDED-ANSWERS-AND-CLAIM-VERIFICATION.md)

- [x] US-55.1: Claim-level citations (confirmed and merged 2026-11-02)
  - [x] Define the span-citation format in the model output contract and parse it at persistence.
  - [x] Render span markers and previews; test parsing, scope and unavailable files.
- [x] US-55.2: Verify pass (confirmed and merged 2026-11-02)
  - [x] Implement claim extraction and per-claim retrieval checks with limits.
  - [x] Store results with provenance and build the claim overlay.
  - [x] Test scope narrowing, limits and label rendering; add evaluation fixtures.
- [x] US-55.3: Disagreement display (confirmed and merged 2026-11-02)
  - [x] Implement a bounded claim-comparison pass; build the summary; add tests.
- [x] US-55.4: Spot-the-error exercise (confirmed and merged 2026-11-03)
  - [x] Add the exercise mode with a recorded error and reveal flow.
  - [x] Ensure exercise labelling in history and exports; add tests.
