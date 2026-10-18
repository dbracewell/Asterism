# EPIC-33: Theme contrast and UI consistency

Status: proposed / pending. Source: [2026-10-17 codebase review](../reviews/2026-10-17-codebase-review.md), F5, F6.

## Objective

Preserve each theme identity while making semantic roles readable and repeatable.

## Ownership and delivery

Implementation stays within the owning domain/component. Preserve existing authorization, shared mutation-cache invalidation and generated API contracts. Use fresh initialization for schema changes; no migrations, compatibility shims or live-database resets. Work on one story at a time, create its feature branch, complete relevant lint/type/format/test gates, synchronize generated clients when contracts change, document behavior and obtain user confirmation before merge.

## US-33.1: Repair bundled palette mappings and contrast

As a user, I want every bundled theme to provide readable text and recognizable controls.

Estimate: 2–3 days. Dependencies: None for bundled files; custom editing depends on EPIC-31.

Acceptance criteria:

All eight bundled themes pass normal-text paired-role checks at 4.5:1 and rendered critical states meet applicable text/non-text contrast. Canonical sources, versions and deliberate accessibility deviations are recorded. No theme is certified from opaque tokens alone.

Tasks:

- [ ] Create a source/role mapping for Dracula, One Dark and Catppuccin; establish whether Black & Gold intends official branding and identify local-only palettes.
- [ ] Adjust all 12 measured failing text pairs in public/themes; use canonical surfaces where appropriate and document deviations needed for readability.
- [ ] Check input identification, focus rings, selected/hover states, destructive tints, sidebar and muted labels with composited colors.
- [ ] Retain machine-readable contrast evidence and verify screenshots for every bundled theme.

## US-33.2: Unify semantic states, labels and typography

As a user, I want consistent errors, statuses, code styling and accessible controls across themes.

Estimate: 2–3 days. Dependencies: US-33.1 token choices; coordinate layout work with EPIC-32.

Acceptance criteria:

Feature errors/statuses use shared semantic roles; icon actions and inputs have accurate accessible names. Code retains monospace typography and a documented syntax palette mapping. Reduced motion is respected. Target sizes are assessed using effective hit area and spacing.

Tasks:

- [ ] Replace feature-specific red/green/white states with documented semantic variants; avoid blindly rewriting library overlays.
- [ ] Correct Theme Editor add/duplicate names, setup passkey label association and General settings control labels; inspect related icon actions.
- [ ] Fix undefined prose variables and global font overrides; map syntax highlighting deliberately to theme families.
- [ ] Add reduced-motion behavior and verify focus, effective pointer target sizes and keyboard navigation across representative flows.

## US-33.3: Enforce a theme and layout review matrix

As a maintainer, I want automated checks to catch visual accessibility regressions.

Estimate: 1–2 days. Dependencies: US-33.1, US-33.2 and EPIC-32 fixtures.

Acceptance criteria:

CI checks every bundled theme schema/text pair and representative rendered states. Responsive checks detect clipping and inaccessible controls at container/height extremes. Failures produce actionable role/theme/viewport evidence; intentional exceptions require rationale.

Tasks:

- [ ] Add deterministic theme-schema and contrast checks based on unrounded luminance ratios.
- [ ] Create a compact component/state fixture covering controls, focus, errors, typography and adversarial content using existing shadcn components.
- [ ] Integrate rendered accessibility and overflow/reachability cases into CI and document the manual review matrix.
