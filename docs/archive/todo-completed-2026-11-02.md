# Completed checklist — 2026-11-02

The user confirmed US-54.6 completion and authorized a local merge on
2026-11-02. EPIC-54 (US-54.1 through US-54.6) is complete; each story was
confirmed and merged with `--no-ff` before the next began. US-54.4 was done
ahead of order to unblock US-51.7. See ADR-0027 and ADR-0038.

### [EPIC-54: Run inspection, replay and comparison](../epics/EPIC-54-RUN-INSPECTION-REPLAY-AND-COMPARISON.md)

- [x] US-54.1: Per-step usage and cost
  - [x] Record per-step usage on delegation records and messages.
  - [x] Add optional price metadata to model settings; regenerate the client.
  - [x] Build the usage summary and breakdown; test totals, missing prices and plan runs.
- [x] US-54.2: Capability manifest
  - [x] Capture the effective capability set with grant reasons at execution time.
  - [x] Build the manifest panel; test accuracy against authorization fixtures.
- [x] US-54.3: Context inspector
  - [x] Record a context manifest (layer IDs and revisions, chunk references, truncations).
  - [x] Build the inspector; test owner-only access and the untrusted rendering path.
- [x] US-54.4: Side-by-side comparison
  - [x] Implement multi-target submission as sibling branches within chat admission limits.
  - [x] Build the comparison layout (columns that stack on narrow screens).
  - [x] Test admission limits, branch provenance and continuation.
- [x] US-54.5: Fork from a step
  - [x] Write an ADR for fork semantics (what is reused versus re-executed).
  - [x] Implement the fork execution path; build the fork UI.
  - [x] Test isolation of the original branch, scope inheritance and explicit-save behavior.
- [x] US-54.6: Run diff
  - [x] Build the diff view over recorded data; test it with fixture runs.
