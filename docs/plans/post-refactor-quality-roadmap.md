# Post-refactor quality roadmap

Source: [codebase review, 2026-10-17](../reviews/2026-10-17-codebase-review.md).
US-31.1 is confirmed complete on 2026-10-17 and US-31.2 on 2026-10-18.
US-31.3 is confirmed complete on 2026-10-18, closing EPIC-31. US-32.1, including the reported mobile sidebar/header/scrolling repair, is confirmed complete on 2026-10-18. US-32.2 and US-32.3 are confirmed complete on 2026-10-18, closing EPIC-32. EPIC-33 / US-33.1, including the select-readability follow-up, is confirmed complete on 2026-10-19. US-33.2 is confirmed complete on 2026-10-19, preserving the Montserrat wordmark. US-33.3 is implemented and verified, awaiting completion confirmation on `feat/us-33.3-theme-layout-review-matrix`. Other stories remain proposed/pending.
The live task checklist is [`todo.md`](../../todo.md); completed history remains
archived. This roadmap does not reopen completed refactor/provider epics.

## Recommended sequence

| Order | Stories                   | Reason / dependency                                                                                                                                                     |
| ----- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | US-31.1, US-31.2, US-31.3 | Fix confirmed filesystem traversal/admin authorization, reliable theme persistence, then rich-content trust.                                                            |
| 2     | US-32.1, US-32.2, US-32.3 | Make setup reachable, harden nested settings/file/dialog layouts, then chat content and composer clearance. US-32.3 follows the renderer policy in US-31.3.             |
| 3     | US-33.1, US-33.2, US-33.3 | Correct palette roles, unify labels/status/typography, then enforce a rendered matrix using the hardened layouts.                                                       |
| 4     | US-34.1, US-34.2, US-34.3 | Remove unbounded search candidates, make module/deployment assumptions enforceable and reconcile browser contracts. Retain US-34.3 for explicit contract audit/closure. |
| 5     | US-35.1, US-35.2          | Make placeholder navigation honest, then implement separate persona/default-profile foundations as a product milestone.                                                 |

US-35.1 is a small cleanup that can be pulled forward. US-34.3 tracks the original two
observed full-suite failures. US-32.2 verification reconciled the remaining stale
unavailable-model/picker selectors and recorded [72 passing isolated browser tests](../reviews/us-32.2-verification-2026-10-18.md)
without retries. US-34.3 remains pending explicit contract audit/closure; the suite
is no longer recorded as currently failing.
Only one story is implemented at a time, even where dependencies permit reordering.

## Scope and ownership

- [EPIC-31: Theme and content trust](../epics/EPIC-31-THEME-AND-CONTENT-TRUST-BOUNDARIES.md)
  owns theme authorization, filesystem/storage access and Markdown policy. Theme
  repository logic remains separate from general file upload/knowledge processing.
- [EPIC-32: Responsive layout](../epics/EPIC-32-RESPONSIVE-LAYOUT-AND-REACHABILITY.md)
  owns scroll/reachability and renderer containment. It consumes the approved HTML
  policy; CSS cannot substitute for sanitization.
- [EPIC-33: Theme and UI consistency](../epics/EPIC-33-THEME-CONTRAST-AND-UI-CONSISTENCY.md)
  owns semantic palettes, source mapping, accessible states and visual gates.
- [EPIC-34: Query and architecture guardrails](../epics/EPIC-34-QUERY-BOUNDS-AND-ARCHITECTURE-GUARDRAILS.md)
  owns database-side search composition and enforceable boundaries. Keep domain
  policy out of shared query helpers and do not add generic query frameworks.
- [EPIC-35: Product/persona foundations](../epics/EPIC-35-PRODUCT-SURFACE-AND-PERSONA-FOUNDATIONS.md)
  owns honest navigation and the separate persona invariant. It does not activate
  memory or implement placeholder admin domains without their own feature scope.

## Planning assumptions

Initial total estimate is 26–43 engineer-days including browser-regression repair;
each epic contains story-level ranges. Re-estimate after the first trust-boundary
story and persona ADR. Estimates include relevant tests and documentation, not
external-provider certification or exhaustive assistive-technology evaluation.

Maintain the existing execution/file architecture. Defer horizontal scaling,
PostgreSQL/MySQL adapters, object-storage integration and long-term memory until
there is a specific product requirement. Document their current limits rather
than imply those capabilities exist. Do not reset the working database or add
migrations/legacy compatibility paths during remediation.

For every story: create a feature branch, update the live task status, complete
relevant lint/type/format/unit/integration/browser gates, regenerate clients for
API changes and obtain user completion confirmation before merge. A failed or
retry-dependent run remains distinct from a clean first-attempt pass.
