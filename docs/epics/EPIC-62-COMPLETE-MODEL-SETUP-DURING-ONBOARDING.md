# EPIC-62: Complete model setup during onboarding

Status: proposed (2026-11-01). Source: user feedback after EPIC-48.

## Objective

Let the administrator finish model setup in the first-run setup card, so they do
not have to visit Admin settings → Providers afterwards.

Today the "Enable models" step of first-run setup (EPIC-48, US-48.1) enables the
chosen models and sets the default model. Two settings still have to be made
in Admin settings → Providers:

- **The draft model.** This is the admin-level model for background tasks such
  as chat titles (`llm/draft.py`, `chat/title_model.py`). Without a usable draft
  model, titles fall back to the chat's own model.
- **Vision and tool support for each model.** Discovery often leaves
  `supports_vision` and `supports_tools` unknown, especially for
  OpenAI-compatible providers, and Asterism never infers them from model names
  ([LLM providers](../architecture/llm-providers.md)). Only an explicit `true`
  allows image input, tool schemas and the internal tools (`sub_agent`,
  `search_knowledge`). A model left unknown after onboarding therefore cannot
  use tools, even when it supports them.

## Ownership and delivery

Frontend-led, in `features/setup/components/provider-setup-step.tsx`. Reuse the
existing APIs through the generated Hey API client and TanStack Query:

- the provider settings update (`appProviderSettingsUpdate`) for
  `draft_model_id`, preserving the providers just saved;
- the model update (`appProviderModelUpdate`) for capabilities and their source.

Add no new storage or routes. The step stays admin-only and skippable, and
keeps its current error, retry and reload behaviour. The Providers settings page
stays the place for later changes. It should show exactly what onboarding saved,
including capability sources.

## US-62.1: Choose the draft model during setup

As the administrator of a new instance, I want to pick the model for background
tasks such as chat titles while I set up my first models.

Estimate: 0.5 day. Dependencies: EPIC-48.

Acceptance:

- Next to **Default model**, the enable-models step shows **Draft model**, a
  select limited to the models enabled in this step. A short description says
  what it is used for and suggests a small, fast model.
- It starts on the chosen default model and follows the default until the
  administrator changes it. If the chosen draft model is disabled again in the
  step, it falls back to the default model.
- **Continue** saves the draft model together with the enabled models and the
  default. If saving fails, the step shows the existing retry error and keeps
  every choice. **Skip for now** saves nothing.
- Admin settings → Providers shows the chosen model as the draft model, and the
  first chat gets a title from it.
- Keyboard, screen-reader, narrow and short-viewport behaviour matches the rest
  of the setup card, in every theme.

- [ ] Add the draft-model select and its defaulting rules to the enable-models step.
- [ ] Save `draft_model_id` through the provider settings update without changing the saved providers.
- [ ] Add unit and isolated browser tests (default follows, fallback, failure and retry, skip).

## US-62.2: Confirm vision and tool support for enabled models

As the administrator, I want to confirm whether each model I enable supports
images and tools, so that features needing them work right after setup.

Estimate: 1 day. Dependencies: EPIC-48.

Acceptance:

- Each model the administrator enables shows **Vision** and **Tools**
  checkboxes beside it. They start checked when discovery reported support and
  unchecked otherwise.
- A capability that discovery left unknown is marked "Unknown". A one-line note
  says that only checked capabilities are used, and that tools are needed for
  sub-agents and project file search.
- On **Continue**, a capability the administrator changed is saved as a manual
  value (`true` or `false`, source `manual`). One left untouched keeps its
  discovered value and source. An unknown one left unchecked stays unknown, so
  later discovery can still fill it. This matches the Providers page, where
  unknown and "Not supported" are different.
- Discovered capability badges (US-46.3) stay visible, so the administrator can
  see where a value came from.
- Unchecking a model removes its capability choices. Re-enabling it starts from
  the discovered values again.
- Saving uses the existing model update for each enabled model. Errors and
  retry behave as they do today, and the choices are kept.
- After setup, Admin settings → Providers shows the same values and sources.
  A model with tools checked can use them in the first chat.
- The checkboxes have accessible names that include the model, such as "Vision
  for gpt-4o". Keyboard, narrow (320px) and short-viewport behaviour fits the
  card without horizontal scrolling.

- [ ] Add per-model Vision and Tools checkboxes with unknown marking and the explanatory note.
- [ ] Save changed capabilities as manual values and keep untouched ones with their sources.
- [ ] Add unit and isolated browser tests (discovered, unknown, changed, re-enabled, failure, accessibility).

## Out of scope

- Context-window entry during setup. It stays on the Providers page.
- Inferring capabilities from model names. This remains disallowed.
- Changes to standard-user onboarding or the Providers settings page.
