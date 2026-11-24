# EPIC-102: Setup walkthrough follow-ups

Status: proposed (2026-11-24). Source: user review of the EPIC-101 install flow
(2026-11-24):

1. After the provider step, the first-run checklist doesn't show that more setup
   follows.
2. In the walkthrough, Next and Skip for now do the same thing and differ only
   in the chip they leave. Should Next save changes before moving on?
3. Theme, Educators and First backup don't belong in setup.

Builds on [EPIC-101](EPIC-101-GUIDED-INSTALL.md).

## Objective

- The first-run card shows the whole path.
- Next and Skip for now mean different things, and the admin can see the
  difference.
- The walkthrough covers only settings that affect what people can do on day
  one.

Out of scope: changing what any setting does; the `setup` command (US-101.1);
guarding browser navigation away from an Admin Settings pane with unsaved edits.

## Where things stand (verified 2026-11-24)

- **The first-run checklist has three fixed steps.**
  - The steps are account, provider and first chat
    (`features/auth/components/setup-steps.tsx:28-41`).
  - After the provider step, `ProviderSetupStep` sets `current = 2`
    (`features/setup/components/provider-setup-step.tsx:77`), so "Start your
    first chat" is highlighted.
  - The card itself offers **Continue setup** first (`setup-ready-step.tsx`),
    and the checklist never mentions that step.
- **Next and Skip only record a state.**
  - `finish(step, "done" | "skipped")` in
    `features/setup/components/setup-walkthrough.tsx:85-99` stores the state and
    moves on. Neither button touches the pane below it.
  - The only guidance is the hint "Save any changes below before choosing Next."
    Unsaved edits are silently lost on either button.
  - Both states count as reviewed: `nextStep` never revisits a skipped step. The
    chips read "Done" and "Skipped", and the summary groups them as "Reviewed"
    and "Skipped".
- **Each pane keeps its own draft and Save button.** Panes with a draft:
  - Providers (one combined Save bar, `providers-tab.tsx:822`)
  - Groups (a Save form for each group's access, plus rename)
  - Usage time zone
  - Tools (save bar)
  - Skills, canvas, memory, study chat and ChatGPT (`BooleanAdminPolicySettings`:
    a draft switch and a save bar)
  - Image generation (generator form and availability form)
  - Compaction (save bar)

  Captioning saves each choice as it is made, with one exception: choosing
  "provider" before picking a vision model leaves a draft that can't be saved.
- **Steps to remove.**
  - `theme_editor` and `educators` are Admin Settings steps.
  - `backup` is the only `standalone` step and the only one with a `guideHref`;
    `SetupBackupStep` is its pane.
  - Status already shows the last backup. The `setup` command and
    `docs/deployment.md` already explain keeping `SYSTEM_KEY`.
  - `lazy-sections.test.tsx` requires every Admin Settings section to be a step
    or to be listed in `NOT_STEPS`.
- **Stored progress needs no migration.** The backend accepts any step id that
  matches its pattern (`domains/setup/service.py:31`). Entries for removed ids
  stay in `setup_progress` and are ignored, because the walkthrough and the
  summary count only `SETUP_STEPS`.

## Decisions

- **Next saves, then continues.**
  - When the pane has unsaved edits, the button reads **Save and continue**. It
    saves them with the pane's own save action, then records the step as done.
  - When nothing is unsaved, it reads **Next** and only records the step.
  - If a save fails, the step stays open, the pane shows its usual error, and
    nothing is recorded.
  - A draft that can't be saved blocks the button and says why, for example
    captioning set to "provider" with no vision model.
  - The hint "Save any changes below…" goes.
- **Skip for now keeps nothing.**
  - It leaves the step for later without saving.
  - With unsaved edits it first asks, in the existing `ConfirmationDialog`:
    "Discard your changes to <step>?" Confirming discards the draft and records
    the step as skipped.
  - The same prompt appears before opening another step from the step list while
    edits are unsaved.
  - Changes saved earlier with the pane's own Save button stay saved.
- **The chips say what happened.** "Done" becomes **Reviewed**, matching the
  summary group. "Skipped" stays. The stored states stay `done` and `skipped`.
- **How panes report a draft.**
  - The walkthrough provides a small context. A pane form calls
    `useSetupDraft({ dirty, save, discard, blocked? })`, where `save` returns a
    promise.
  - Outside the walkthrough, the hook does nothing, so Admin Settings behaves
    exactly as it does today.
  - A pane with several forms registers each form that holds a draft. Groups,
    for example, registers each group's access form and the rename form.
  - The "new group" field is an action, not a draft: Next does not create a
    group.
  - Panes keep their own Save buttons. They are the same components as in Admin
    Settings.
- **Trim the steps.**
  - Move `theme_editor`, `educators` and `backup` out of `SETUP_STEPS`.
    `theme_editor` and `educators` go into `NOT_STEPS` with their reasons:
    - "Appearance; people choose their own theme."
    - "Approved later, when someone needs to run classes."
  - Delete `SetupBackupStep`, the `standalone` field and the `guideHref` field.
    Backup was their only user.
  - The walkthrough then has 12 steps: providers through compaction.
- **The first-run checklist shows four steps.**
  1. Create the administrator account
  2. Add a model provider
  3. Review the remaining settings (optional): "Groups, tools, captioning and
     more. Skip any of them and return later from Admin Settings → Setup."
  4. Start your first chat

  On the ready card, step 3 is current, because **Continue setup** is the
  primary action there. Choosing **Start chatting** leaves step 3 unreviewed,
  and Admin Settings → Setup still offers it.

  The step 3 description and the ready card's copy name areas from
  `SETUP_STEPS`, so the two can't drift.

## User stories

Suggested order: US-102.1 → 102.2 → 102.3 → 102.4. Work one story at a time.

### US-102.1: Remove theme, educators and first backup from setup

- [x] Remove `theme_editor`, `educators` and `backup` from `SETUP_STEPS`, and add
      the first two to `NOT_STEPS` with reasons.
- [x] Delete `SetupBackupStep`, the `standalone` and `guideHref` fields, and the
      backup branch in `setup-walkthrough.tsx`. Update `lazy-sections.test.tsx`.
- [x] Test: an installation whose stored progress includes the removed ids still
      shows "N of 12 steps reviewed" and the correct summary.
- [x] Update `e2e/setup-walkthrough.spec.ts` for the shorter list.

### US-102.2: First-run checklist shows the rest of setup

- [x] Change `SetupSteps` to four steps, with "Review the remaining settings
      (optional)" third. The sign-up card shows step 1 current; the provider
      card shows step 2; the ready card shows step 3.
- [x] Build the step 3 description and the ready card's "such as …" list from
      `SETUP_STEPS` titles.
- [x] Unit tests for each card's current step and its screen-reader text
      ("current", "complete"). Update `e2e/first-run-setup.spec.ts` and
      `provider-setup.spec.ts`.

### US-102.3: Next saves, Skip discards

- [x] Add the setup draft context and the `useSetupDraft` hook (a no-op outside
      the walkthrough).
- [x] Register drafts in each pane listed under "Where things stand", including
      the captioning case that can't be saved.
- [x] Walkthrough:
  - Save and continue / Next.
  - A failed save keeps the step open.
  - A blocked draft shows its reason.
  - Skip and step-list navigation ask before discarding.
  - The "Reviewed" chip.
  - The old hint is removed.
- [x] Unit tests: Next saves a dirty boolean policy, then records done. A failed
      save records nothing. Skip with a draft asks, and Cancel keeps the draft.
      Skip without a draft records skipped with no prompt. Admin Settings panes
      are unchanged outside the walkthrough.
- [x] Playwright: change the time zone and choose Save and continue, then reload
      Admin Settings → Usage and see the saved value. Toggle Skills and choose
      Skip for now → Discard, and the policy is still off.

### US-102.4: Docs and release notes

- [ ] Update `docs/guide/08-for-administrators/first-time-setup.md`: the
      four-step checklist, Save and continue versus Skip for now, and the shorter
      step list. Refresh its screenshots (`pnpm docs:check`). Point to Theme
      editor, Educators and backup docs from their own pages.
- [ ] Update `docs/deployment.md` §5 if it lists the walkthrough steps.
- [ ] Release notes, under Behavior: setup's Next saves unsaved changes, and Skip
      asks before discarding them; theme, educators and first backup are no
      longer setup steps.

## Open questions

None. Next saving changes is the recommended answer to the user's question. If
the user prefers, Next could instead stay disabled until the pane's own Save is
used. That alternative needs no draft context, but it keeps two buttons for one
intent.
