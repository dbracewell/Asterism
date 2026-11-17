# EPIC-79: Frontend runtime fixes

Status: in progress (US-79.1–US-79.4 done). Source: [codebase review](../../codebase_review.md), verified 2026-11-14 (items 4, 5, 6, 12, 18).

## Objective

Fix user-visible frontend bugs: a broken full-size image, lost admin form edits, throttled
event webhooks, sign-in failures, and needless full-app refetches.

## User stories

### US-79.1: Full-size images load

`APIImage` revokes its `blob:` URL as soon as it is stored, because `fullImageUrl` is a dependency of the effect that created it.

- [x] Fetch with `useQuery` (`enabled: isOpen`, `staleTime: Infinity`); create and revoke the object URL in a separate effect keyed on the data (as in `inline-files.tsx`).
- [x] Reset when `fileId` / `filename` changes.
- [x] Component test: opening shows the image and the URL is revoked only on unmount or change.

### US-79.2: Admin "Test" does not erase unsaved edits

- [x] Add `meta: { skipGlobalInvalidation: true }` to `componentsTestMutation`; `imageGenerationTestMutation` invalidates only the file lists (`meta.invalidates`), since its image is saved to the admin's files.
- [x] Derive `provider` in `ComponentSettings` with `useMemo` instead of syncing state in an effect.
- [x] Test that clicking Test keeps edited values in tools, embedding and image-generation settings.

### US-79.3: System webhooks are not rate limited as one client

- [x] In `POST /api/stream`, do not apply the per-IP limit to requests authorized by the system key.
- [x] Test many system calls without `x-forwarded-for` succeed, and user requests are still limited.

### US-79.4: Sign-in and auth robustness

- [x] `proxy.ts`: keep the query string in `/sign-in?redirect=...`; removed the unreachable `/sign-in` branch; the matcher keeps excluding `/sign-in`, and the page redirects signed-in users (now to the sanitized `redirect`).
- [x] `sign-in/page.tsx`: use `safeParse`, accept a repeated `redirect` without a 500.
- [x] `installApp`: apply the same rate limit as `signUpWithInvite` (one shared per-address `signupLimiter`).
- [x] Optional: `scripts/reset-databases.mjs` without `STORAGE_ROOT`. Done as a clear error and exit instead of a `/storage` default: the script deletes data, so it must not guess a location when run directly.
- [x] Tests for each.

### US-79.5: SSE worker does not reconnect with no tabs

- [ ] `initSSE()` returns when `ports.size === 0`; clear the pending reconnect timer when the last port unloads.

### US-79.6: Pickers and image settings stop refetching the app

- [ ] `image-gen-settings.tsx` save: use `meta.invalidates` instead of manual `invalidateQueries`.
- [ ] Model, persona and learning-mode pickers: add `skipGlobalInvalidation` where `setQueryData` already updates the cache.
- [ ] Test that a picker change does not refetch unrelated queries.

## Notes

Suggested order: US-79.1, US-79.2, US-79.4, US-79.3, US-79.5, US-79.6.
