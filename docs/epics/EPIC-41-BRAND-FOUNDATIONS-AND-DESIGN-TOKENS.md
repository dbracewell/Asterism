# EPIC-41: Brand foundations and design tokens

Status: complete (2026-10-27). Source: the approved visual design audit (2026-10-26).

## Objective

Give Asterism one coherent visual identity, "star atlas", that every theme
inherits. Today the default palette is shadcn stone with an indigo primary, four
font families are loaded (one is unused), corner radius and elevation are ad hoc,
two icon libraries are mixed, and the favicon is still the create-next-app
default.

Design direction (approved):

| Token        | Atlas (light) | Night Atlas (dark) | Role                          |
| ------------ | ------------- | ------------------ | ----------------------------- |
| `field`      | `#F5F7FB`     | `#0E1424`          | Background                    |
| `ink`        | `#1B2340`     | `#DCE3F5`          | Foreground                    |
| `chart-line` | `#B9C3DA`     | `#2C3757`          | Borders, connecting lines     |
| `star`       | `#3B5BDB`     | `#8FA8FF`          | Primary/action                |
| `flare`      | `#E0A526`     | `#F2C14E`          | Live/running agent state only |

Principles: spend boldness in one place (the EPIC-44 agent constellation); keep
everything else quiet. Use at most two typefaces: a characterful grotesk for UI
and headings, and a monospace used only for code. Avoid gradient washes, ALL-CAPS
eyebrow labels, accenting a single word in a heading, and `→` CTAs. `flare` is a
state color, never decoration.

## Ownership and delivery

Frontend only, apart from theme schema validation in `features/theme`. No
backwards compatibility: Atlas and Night Atlas replace the current Light and Dark
defaults directly. Existing third-party presets (Dracula, Catppuccin, One Dark,
Flowers, UCF Knights) stay optional and must keep passing EPIC-33 contrast tests.
Every story adds or updates Playwright `toHaveScreenshot` baselines for the
screens it touches (Atlas, Night Atlas and one preset, desktop and mobile).

## US-41.1: Establish the type system

As a user, I want consistent, readable, distinctive typography.

Estimate: 1 day. Dependencies: none.

Acceptance: exactly one UI family and one code family are loaded. A documented
modular scale (`display`, `title`, `heading`, `body`, `meta`) is available as
Tailwind utilities, and `--font-heading` is wired up. The wordmark uses the chosen
face in sentence case. Inter, Geist and Montserrat are removed.

- [x] Compare the candidates (Schibsted Grotesk, Hanken Grotesk, Instrument Sans) on chat, settings and list screens; record the choice in an ADR note.
- [x] Replace the font loading in `app/layout.tsx`; define the scale and the heading/mono tokens in `globals.css`.
- [x] Migrate headings and meta text to the scale utilities; redraw `FullLogo` in the new face.
- [x] Update tests and screenshot baselines; document the scale in the frontend README.

## US-41.2: Ship native Atlas themes

As a user, I want Asterism's own light and dark themes by default.

Estimate: 1 day. Dependencies: US-41.1.

Acceptance: the Atlas and Night Atlas bundled palettes map the tokens above onto
every semantic variable, including the sidebar and chart variables. They are the
defaults, pass the existing contrast tests, and `:root` in `globals.css` matches
Atlas.

- [x] Add the bundled palettes; make them the defaults; remove the old Light/Dark defaults.
- [x] Align the `:root` fallback; check prose, syntax-highlight and toast colors against both themes.
- [x] Extend the bundled-palette contrast tests; update screenshots.

## US-41.3: Extend themes beyond color

As an admin, I want themes to control shape and density as well as color.

Estimate: 1.5 days. Dependencies: US-41.2.

Acceptance: the theme schema accepts optional `radius`, `shadow` (flat/soft) and
`density` (comfortable/compact) values, validated by the existing theme security
rules. The theme editor can edit them, and omitted values fall back to Atlas.
Fonts stay fixed by the brand unless the user decides otherwise when this story
starts.

- [x] Extend the theme schema, loader and inline style generation; reject out-of-range values.
- [x] Add editor controls with a live preview; test validation and the fallbacks.

## US-41.4: Shape and elevation tokens

As a user, I want surfaces whose shape reflects their hierarchy.

Estimate: 1 day. Dependencies: US-41.3.

Acceptance: three radius tiers (control, surface, overlay/composer) and two
elevation levels are defined. Ad-hoc `rounded-*` and `shadow-*` classes in
feature code are replaced, and pills are reserved for chips.

- [x] Define the tokens; migrate the feature components (chat, projects, settings, file manager).
- [x] Add a lint or test guard against new ad-hoc radius/shadow classes outside `components/ui`.

## US-41.5: Consolidate icons

As a user, I want icons with one consistent weight.

Estimate: 0.5 day. Dependencies: none.

Acceptance: only Lucide is used, with one stroke width; `@tabler/icons-react` is
removed from dependencies.

- [x] Replace the Tabler imports (`IconBrain`, `IconUserCog`, …); set the default stroke width; remove the dependency.

## US-41.6: Brand assets and cleanup

As a user, I want Asterism to be recognizable in browser tabs, bookmarks and link previews.

Estimate: 0.5 day. Dependencies: US-41.2.

Acceptance: a constellation favicon, `icon.svg`, `apple-icon`, an OG image and a
web manifest replace the create-next-app favicon, and metadata references them.
The unused `AnimatedBorder` and hard-coded colors outside themes are removed.

- [x] Favicon: simplified `star-small` mark as `src/app/icon.svg` (source of truth); `favicon.ico` (16/32/48) and full-bleed `apple-icon.png` generated by `pnpm --filter @asterism/frontend generate:icons`.
- [x] OG image and web manifest (192/512 icons) via Next metadata file conventions.
- [x] Remove `AnimatedBorder` and its harness usages; replace hard-coded colors with tokens.
