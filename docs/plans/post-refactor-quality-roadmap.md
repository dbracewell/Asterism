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

EPIC-34 is confirmed complete. US-34.1 keeps indexed matching and owner/workspace
scope in SQL before pagination; US-34.2 enforces architecture and single-process
deployment guards; US-34.3 restored the browser baseline. US-34.4 merged locally
as `fdcef51`, adding finite global/per-owner work and controller admission with
retryable overload and reconnect-safe release. See its
[verification](../reviews/us-34.4-verification-2026-10-24.md) and
[capacity decision](../adr/0020-chat-capacity-admission.md).

US-35.1 is confirmed complete on 2026-10-24, with commit and local merge
authorized by the user. The existing five Planned badges and explanations remain. Users copy
now distinguishes real authorization/backend lifecycle from future management
screens, and coverage checks keyboard access, complete label/badge visibility and
available-pane discoverability. The current-versus-planned inventory is in the
[product guide](../architecture/frontend-and-themes.md#current-versus-planned-product-surface)
and all three READMEs. See [verification](../reviews/us-35.1-verification-2026-10-24.md).

US-35.2 is implemented and verified, with completion and local merge authorized
on 2026-10-24. EPIC-35 is confirmed complete. Owned persona CRUD/defaults, chat selection and immutable
execution inputs are separate from agent configuration and future memory. See
[ADR-0021](../adr/0021-personas-and-execution-binding.md).

## Recommended sequence

1. Reconcile the already-merged US-36.1 and US-37.1 completion records; do not
   repeat their implementations. Reassess the roadmap before choosing new work.

Only one user story is implemented at a time. EPIC-35 is confirmed complete;
no new story has been started.

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
use the completed browser baseline and the persona binding ADR. Capacity policy is an explicit decision in US-34.4, not a claim of load
certification. Do not fold speculative horizontal scaling, PostgreSQL/MySQL,
object storage or long-term memory into these stories.

For every implementation story: branch, update the checklist, complete relevant
lint/type/format/unit/integration/browser gates, synchronize API clients when
contracts change and obtain completion confirmation before merge. Use disposable
verification storage; do not reset the working database or add migrations,
compatibility shims or legacy fallbacks. Report failures, skips, retries and
unhandled errors separately from clean passes.
