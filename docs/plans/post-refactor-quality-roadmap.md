# Post-refactor quality roadmap

Reassessed 2026-10-24 against `main` at `1e188a7`. Source: the
[original 2026-10-17 review](../reviews/2026-10-17-codebase-review.md) and the
[current-source assessment](../reviews/2026-10-24-open-epics-reassessment.md).
The live checklist is [`todo.md`](../../todo.md); completed history remains archived.

## Current state

EPIC-31 and EPIC-32, US-33.1/33.2 and US-38.1 through US-38.5 are confirmed
complete. US-38.6 is confirmed complete and merged on 2026-10-24, together with
this epic reassessment. It retains generation-based artifact reuse and
policy fingerprint change detection while removing unused artifact metadata.
US-33.3 is implemented and merged (`70fcad8`); its [completion reconciliation](../reviews/us-33.3-completion-reconciliation-2026-10-24.md) was confirmed on 2026-10-24, completing EPIC-33.
US-36.1 (`f41d01b`) and US-37.1 (`6b123f8`) are implemented and merged too;
reconcile their completion/archive records rather than reimplement them. This
audit does not invent missing user confirmations. EPIC-38's published artifact
service, injected source reader, processing-policy ownership and boundary tests
are the baseline for future work.

EPIC-34 remains necessary: search still materializes all matching IDs before
scope/pagination, and global active-chat/controller admission is absent.
EPIC-35.1 is partly delivered: all five unfinished admin panes already have
Planned badges and future-release descriptions. US-35.2 remains substantive new
work; optional profile/prompt/namespace types do not constitute a persona engine.

## Recommended sequence

1. **US-34.3 — Current browser baseline and contract reconciliation.** Run the
   full isolated suite on the current tree, classify actual failures, and repair
   demonstrated drift. The old Main Agent/unavailable-picker assertions are
   already repaired. Check current knowledge extraction/status/regeneration
   contracts as well as agent/model flows. Historical 72/119-case passes and
   a later handoff's equal failure sets do not establish today's gate status.
2. **US-34.1 — Bound indexed search in SQL.** Retain chat-domain ownership,
   owner/project/General filtering before count/page queries, deterministic mixed
   ordering and page-only batched snippets. Existing page/scope tests are not
   evidence of bounded match-sized memory or bind counts.
3. **US-34.2 — Finish architecture/deployment enforcement.** Extend existing
   guards rather than repeat EPIC-38. Enforce supported single-worker launch
   configuration and document storage/coordination seams honestly.
4. **US-34.4 — Bound active work and controller admission.** This separates the
   capacity task formerly buried in US-34.2. Idle-job retirement and bounded
   per-connection queues do not cap simultaneous jobs/connections. Decide finite
   capacity/overload policy, implement it and verify capacity release.
5. **US-35.1 — Finish planned-settings coverage and inventory.** Preserve the
   implemented Planned presentation; finish coverage/copy and README inventory.
   This small independent story can be pulled forward after the browser baseline.
6. **US-35.2 — Persona/default-profile foundations.** Decide selection and
   execution snapshot semantics before implementation. Preserve singleton
   main-agent, fixed sub-agent models and scope ceilings. Do not activate memory.

Only one user story is implemented at a time. This reassessment changes planning
documents only and does not start US-34.3 or any other implementation story.

## Scope and ownership

- [EPIC-33](../epics/EPIC-33-THEME-CONTRAST-AND-UI-CONSISTENCY.md): existing
  theme/semantic/layout gates; confirmed complete, with completion records
  reconciled on 2026-10-24.
- [EPIC-34](../epics/EPIC-34-QUERY-BOUNDS-AND-ARCHITECTURE-GUARDRAILS.md):
  chat-domain search composition, additional architecture/deployment guards,
  current browser contracts and bounded active chat/controller admission.
- [EPIC-35](../epics/EPIC-35-PRODUCT-SURFACE-AND-PERSONA-FOUNDATIONS.md):
  remaining planned-settings work and separate persona foundations. The
  `agent_profiles` table remains agent configuration, not user personas.
- [EPIC-36](../epics/EPIC-36-KNOWLEDGE-GENERATION-LIFECYCLE.md),
  [EPIC-37](../epics/EPIC-37-FILES-DOMAIN-CORRECTNESS.md) and
  [EPIC-38](../epics/EPIC-38-KNOWLEDGE-PIPELINE-STRUCTURE.md): retain implemented
  generation, file-correctness and knowledge-boundary behavior as regressions.

## Planning and verification rules

The original 26–43 engineer-day estimate included now-completed trust/layout work
and is no longer an estimate of remaining effort. Use the revised story ranges;
re-estimate browser work after the current baseline and persona work after its
ADR. Capacity policy is an explicit decision in US-34.4, not a claim of load
certification. Do not fold speculative horizontal scaling, PostgreSQL/MySQL,
object storage or long-term memory into these stories.

For every implementation story: branch, update the checklist, complete relevant
lint/type/format/unit/integration/browser gates, synchronize API clients when
contracts change and obtain completion confirmation before merge. Use disposable
verification storage; do not reset the working database or add migrations,
compatibility shims or legacy fallbacks. Report failures, skips, retries and
unhandled errors separately from clean passes.
