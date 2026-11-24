# EPIC-96: Admin policy changes show up without a reload

Status: in progress (2026-11-24). US-96.1 done: `GET /availability`. US-96.2 done: admin saves reach it. Source: user request (2026-11-24): "I enable
memories in admin then switch to user settings, I should not have to refresh the
page to select Use memory."

## Objective

When an admin changes a policy, every screen that depends on it shows the change
without a page reload: in the admin's own tab at once, and in other people's tabs
the next time they look. EPIC-97 builds on this to hide what the admin has turned
off.

Out of scope: pushing changes to other people's open tabs in real time.
Refetching when they look again, using TanStack Query's normal refetch on focus,
is enough.

## Where things stand (verified 2026-11-24)

- The shared `MutationCache` (`apps/frontend/src/app/providers.tsx:15-26`,
  `src/lib/mutation-cache.ts:37-52`) invalidates the keys listed in the mutation's
  `meta.invalidates`. With no `meta`, it invalidates every query. It never touches
  data from a server layout.
- **Root cause of the memory example.** The User Settings "Use memory" checkbox
  (`features/memory/components/memory-sections.tsx:45,56-57`) reads
  `useUser().settings.memory_allowed`.
  - That value comes from `DashboardLayout`, a server component that calls
    `getCurrentUser()` (`features/dashboard/components/dashboard-layout.tsx:23,35`,
    `features/auth/server/session.ts:27-53`).
  - Switching settings tabs is a soft `router.replace`, so the layout is not
    rendered again.
  - The admin memory save (`admin-settings/memory-policy-settings.tsx:59-73`)
    invalidates `memoryAvailabilityQueryKey` and `userSettingsGetQueryKey`. No
    client query uses `userSettingsGetQueryKey`, and the save never calls
    `router.refresh()`.
  - The result: the availability notice under the checkbox updates, but the
    checkbox stays disabled.
- The same bug affects canvas. `canvas_allowed` is read from `useUser()` in
  `user-settings/general-settings.tsx:130-144` and in
  `chat/components/chat-session.tsx:441`.
- The tool allowlist save (`admin-settings/tools-settings.tsx:40-46`) invalidates
  only `appToolSettingsGetQueryKey`. The agent form's `toolsGetActiveOptions`
  (`user-settings/agent-profile-form.tsx:168`) keeps the default 10-minute
  `staleTime`.
- The image generation policy save invalidates only
  `imageGenerationAvailabilityQueryKey`. That is correct for the "+" menu, but
  nothing else.
- On the backend, `get_user_settings` computes `canvas_allowed` and
  `memory_allowed` fresh on every call (`domains/settings/service.py:146-151`).
  No policy is cached server-side, so this is a frontend-only bug.
- `mutation-cache.test.ts` covers the cache rules. No test covers
  `router.refresh()` or whether `UserProvider` is fresh after an admin save. The
  memory policy test mocks the unused key, so it cannot catch the bug.

## Decisions

- **Policy-derived values come from a TanStack query, not the server layout.**
  The layout keeps identity: name, email, role and group. Everything that answers
  "may I use X" (`*_allowed` and `*_available`) moves to one client query.
- **One availability endpoint.** Add `GET /availability`, owner-only and
  computed live with the existing checks:
  - `memory.policy`
  - `canvas.policy.read_policy` (fixing `canvas_allowed`, which reads the raw
    setting row)
  - `image_generation.policy.availability`
  - `skills.policy`
  - `chatgpt.policy`
  - delegation (`agent.service`)
  - the user's active tools

  It returns `{feature: {available, reason}}`. The existing per-feature endpoints
  stay for their detailed views. EPIC-97 reads this endpoint everywhere.

- **Admin policy saves name what they invalidate.** Each admin policy mutation
  lists `availabilityQueryKey` plus its own keys in `meta.invalidates`. Saves with
  no `meta` keep invalidating everything. A test checks that every admin settings
  mutation reaches the availability query.
- **Focus refetch is enough for other people.** The availability query uses a
  short `staleTime` (30s) and refetches on window focus.

## User stories

Suggested order: US-96.1 → 96.2 → 96.3.

### US-96.1: One availability query

As a user, what I may use is always current.

- [x] Add `GET /availability`, built from the existing policy checks with no new
      policy logic. Tests: each feature's available and unavailable reasons,
      group-limited policies, and owner-only access. Regenerate the client.
- [x] Add a frontend `useFeature()` hook over the generated query
      (`staleTime` 30s, refetch on focus).
- [x] Move `memory_allowed` and `canvas_allowed` readers (`memory-sections.tsx`,
      `general-settings.tsx`, `chat-session.tsx`) to the hook. Remove those fields
      from `GET /settings/user`, since the frontend and backend ship together.
- [x] Unit tests: the memory checkbox enables after the availability query is
      invalidated, without a new `UserProvider` value.

### US-96.2: Admin saves invalidate what depends on them

As an admin, a policy I change is reflected on the next screen I open.

- [x] Give every admin settings mutation (memory, canvas, skills, ChatGPT plans,
      image generation policy and provider, tools, groups, providers and models,
      captioning) `meta.invalidates` that includes the availability key and the
      keys of the user-facing queries it affects, such as
      `toolsGetActiveOptions` and `skillAvailabilityOptions`. Or leave it on
      global invalidation where that is deliberate.
- [x] Remove the dead `userSettingsGetQueryKey` invalidation.
- [x] A test lists the admin settings mutations and fails if one neither reaches
      the availability query nor uses global invalidation.

### US-96.3: End-to-end check

- [ ] Playwright: an admin turns memory on, switches to User Settings → Your
      Asterism, and can tick "Use memory" without a reload. Repeat for canvas
      and the tool allowlist (the agent form's tool picker).
- [ ] Playwright: a second user's tab shows the change after it regains focus.
- [ ] Update `docs/architecture` where the user context is described, and add a
      Behavior line in the release notes.

## Open questions

1. Should `GET /availability` also return per-model availability, or stay
   feature-only? The proposal is feature-only, because `GET /chat/models` already
   carries `available`.
