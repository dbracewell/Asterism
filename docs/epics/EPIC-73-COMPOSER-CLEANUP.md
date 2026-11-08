# EPIC-73: Composer cleanup

Status: proposed. Source: user request (2026-11-08).

## Objective

The chat composer has grown a control for each feature: attachments, prompt
templates, prompt coach and help in the input; and below it the model picker,
compare, persona, learning mode, goal and rubric pickers, plus context usage and
connection status. Reduce it to a clean input with the few controls used every
turn, and move the rest into a menu or the row at the top of the composer next
to the skill chips.

## Ownership and delivery

- Frontend only; no API changes expected.
- Proposed layout (confirm in US-73.1 before building):
  - **Top row** (with the skill chips): compact chips for the active model,
    persona and learning mode; goal and rubric chips when they apply. Each chip
    opens its existing picker. Empty states stay hidden.
  - **Input row**: attach, text box, send/stop.
  - **"+" / options menu**: prompt templates, prompt coach, compare models,
    skills (slash discovery), canvas (when EPIC-72 lands), help.
  - Context usage and connection status move into a small status indicator.
- Keep everything reachable by keyboard and screen reader; existing slash
  commands and shortcuts stay. Mobile and 320px short-height layouts from
  US-40.4 must not regress.

## US-73.1: Layout proposal

As a user, I want to agree on the new composer before it's built.

Estimate: 0.5 day. Dependencies: none.

Acceptance: a mockup of the desktop and mobile composer, with every current control
placed, approved by the user.

- [ ] Inventory every composer control and when it shows; produce the mockup; get approval.

## US-73.2: Rebuild the composer

As a user, I want a calm composer that still lets me reach every option.

Estimate: 2 days. Dependencies: US-73.1.

Acceptance: the approved layout using shadcn/ui components (DropdownMenu,
Popover, Badge). All existing pickers work from their new places. Keyboard, touch,
contrast and the 320px checks pass. Help (`composer.controls` and the chat guide) is updated.

- [ ] Implement the layout; update help.
- [ ] Update unit tests and the composer-related E2E specs (chat reachability, mobile shell, prompt coach, templates, comparison, slash skills).
