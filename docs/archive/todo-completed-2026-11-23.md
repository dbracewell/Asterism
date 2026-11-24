# Completed checklist: 2026-11-23

## Long-term memory

[EPIC-93](../epics/EPIC-93-LONG-TERM-MEMORY.md) is complete: US-93.1 to US-93.6 were each confirmed and merged through pull requests (#73 to #78) on 2026-11-23, in the order 93.1, 93.2, 93.5, 93.3, 93.4, 93.6. Memory ships in the next release; the upgrade check starts seeding memories once a release with memory exists.

- [x] US-93.1: Memory store and boundary (merged 2026-11-23, PR #73)
  - [x] ADR: the two kinds, the user-memory content rule, private by default, sensitive memories, pinning, and the revised boundary. Update [context isolation](../architecture/context-isolation.md) and `MemoryNamespace` (add the `user` kind, used only for user memory).
  - [x] A `memories` table with a versioned migration and upgrade test (ADR-0069): owner, kind (`user` / `project`) and `project_id` (required for project memory); text (bounded, with the About you character rules) and a category (user memory: learning, accessibility, background, other); `sensitive`; source chat, message and execution; revision and timestamps. A per-person cap applies for each kind.
  - [x] Memory vectors in their own LanceDB table behind `VectorStore`, keyed by owner and memory id, rewritten on edit.
  - [x] An owner-scoped service and API: list, create, edit (expected revision, 409 on conflict), delete, delete all. Each lists in a deterministic order, filtered in the database before pagination.
  - [x] Deleting the account deletes its memories and vectors. Deleting a project deletes its project memories. Deleting a chat keeps saved memories, whose source then reads "chat deleted".
  - [x] Tests for ownership, caps, revisions and deletion. Release notes: Data.
- [x] US-93.2: Policies (merged 2026-11-23, PR #74)
  - [x] An admin `memory_enabled` policy (default off) with `group_ids`, in Admin Settings, checked live (ADR-0058).
  - [x] A per-person "Use memory" setting (default on when the policy allows).
  - [x] A course setting that turns memory off for chats in the course, included in the effective policy (ADR-0068) with its source shown to the student.
  - [x] One `memory_available(user, chat)` check, used for reading and proposing on every send, resume and regeneration. Tests for each source.
- [x] US-93.5: Relevant memories in every turn (merged 2026-11-23, PR #75)
  - [x] Before a turn, select memories: user memories, plus the chat's project memories in project chats; ranked by similarity with the prompt; bounded by count and tokens; all available ones when there are few.
  - [x] Add them as one information layer, framed as information about the person, not instructions, after About you.
  - [x] Snapshot the selected memories (id, revision and text) privately on the accepted message, like `accepted_about`. Resume uses the snapshot, with ownership checked; regeneration selects again; children inherit the layer. Deleting a memory, or deleting all, removes its text from every snapshot.
  - [x] Tests: an edit between acceptance and resume, where resume sends the accepted text; a deletion between them, where resume sends nothing for that memory.
  - [x] Tests for selection, the budget, pinning, course and policy refusals, and that a General chat never receives project memory.
  - [x] Read through `memory_available` on every send, resume and regeneration (US-93.2). Reply provenance records which memories were used (ids only), for US-93.3 to show.
- [x] US-93.3: Your memories in Your Asterism (PR #76, merged 2026-11-23)
  - [x] User Settings → Your Asterism → Memory: user memories by category, with sensitive ones labelled; add, edit, delete, delete all (with confirmation). Built with shadcn/ui, TanStack Query and the generated client.
  - [x] Each project's settings: its project memories, with the same controls.
  - [x] The "Use memory" setting, with a plain explanation of what is remembered, who can see it (only you) and how it is used.
  - [x] When the policy or a course turns memory off, the page says so and why.
  - [x] Help text and a help topic; E2E and accessibility tests.
  - [x] Show which memories a reply used, in the progress panel or message details, with a link to them in Your Asterism.
  - [x] Show the memory controls held back in US-93.2 ("Use memory" in Your Asterism, the course switch) with their help and guide text, and replace the admin Memory placeholder with the working pane.
- [x] US-93.4: The agent proposes, the person decides (PR #77, merged 2026-11-23)
  - [x] An internal `propose_memory` tool for the main agent in ordinary chats, offered when memory is available and the model supports tools: it takes the kind, text, category and whether the memory is sensitive; it is limited to one proposal per turn; it is never offered to sub-agents or in drafting chats.
  - [x] Its description and the main prompt set the rules: user memory is only about the person, never project content; accessibility and health memories are only from what the person said about themselves.
  - [x] A proposal card in the chat shows the text and where it will be saved ("You, in every chat" or "This project"), with Save, Edit and Dismiss. Saving rechecks availability and ownership live.
  - [x] Proposals are branch-aware chat records, and a dismissed one isn't proposed again in that chat.
  - [x] An audit record (ids and times only) for every proposal and decision.
  - [x] Tests, including text injected from a file, which can only lead to a proposal that is never saved without the click.
- [x] US-93.6: Memory in exports, backups and upgrades (PR #78, merged 2026-11-23)
  - [x] Download my data (ADR-0076) includes `memories.json`, with sensitive memories marked.
  - [x] Backup and restore (ADR-0072) include the memory vectors. A restore re-embeds any memory without a vector.
  - [x] The upgrade check (US-91.6) seeds a user memory and a project memory and checks they survive.
  - [x] User guide: a "What Asterism remembers" page. Architecture: memory in the agent runtime and context-isolation guides. `AGENTS.md`: replace "no long-term memory engine exists" with the memory rules. Release notes: Behavior.

## Fixable high vulnerabilities

[EPIC-95](../epics/EPIC-95-FIXABLE-HIGH-VULNERABILITIES.md) is complete: US-95.1 to US-95.5 were each confirmed and merged through pull requests (#64, #66, #67, #69, #70), the last on 2026-11-23, and 0.3.1 (2026-11-23) shipped them. The image and both lockfiles have no fixable critical or high vulnerability, and since US-95.5 a fixable high fails CI, stops a release and opens the weekly scan's issue. One task moved to the maintenance follow-ups: taking the base image update that carries the fixed `zlib1g`, which `pnpm check:image` flags when it arrives.

- [x] US-95.1: Keep development packages out of the image (merged 2026-11-22, PR #64)
  - [x] Scan the image built after EPIC-94 and record its fixable highs in the epic, updating "Where things stand" when they differ.
  - [x] Stop `vitest` (better-auth's optional peer) and what it brings (`vite`, `jsdom`, `undici`) from reaching the production install, without changing the frontend's own test setup.
  - [x] Remove pip, and the packages it vendors, from the runtime stage. The build stages keep it to install uv.
  - [x] `pnpm check:image` fails if `vitest`, `vite` or `jsdom` is in the image's `node_modules`, or `pip` is importable by the image's system Python. Tests cover both.
  - [x] Release notes: Image (what was removed, and the new size).
- [x] US-95.2: Node packages (merged 2026-11-23, PR #66)
  - [x] Upgrade what is still flagged after US-95.1 (`fast-uri` through `ajv`, `browserslist`, and `source-map-js` through `next` → `postcss`) and the lockfile-only `brace-expansion` and `js-yaml`, with overrides only where a parent pins an old version.
  - [x] Tests: form validation through `@hookform/resolvers` and `ajv`; the frontend build and E2E.
  - [x] Dependabot shows no open high alert for `pnpm-lock.yaml`.
- [x] US-95.3: Python packages (merged 2026-11-23, PR #67)
  - [x] Upgrade `cryptography` (49 → 50), `filelock` (3 → 4), `soupsieve` (2 → 3 or 4) and `urllib3` (2.8) through `uv.lock`, with a constraint only where a parent caps one.
  - [x] Check each major in its changelog and with tests: JWT verification and PDF text extraction (cryptography); model downloads and the Hugging Face cache, including two at once (filelock); HTML to Markdown and the web fetch tool's extraction (soupsieve).
  - [x] Record in the pull request, for each, whether Asterism's use reaches the advisory.
  - [x] The upgrade check passes. Dependabot shows no open high alert for `uv.lock`.
- [x] US-95.4: OS packages (merged 2026-11-23, PR #69)
  - [ ] Take the base image update that carries `zlib1g` 1.3.1-1+deb13u1 (and any other fixed OS package by then), as a pinned digest. No newer base yet: the latest `python:3.13-slim-trixie` (2026-11-05) is the pinned digest and still has 1-1+b1, so the fallback below applies.
  - [x] If the base lags a fix by more than a week, the runtime stage upgrades that named package with a comment and the date, and a check fails once the base has caught up.
  - [x] The image checks and the theme storage and fetch browser checks pass.
- [x] US-95.5: Fail on fixable highs (merged 2026-11-23, PR #70; released in 0.3.1)
  - [x] `pnpm check:vulns` fails on a fixable high as well as a fixable critical, in CI, the release workflow and the weekly scan, and still prints the table. Tests cover the new threshold and `.trivyignore.yaml` entries for highs.
  - [x] The weekly scan's issue lists new fixable highs as well as criticals.
  - [x] Update the vulnerability scan section of `docs/development.md` and close EPIC-92's open question 1.
  - [x] Release notes: Image (the fixed packages, and that a fixable high now stops a release). Cut the release that ships the epic.
