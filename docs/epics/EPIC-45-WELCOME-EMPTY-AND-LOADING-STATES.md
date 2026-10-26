# EPIC-45: Welcome, empty and loading states

Status: proposed. Source: the approved visual design audit (2026-10-26).

## Objective

Make first impressions and in-between states feel intentional. Today the new-chat
page says "Welcome **Name**" with the name accented on a radial wash, with no
suggested prompts. `Skeleton` is used once, while settings panes show "Loading …"
text. Empty-state copy varies, and the sign-in page is a bare form.

## Ownership and delivery

Frontend only. Suggested prompts come from data the user can already access
(project details, assigned skills); this story adds no new authorization paths.
Empty-state copy follows the frontend-design writing guidance: plain verbs,
sentence case, and a clear next action.

## US-45.1: New-chat hero

As a user, I want the new-chat page to help me start.

Estimate: 1 day. Dependencies: EPIC-41.

Acceptance: the accented-name greeting and the radial wash are removed. The
constellation draws itself in once per session (static under reduced motion).
Project context is shown when present, and up to four suggested prompts come from
the project's description or the user's assigned skills. Choosing a suggestion
fills the composer without sending.

- [ ] Rebuild the hero in `app/(main)/page.tsx`; add the suggestion sources; test with a project, without one, and with no skills.

## US-45.2: Skeletons for loading

As a user, I want loading screens that preview the layout that's coming.

Estimate: 1 day. Dependencies: EPIC-41.

Acceptance: settings panes, the project and general lists, and the chat
transcript show skeletons that match their final layout, while keeping
`role="status"` text for screen readers.

- [ ] Add skeleton variants; replace the "Loading …" paragraphs; test that status announcements remain.

## US-45.3: Empty states with a clear next step

As a user, I want an empty screen to tell me what to do next.

Estimate: 0.5 day. Dependencies: none.

Acceptance: every `Empty` usage has a title, one sentence of guidance and a
primary action where one applies, all in one shared copy style.

- [ ] Audit the 61 `Empty` usages; standardize copy and actions; update the tests that assert on copy.

## US-45.4: Sign-in and first-run screens

As a new user or admin, I want a welcoming, branded entry point.

Estimate: 1 day. Dependencies: US-41.1, US-41.2.

Acceptance: the sign-in page has a branded backdrop and wordmark. The install
view shows the steps of first-run setup. The authentication behavior, focus
handling and redirect sanitization from the existing tests are unchanged.

- [ ] Restyle `AuthForm` and the auth layout; keep the existing auth tests passing; update screenshots.
