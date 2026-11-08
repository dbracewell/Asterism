# EPIC-66: Help coverage

Status: in progress (US-66.1 and US-66.2 complete). Source: user request (2026-11-07).

## Objective

EPIC-61 gave every main page help as it was then. Features added since have
little or none. Bring help to every page and concept that lacks it, and add a
check so a new page can't ship without a guide.

## Ownership and delivery

- Same rules as EPIC-61 and [ADR-0032](../adr/0032-in-app-help-content.md):
  frontend-owned, static, typed, describing only implemented behavior, and
  admin-only content shown only to admins.
- Known gaps (2026-11-07):
  - **No page guide:** Classes (it shows the Projects guide), class detail,
    Team packs (shows Projects), the invite signup page, every study page
    (deck, review, drafts, quiz, take, attempt, notes, summary and guide
    generation), Settings → Rubrics (shows General), Admin → Educators and
    Admin → Export (show the overview).
  - **No glossary entries:** class, educator, course, class code, invite, class
    mode policy, class insights, flashcard and deck, quiz and attempt, weak spot,
    topic mastery, reflection, study notes, team pack, settings file.
  - **No inline help:** study sections, reflections, team-pack import and
    export, the classes pages (code, invites, course, policy, insights and the
    consent switch) and settings export and import.
- Help for the redesigned project workspace ships with EPIC-65; this epic covers
  everything else and does a final consistency pass after EPIC-65 lands.

## US-66.1: Page guides for every page

As a user, I want the page help button to explain whatever page I'm on.

Estimate: 1 day. Dependencies: none.

Acceptance: every route in the main app and every settings section maps to a
guide written for it, with no fallback to an unrelated guide. A test walks the
app's route list and settings sections and fails if any lacks a guide, so new
pages must add one.

- [x] Write the missing guides and mappings.
- [x] Add the coverage test over routes and settings sections.

## US-66.2: Glossary and inline help for newer features

As a learner or educator, I want "what is this?" help on the controls I meet in
study tools, reflections, classes and packs.

Estimate: 1.5 days. Dependencies: US-66.1.

Acceptance: the glossary gains the entries listed above, each accurate to
current behavior (for example, insights are thresholded totals, consent is off
by default, class policy only narrows). Inline help triggers sit next to the
main controls on each listed surface, and admin-only entries stay admin-only.
Keyboard, touch and contrast checks pass as in EPIC-61.

- [x] Add glossary entries and inline triggers; review wording for accuracy.
- [x] Extend help tests and the help E2E for the new surfaces.

## US-66.3: Help consistency pass

As a user, I want help that matches what the app does today.

Estimate: 0.5 day. Dependencies: US-66.2, EPIC-65.

Acceptance: every guide and entry is reviewed against current behavior after
EPIC-65; stale text (for example the separate project settings page) is fixed;
the help center lists every entry. The contribution notes repeat that new
features ship with help.

- [ ] Review and fix all help text; update the contribution notes.
