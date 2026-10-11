# EPIC-23 — File and Knowledge Base UI Cleanup

## Goal

Simplify knowledge status in the file explorer, add a dedicated file view, and
make knowledge-base file management use the same explorer experience as the
file library.

**Status: Planned — no user story has started.**

## Product decisions

- Caption editing and clearing are removed from the explorer UI. Captioning is a
  platform-wide policy (EPIC-22); the only per-file action is regeneration.
- The explorer shows per-file `Embedding` and `Caption` status badges and a
  single regenerate button (lucide `RotateCcw`) that reprocesses the file.
- A file that belongs to at least one knowledge base shows a knowledge-base icon
  (with a tooltip listing the bases).
- The file view is read-only: extracted content, caption, the five most similar
  files with similarity scores, and the knowledge bases containing the file.
- Similarity is computed from current-generation file embeddings and is scoped
  to the requesting user's files. Only ready artifacts participate.
- The knowledge-base file manager and the "add files" picker reuse the shared
  file-manager components rather than duplicating list/selection logic.
- The picker is the file explorer in a dialog with deletion and other
  destructive actions disabled, plus an "Add selected" action. Files already in
  the base are shown as such and are not selectable.
- Use existing shadcn/ui components; ask before installing missing ones. All
  data loading uses the generated Hey API client and TanStack Query.

## User stories

### US-23.1 — Compact knowledge status in the file explorer

**As a user**, I want each file to show embedding and caption status with one
regenerate action so the explorer is uncluttered.

**Dependencies:** None.

- [ ] US-23.1-T1: Remove Regenerate caption, Clear caption, and Edit caption
      buttons and any now-unused dialogs/mutations usage from the explorer.
- [ ] US-23.1-T2: Add `Embedding (status)` and `Caption (status)` badges derived
      from file knowledge artifacts, including pending/processing/failed/
      disabled states.
- [ ] US-23.1-T3: Add a `RotateCcw` regenerate button that reprocesses the file
      and is disabled while processing.
- [ ] US-23.1-T4: Add a knowledge-base membership icon with tooltip; expose
      membership in the file list response if it is not already available.
- [ ] US-23.1-T5: Update component tests and E2E coverage.

**Acceptance criteria**

- No caption edit/clear/regenerate buttons remain in the explorer.
- Every file row shows embedding and caption status and one regenerate control.
- Files in a knowledge base show the knowledge-base icon.

### US-23.2 — File view with content, caption, and similar files

**As a user**, I want a file view that shows what Asterism knows about a file.

**Dependencies:** US-23.1.

- [ ] US-23.2-T1: Add a backend endpoint returning the top 5 similar files with
      scores (excluding the file itself), user-scoped and current-generation
      only; regenerate the Hey API client.
- [ ] US-23.2-T2: Add or reuse endpoints for extracted content, caption, and
      knowledge-base memberships for a file.
- [ ] US-23.2-T3: Add the file view route/page with sections for extracted
      content, caption, similar files (linking to their views), and knowledge
      bases (linking to their views).
- [ ] US-23.2-T4: Link to the file view from the explorer.
- [ ] US-23.2-T5: Handle files without ready artifacts (empty/processing/failed
      states).
- [ ] US-23.2-T6: Add backend tests (scoping, ordering, exclusion, missing
      embeddings) and frontend tests.

**Acceptance criteria**

- The view shows extracted content, caption, up to 5 similar files with scores,
  and all containing knowledge bases.
- Similar files never include other users' files or the file itself.

### US-23.3 — Explorer-style file management in a knowledge base

**As a user**, I want to manage a knowledge base's files in an explorer-like view.

**Dependencies:** US-23.1.

- [ ] US-23.3-T1: Make the shared file-manager components configurable by data
      source (all files vs. knowledge-base files) and allowed actions.
- [ ] US-23.3-T2: Replace the file list in the knowledge-base detail view with
      the shared explorer, supporting remove-from-base (not delete file),
      regenerate, and open file view.
- [ ] US-23.3-T3: Keep the existing deletion-versus-membership-removal
      explanations accurate.
- [ ] US-23.3-T4: Update tests.

**Acceptance criteria**

- The knowledge-base view looks and behaves like the explorer, with membership
  removal distinct from file deletion.

### US-23.4 — Add files to a knowledge base via explorer popup

**As a user**, I want to pick files from a popup explorer to add them to a
knowledge base.

**Dependencies:** US-23.3.

- [ ] US-23.4-T1: Build a dialog hosting the shared explorer in a no-delete,
      selection-enabled mode.
- [ ] US-23.4-T2: Add an "Add selected" action that adds the selected files in
      one request (use the existing batch endpoint or add one).
- [ ] US-23.4-T3: Mark files already in the base as unselectable.
- [ ] US-23.4-T4: Handle partial failures and loading/empty states.
- [ ] US-23.4-T5: Add tests and E2E coverage; run quality gates and update
      architecture/README docs.

**Acceptance criteria**

- The picker shows the explorer with no delete control and adds all selected
  files on confirmation.
- The knowledge-base list updates without manual cache invalidation.

### Epic closure

- [ ] Verify story acceptance criteria and request user confirmation.
- [ ] On confirmation, merge approved story branches and propose the next plan.
