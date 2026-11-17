# EPIC-82: Code cleanup and deduplication

Status: in progress. Source: [codebase review](../../codebase_review.md), verified 2026-11-14 (items 18, 19).

## Objective

Remove duplicated utilities and dead code, and split the largest components.

## User stories

### US-82.1: Shared utilities

- [x] Merge `features/sse/lib/rate-limiter.ts` into `lib/rate-limit.ts` (`createRateLimiter`); update the route and tests. (They are not identical copies.)
- [x] One `errorDetail` in `@/lib/utils` beside `isErrorDetail`; replace the 17 local definitions and the cross-feature imports of `features/classes/error-detail.ts`. (Done with `errorDetail` plus `errorMessage` for callers that show a thrown `Error`'s message first; `studyErrorDetail` folded in too.)
- [x] Replace the raw radio inputs in `captioning-settings.tsx` with `@/components/ui/radio-group`.

### US-82.2: One boolean admin policy panel

- [ ] Share one `BooleanAdminPolicySettings` among the ChatGPT, canvas and skills policy panels (about 410 lines now); keep their tests passing.

### US-82.3: Dead code and small leaks

- [x] Delete `use-clickoutside.ts`, `formatURL`, the `chat-session:scroll` event and `useSubscribeEventState` (with its `console.log`).
- [x] `chatgpt/service.py`: replace `defaultdict(asyncio.Lock)` with a `WeakValueDictionary`, as in `files/produced.py`.

### US-82.4: Split oversized components

- [ ] Extract hooks and subcomponents from `chat-session.tsx` (1,099 lines), `provider-setup-step.tsx` (1,059) and `chat-input.tsx` (1,015); one component per story step, no behavior change.

## Notes

Not in this epic: the review's `_parse_csv_list` duplicate (not found in the code).
