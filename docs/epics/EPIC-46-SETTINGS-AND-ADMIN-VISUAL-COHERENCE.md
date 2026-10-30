# EPIC-46: Settings and admin visual coherence

Status: in progress (US-46.1 complete). Source: the approved visual design audit (2026-10-26).

## Objective

Make user and admin settings calm and easy to scan. Today nearly every section is
a `Card` (45 usages), themes are picked from a form control, and providers and
models are text-only.

## Ownership and delivery

Frontend only, except optional provider-type icon metadata, which comes from
existing provider types with no new storage. Keep the EPIC-19 lazy pane loading
and the existing permission paths.

## US-46.1: Settings hierarchy

As a user, I want settings grouped clearly without visual noise.

Estimate: 1 day. Dependencies: EPIC-41, US-42.3.

Acceptance: settings panes use grouped sections with headings and dividers, with
cards reserved for distinct objects such as providers and sub-agents. Forms with
unsaved changes show a sticky save bar.

- [x] Add a settings section primitive; migrate the user and admin panes; test the sticky save bar's dirty state.

## US-46.2: Theme gallery

As a user, I want to choose a theme by seeing it.

Estimate: 1 day. Dependencies: US-41.3.

Acceptance: themes appear as live preview tiles (a small mock UI rendered with
each theme's variables). Clicking a tile applies it, and admins can open the
editor from the selected tile.

- [x] Build the preview tile from the theme variables; replace the selector; test selection, keyboard use and admin-only editing.

Implementation notes: `ThemeGallery` (`components/settings/theme-gallery.tsx`)
is a shadcn `RadioGroup` of choice tiles grouped as Light and Dark. Each tile
scopes the theme's CSS variables onto a small `aria-hidden` mock (sidebar, card
and primary/secondary buttons), so the radio's name is the theme name. Arrow keys
move between tiles; the pick applies at once while the setting saves, and setting
updates share a mutation scope so rapid changes land in order. The selected tile
shows an admin-only "Edit … theme" link to
`/settings?t=admin&setting=theme_editor&theme=<id>`, which opens the theme editor
on that theme.

## US-46.3: Provider and model identity

As a user, I want to recognize providers and model capabilities at a glance.

Estimate: 1 day. Dependencies: EPIC-41.

Acceptance: provider-type icons and capability icons (tools, vision, thinking)
appear in the chat model picker, sub-agent model selection and the admin provider
list, each with a text label or tooltip.

- [ ] Add a provider icon map (monochrome, theme-aware) and capability badges; test the labels for accessibility.
