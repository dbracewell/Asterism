# EPIC-48: First-run provider setup

Status: proposed. Source: user feedback on the first-run setup screen
(2026-10-30).

## Objective

Carry the first-run setup screen through its second step. Today the setup card
lists three steps, but only step 1 (create the administrator account) happens
there: after sign-up the administrator lands on the new-chat page with no
models, and has to find Admin settings → Providers on their own. Step 2 should
look and feel the same as step 1, in the same card, immediately after the
account is created.

## Ownership and delivery

Frontend-led. Reuse the existing provider APIs (provider settings update,
model discovery/sync and model activation) through the generated Hey API
client and TanStack Query; add no new storage. The step is admin-only and
keeps the existing admin permission checks. It is skippable: setup must never
trap the administrator.

## US-48.1: Add a model provider during setup

As the administrator of a new instance, I want to connect a model provider
right after creating my account, on the same setup screen, so I can reach my
first chat without hunting through settings.

Estimate: 1.5 days. Dependencies: EPIC-45 (setup screen), US-46.3 (provider
identity).

Acceptance:

- After the administrator account is created, the same setup card (logo,
  wordmark, step list) shows step 1 as complete, step 2 as the current step
  (`aria-current="step"`), and a provider form in place of the account form.
- The form offers the provider type (OpenAI or OpenAI-compatible, with the
  US-46.3 provider icons), name, base URL (fixed for OpenAI) and API key, and
  validates the same way as Admin settings → Providers.
- Saving connects the provider and discovers its models. The administrator then
  enables at least one model and may set it as the default; models show the
  US-46.3 capability badges. Discovery failures show a clear error with retry
  and keep the entered values.
- "Skip for now" goes to the new-chat page. The step is shown only to an
  administrator on an instance with no active models, so later sign-ins and
  standard users never see it; reloading during the step returns to it.
- Completing the step marks step 2 complete and continues to the new-chat page
  (step 3), where the chosen model is selected.
- Keyboard, screen-reader and narrow/short-viewport behaviour matches the
  existing setup and sign-in checks, in every theme.

- [ ] Add the setup step state and routing (admin, no active models, skip).
- [ ] Build the provider form step from the shared provider schema and the provider/capability identity components.
- [ ] Wire discovery, model enablement and default selection; handle failures and retry.
- [ ] Add unit and isolated browser tests, including skip, reload, failure and reachability.

Open question: should step 3 also get an in-card moment (for example a "You're
ready" confirmation with a suggested first prompt), or is landing on the
new-chat page enough?
