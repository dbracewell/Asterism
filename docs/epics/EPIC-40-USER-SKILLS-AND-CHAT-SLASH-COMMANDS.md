# EPIC-40: User skills and chat slash commands

Status: US-40.1 complete, user-confirmed on 2026-10-25 and approved for local
merge. US-40.2 through US-40.4 remain planned. CRUD/assignment/policy/discovery APIs exist; UI and
runtime activation remain planned. See the
[US-40.1 verification record](../reviews/us-40.1-skills-verification-2026-10-25.md).

## Objective and first-version contract

Users can create, view, edit, and delete their own reusable agent skills, then
explicitly activate them from the chat input with `/skill-name`.

A skill is a database-backed `SKILL.md`-style document: YAML frontmatter with
required `name` and `description`, followed by Markdown instructions. `name` is a
lowercase, hyphen-separated slash-command identifier unique within its owner's
skills. The complete document is the editable source of truth; validated name
and description are derived metadata used for listing, search, and completion.
For example:

```markdown
---
name: review-code
description: Review code for correctness and explain actionable improvements.
---

Check the supplied code for errors and edge cases. Explain each finding and
suggest a focused correction.
```

First-version scope:

- Private user ownership, a searchable/paginated Skills management page in user
  settings, Markdown source editing, rendered preview, and confirmed deletion.
- Explicit main-agent skill assignment plus an admin-controlled skills policy.
  Owning, creating, or mentioning a skill does not by itself authorize activation.
  The slash picker lists the intersection of owned, assigned, policy-allowed
  skills. This follows the existing capability rules; it does not create a
  separate admin-owned copy of each user's skill.
- One or more explicitly activated skills, in user-selected order, available in
  both General and project chats. `/skill-name` activates a skill for the current
  chat branch; it remains active across follow-up messages until the user removes
  it. Always show the active skills and provide removal controls.
- Active skills belong to an individual chat/branch, never implicitly to an
  entire project, another General chat, a new chat, or a delegated agent.
  Delegated agents have their own eligibility/authorization boundary; the
  parent's active skills are not automatically inherited.
- Instruction-only skills: no script execution, skill directories, bundled
  assets, arbitrary filesystem reads, or skill marketplace. Automatic selection
  by description is a separate future enhancement, disabled in this epic's first
  version. Any future automatic selection must use the same eligibility checks
  and visible activation state as explicit selection.
  SKILL.md-style authoring is the product contract here, not a claim that all
  external skill-package formats or host activation lifetimes are supported.

## Ownership and architecture

Add an owning `skills` backend domain with models, schemas, owner-scoped queries,
CRUD services, and routes. A `skills` table stores ID, owner user ID, canonical
Markdown source, validated name/description metadata, revision, and timestamps.
Enforce owner/name uniqueness and owner foreign keys in the database. Updates
use expected revisions to prevent overwriting another edit. An explicit
agent/skill assignment relation must also enforce consistent ownership; its
first consumer is the user's singleton main-agent configuration.

The chat acceptance/composition roots resolve authorized skill IDs and revisions
through the skills domain and inject typed skill snapshots into `PromptComposer`.
The agent runtime consumes those snapshots rather than querying skill tables.
Use the current admin capability-policy boundary, adding a typed skills policy
if none exists; do not assume today's tools policy already implements skills.
Update AGENTS.md's capability description to explain private skill ownership,
admin activation policy, and explicit assignment without weakening tool scope.

Skill instructions form a named prompt layer after agent/project instructions
and before conversation content; they cannot override higher-priority platform,
agent, project, or authorization constraints. Multiple skills preserve explicit
selection order. Skill text and frontmatter cannot grant ordinary tools, MCP,
file access, internal tools, model capabilities, or delegation. Selecting a skill
must not require tool support from an otherwise eligible text model.

Persist an ordered, revisioned active-skill state owned by the chat domain and
scoped to the current chat branch. The skills domain owns skill documents and
eligibility; it does not own chat selection state. Initial chat creation can
accept staged activations. Later sends use the branch's active state unless the
user explicitly changes it. Add/remove/reorder/refresh changes are staged in the
composer draft and committed atomically with the next accepted message; failed
or canceled sends do not change the accepted state. Preserve pending edits across
reloads and make pending changes distinguishable from the accepted active set.
Use an expected active-state revision to reject stale-tab overwrites, including
an explicit empty set when removing the last skill.

Each activation pins a server-resolved skill revision and exact instructions.
Subsequent turns reuse that snapshot while live ownership/assignment/admin
policy remains valid; clients cannot substitute instruction text. A later skill
edit shows an update-available state rather than silently changing an active
workflow. Refresh/re-activation explicitly adopts the current document and
records the change. Skills unavailable through deletion, unassignment, or admin
policy block affected sends with actionable remove/retry controls, rather than
silently omitting their instructions.

Persist the effective skill IDs, names, revisions, and exact instruction
snapshots with every accepted turn/execution, including the request fingerprint.
Retry/resume preserves that turn's recorded instructions and rechecks live
eligibility. Removing a skill from the composer affects future accepted turns;
it does not rewrite or cancel an already accepted turn. Regeneration starts from
the source turn's skill snapshots; adopting refreshed instructions or a changed
set is explicit and records a new execution snapshot. Branch switching restores
that branch's active set, and a fork starts from the source turn's recorded set;
changes on one branch do not mutate siblings. Historical snapshot access stays
subject to chat ownership. No implicit propagation to sub-agents is introduced.

For example, `/review-code` followed by “Now check the error handling” continues
the review workflow without another slash command. Removing the review skill
before the next accepted message ends its active instruction layer for subsequent
turns. Prior messages remain history; deactivation is not history erasure.

No migrations, compatibility aliases, or working-data resets. Schema changes use
fresh initialization; verification uses disposable storage. Regenerate Hey API
clients after API changes. Frontend server state uses generated clients and
TanStack Query with the existing shared mutation invalidation.

## US-40.1: Persist and authorize private skills

Status: complete; checklist [archived](../archive/todo-completed-2026-10-25.md).

As a user, I want reusable skills that belong to me and remain private.

Estimate: 1.5–2 days. Dependencies: none.

Acceptance: owner-scoped CRUD supports search/pagination and revision conflicts;
valid SKILL.md-style source round-trips without metadata drift. Invalid or
oversized documents and duplicate owner/name pairs are rejected clearly. Another
user cannot list, read, change, assign, or delete my skills. Agent assignment and
admin policy determine activation eligibility without granting other powers.

- [x] Add skill storage, fresh initialization/registration, constraints, and bounded frontmatter/Markdown validation; reject unsupported executable/capability declarations rather than interpreting them.
- [x] Implement owner-scoped paginated/searchable CRUD and expected-revision updates in the skills domain; handle assignment cleanup on deletion without rewriting snapshots.
- [x] Add owner-consistent main-agent assignments and explicit admin skills-policy contracts; expose eligible skill metadata for the composer and regenerate typed clients.
- [x] Test ownership, uniqueness, validation, concurrent edits, deletion, policy/assignment eligibility, and fresh-schema initialization; document domain boundaries.

## US-40.2: Manage skills in user settings

As a user, I want to create, read, edit, preview, and delete my skill documents.

Estimate: 1–1.5 days. Dependencies: US-40.1.

Acceptance: a Skills page offers paginated search, creation from a minimal
SKILL.md template, Markdown source editing, a safe rendered preview, and
confirmed deletion. Errors preserve drafts; conflicts offer reload without
silently overwriting edits. Main-agent settings manage assigned skills and show
when admin policy prevents activation. Preview renders no executable HTML.

- [ ] Add the Skills settings route/navigation and generated-query list/detail flows with loading, failure/retry, empty, and cached-refresh states.
- [ ] Build create/edit/view/preview and confirmed-delete flows using existing shadcn components; preserve drafts and handle revision conflicts.
- [ ] Add owned-skill assignment controls to main-agent settings and explain unavailable/admin-disabled activation without granting policy through the UI.
- [ ] Verify CRUD, preview safety, search/pagination, assignments, keyboard access, and narrow/short layouts; update user-facing documentation.

## US-40.3: Activate skills through recorded chat execution

As a user, I want activated skills to continue across follow-ups, with consistent
branch-local state and recorded provenance for every response.

Estimate: 3–4 days. Dependencies: US-40.1; start after US-40.2 under the one-story policy.

Acceptance: new-chat and existing-chat sends accept explicit activation changes
and reuse the current branch's active skills for follow-ups. The server validates
ownership, assignment, policy, pinned snapshots, and selection-state revisions
atomically with acceptance. Removal, refresh, reloads, stale tabs, branching,
retry/resume, regeneration, deletion/revocation, and duplicate requests follow the
contract above. Every turn records its effective instructions. General/project
isolation and independent delegated-agent authorization remain unchanged.

- [ ] Add branch-local ordered active-skill state and extend send/admission contracts, expected state revisions, and request fingerprints; atomically accept activation/removal/reorder/refresh changes and reject forged, stale, unassigned, or revoked selections.
- [ ] Resolve and pin owner-scoped skill snapshots at activation, reuse eligible active snapshots on follow-up turns, and inject a bounded named prompt layer; enforce per-skill, count, and aggregate context limits with explicit errors.
- [ ] Persist effective skill provenance on every turn; implement explicit refresh, branch restore/fork isolation, retry/resume/regeneration, and deletion/revocation handling without rewriting history or inheriting parent activation in sub-agents.
- [ ] Test activation across follow-ups, last-skill removal, pinned revisions/refresh, stale tabs, branch isolation, idempotency, cross-user attempts, revocation, and unchanged tool/file/delegation boundaries; regenerate clients and document the contract.

## US-40.4: Discover and invoke skills from the chat input

As a user, I want `/` to help me find and activate an eligible skill while composing.

Estimate: 2–3 days. Dependencies: US-40.2 and US-40.3.

Acceptance: typing `/` at a command boundary opens a searchable skill picker with
names/descriptions. Selecting `/skill-name` adds an explicit removable active-skill
chip; remaining text is the user's prompt. Chips remain visible across follow-ups
and reloads, reflecting the current branch; users can remove or refresh skills
without retyping slash commands. Clearly distinguish staged changes, accepted
active state, update availability, and unavailable skills. Exact typed leading commands also resolve
through the same eligibility/validation flow. Multiple leading commands retain
selection order; duplicate selections appear once. Ordinary slashes in URLs,
paths, code, or later prose do not trigger activation. Unknown leading commands
show an inline correction state and offer an explicit literal-text send; failed
lookups never activate a skill silently. Empty-body messages are allowed with a
selected skill. Escape closes the picker; arrows/Enter choose a skill while
Shift+Enter and input-method composition retain normal text-entry behavior.

- [ ] Add accessible, keyboard/touch-operable slash discovery using generated eligible-skill queries and existing shadcn patterns; cover loading, no matches, unavailable policy, and retry.
- [ ] Implement command-boundary parsing, exact-name resolution, persistent ordered active-skill chips with remove/refresh controls, pending/update/unavailable states, and explicit handling of unknown commands/literal slash text.
- [ ] Restore branch-local active state and pending composer edits across reloads; integrate new/existing sends, follow-ups, removals, refreshes, and retry/draft state; show per-message snapshots and retain prompt/attachments on rejection.
- [ ] Verify keyboard/IME, mobile/short layouts, command parsing, follow-up persistence, removal/refresh, reloads/branch switches, skill-only sends, stale/deleted skills, and General/project execution end to end; run relevant gates and update README/architecture/epic/checklist records.

## Delivery

Four stories, 16 tasks; approximately **8–11 person-days**, excluding work to
repair unrelated existing test failures. Implement one story on its own feature
branch at a time, in the order above. Story completion requires relevant passing
checks, documented verification limits, and user confirmation before local merge.
