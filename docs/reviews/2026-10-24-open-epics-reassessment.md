# Open epics reassessment — 2026-10-24

Baseline: `main` at `1e188a7` (EPIC-38 merged), clean working tree before this
audit. Planning changes were prepared on `docs/open-epics-reassessment-2026-10-24`
and confirmed for merge with US-38.6 on 2026-10-24.
This is a current-source and focused-regression assessment, not implementation
of an open story or a new full browser/production certification.

> Historical assessment: the findings and next-work sequence below describe the
> baseline above. Subsequent stories are now complete; see the
> [current roadmap](../plans/post-refactor-quality-roadmap.md) and the
> [US-36.1/37.1 reconciliation](us-36.1-us-37.1-completion-reconciliation-2026-10-24.md).

## Decisions

### EPIC-33: reconcile merged work rather than implement it again

`70fcad8` is an ancestor of `main`. Its bundled-palette tests, rendered
`theme-layout-matrix.spec.ts`, CI artifact retention and
[manual matrix](../architecture/theme-layout-review-matrix.md) are present.
The [US-33.3 record](us-33.3-verification-2026-10-19.md) records a historical
119-case full browser pass, but still opens with "No commit, merge or push yet".
The epic, roadmap and todo inherited that stale pre-commit state.

Update them to distinguish implemented/merged work from completion-record
reconciliation. Do not schedule another theme/layout implementation, claim a
current browser pass, or infer a missing user confirmation from git ancestry.
Historical evidence remains unchanged.

### US-34.1: retain, with concrete chat-domain and snippet scope

`apps/backend/asterism/domains/chat/search_index.py` still returns Python lists
and sets from all matching FTS rows. `chat/search.py` applies project/General
filters afterwards using match-sized `IN` lists before counting and paging.
Its `_enrich_page` also fetches one message snippet per selected chat without a
title match. Existing owner/pagination tests check semantics, not match-sized
memory/bind counts or bounded snippet query counts.

Keep this story. Replace the ID-result adapter in its owning chat domain with a
small composable SQL contract, apply owner/scope predicates before count/page,
and batch selected-page snippets. Shared `db/queries.py` is already domain-neutral;
do not invent a new search domain or generic framework. Preserve existing
owner checks, FTS literal-term behavior and deterministic mixed ordering.

### US-34.2: extend guards already delivered; separate capacity work

EPIC-38 delivered `knowledge/artifacts.py`, injected `knowledge/sources.py`,
processing-policy ownership and `test_knowledge_domain_boundaries.py`. The latter
already protects settings/knowledge and files/knowledge imports, including
function-local imports. Retain these guards and extend uncovered neutral-query,
agent/retrieval and composition-root contracts; scan nested packages rather than
repeat the same top-level tests.

The one-backend-process/SQLite limitation is already documented in
[overview](../architecture/overview.md#technology-stack). Supported launch paths
still need explicit validation/testing of configurable worker modes. Scope that
enforcement to launch configurations the project controls; arbitrary external
replicas cannot be detected by a local configuration check. Retain a small ADR
for SQLite initialization/FTS, FileStore's local `Path` and process-local jobs,
guards, queues and caches. PostgreSQL partial indexes do not prove whole-database
portability.

Move the existing active-capacity task to **US-34.4**. `chat/jobs.py` retires idle
jobs and permits one active generation per chat, but its job dictionary and
controller attach count have no global admission limit. Idle retirement and
bounded event/connection queues are distinct protections. The separated story
must define capacity units, finite limits, owner policy, overload behavior and
release on every terminal path while preserving reconnect/approval semantics.
This is a split of existing planned capacity work, not distributed execution.

### US-34.3: establish today's baseline, preserve repaired assertions

`authenticated-workspace.spec.ts` already uses the Main configuration region and
Main Agent heading. `new-chat-agent.spec.ts` already checks unavailable bindings,
a controlled picker, explicit replacement selection and disabled save. The
original two selector-fix tasks should not be planned as undone code changes.

Reframe the story around a full current-tree isolated run and evidence-based
repair. Include EPIC-38's extraction map, statuses and regeneration-only caption
contract. For example, `file-manager-knowledge.spec.ts` uses the current
`extractions` map but its `processing_profile_identity: "default"` does not meet
the API's 64-character field constraint. This is a source-visible fixture gap,
not a browser failure reproduced by this audit. Follow-up US-38.6 removes the
unused artifact fingerprint and contract-version fields from storage/API/fixtures;
this particular fixture finding is therefore superseded by the smaller contract.

Historical US-32.2/33.3 full passes precede the current tree. The recent handoff
also reported ten failures on both compared branches, with no clean final E2E
pass for EPIC-38. Preserve these as distinct historical observations; neither
proves today's pass/failure count. Run once with disposable storage, `CI=1` and
`--retries=0`, classify actual failures and preserve owner, provenance, model,
revocation and accessibility assertions. Equal failure counts are not a pass.

### US-35.1: narrow to residual coverage, copy and inventory

`admin-settings/lazy-sections.tsx` already marks Groups, Users, Image Generation,
Code Execution and Export as Planned. Each pane has a future-release explanation;
`SettingsCard` renders its badge. `lazy-sections.test.tsx` verifies the corrected
Code Execution label and its badge, but does not exhaust all five planned panes.
The architecture guide already distinguishes current versus planned surfaces.

Retain the existing presentation. Finish complete pane/navigation coverage,
remaining capability copy and the root/frontend README inventory. In particular,
the Users pane says role-based access control is planned, although admin/user
authorization and a backend user lifecycle already exist; describe the missing
management surface rather than imply authorization is absent. No new admin APIs
or placeholder feature implementation belongs in this cleanup.

### US-35.2: retain, make execution and provisioning decisions explicit

The registered schema has no separate persona model. `user/service.py` provisions
the singleton main agent; `agent_profiles` represents agent configuration, not
personas. `PromptComposer` accepts an optional profile layer, while
`chat/execution_context.py` and `agent/agent.py` currently pass
`user_profile_id=None`. These extension points do not satisfy the persona/default
invariant.

Keep the story, but require the ADR to settle chat selection versus user default,
selected-profile deletion, edit/default races and pending execution semantics.
Provision user, main agent and initial persona atomically; enforce at-least-one
and exactly-one-default at service/DB boundaries. Persist server-owned persona
identity/revision and prompt input with execution/provenance, with explicit
new-turn/resume/regeneration/delegation behavior and owner reauthorization.
Profile text cannot grant capabilities. Preserve file/model/delegation ceilings;
long-term memory and automatic reads/writes remain separate future work.

### EPIC-36 and EPIC-37: merged implementation, tracking reconciliation

`f41d01b` (generation lifecycle) and `6b123f8` (file correctness) are ancestors of
`main`. Their regression suites and implementations are present. No additional
implementation gap was established for these stories. Keep completion/archive
reconciliation separate from implementation; no new confirmation is inferred.
EPIC-36's old `extraction/retention.py` path and files-owned representative-query
wording are corrected to EPIC-38's `knowledge/retention.py` and published
`knowledge/artifacts.py` service. EPIC-38 remains confirmed complete.

## Verification and limits

Executed against the current implementation:

- Backend search, knowledge boundaries, chat jobs and prompt composition:
  **41 passed** through the configured test wrapper.
- Frontend lazy admin sections and SettingsCard: **7 passed** in two files.
- Generation lifecycle and file-correctness regressions: **16 passed**.
- Changed Markdown: Prettier, local link-target and checklist synchronization
  checks; `git diff --check` and workspace-task validation.

The reassessment itself changed no runtime, schema, generated client or test
source. The subsequent, separately authorized US-38.6 cleanup is implementation
work with its own verification record in EPIC-38. Full lint/types,
full unit/integration suites, browser E2E, builds and hosted CI were not rerun for
this planning-only audit. Focused semantic tests do not establish load bounds or
whole-application accessibility. Verification used disposable test storage and
did not reset working data.

## Next work

Start the revised US-34.3 baseline first, then US-34.1, US-34.2 and US-34.4.
US-35.1 is a small independent cleanup that can be pulled forward after the
browser baseline; US-35.2 follows its ADR decisions. Reconcile merged-story
completion metadata separately. The roadmap and live checklist carry the same
revised tasks; no implementation story has been started by this audit.
