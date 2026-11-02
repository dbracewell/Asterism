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

The user confirmed US-56.6 completion and authorized a local merge on
2026-11-02. EPIC-56 (US-56.1 through US-56.6) is complete; each story was
confirmed and merged with `--no-ff` before the next began. US-56.6 also fixed
eight pre-existing browser failures (fork button accessible name, help-center
focus, delegation-summary baselines). See ADR-0039.

### [EPIC-56: Inline user files in Markdown output](docs/epics/EPIC-56-INLINE-USER-FILES-IN-MARKDOWN-OUTPUT.md)

- [x] US-56.1: Reference contract and ADR
  - [x] Write the ADR and update the Markdown trust documentation.
- [x] US-56.2: Produced-file registration
  - [x] Add the `origin` and provenance columns and the registration service in the files domain.
  - [x] Enforce limits and content detection; return reference tokens in tool results.
  - [x] Test limits, type detection, provenance, sub-agent ownership and scope membership.
- [x] US-56.3: Reference resolution at save time
  - [x] Implement parsing and resolution in the chat domain; expose resolved references.
  - [x] Test foreign, missing, out-of-scope and deleted files, and identical 404 behavior.
- [x] US-56.4: Inline images
  - [x] Build `InlineFile` image rendering and the lightbox; implement SVG handling.
  - [x] Add adversarial browser tests (foreign IDs, URL-shaped tokens, script-bearing SVG).
- [x] US-56.5: Document cards and previews
  - [x] Build the document card and preview using cached conversions.
  - [x] Decide and document the thumbnail approach; test cards for each supported type.
- [x] US-56.6: Model instructions and accessibility
  - [x] Add the conditional prompt guidance and copy-text behavior.
  - [x] Add accessibility and keyboard tests.
  - [x] Fix the pre-existing browser failures (fork button accessible name, help-center focus).
