# Themes

This guide explains how Asterism's look is defined and applied: the theme files,
how a theme reaches the page before it paints, the semantic color, shape and type
tokens that every component uses, and the tests that keep components on those
tokens. Read it before changing a theme, a token or a component's colors.
[Theme storage](theme-storage.md) covers how theme files are saved, and
[bundled theme palettes](bundled-theme-palettes.md) where the bundled ones come from.

## Concepts

- **A theme** is a JSON palette: a name, a `light` or `dark` type, one color for each
  semantic role, and optional shape values.
- **Bundled themes** ship with the app in
  [`features/theme/bundled/`](../../apps/frontend/src/features/theme/bundled/): Atlas,
  Night Atlas, Catppuccin Latte (Mauve), Catppuccin Mocha, Dracula, One Dark, Flowers
  and Black & Gold. They are read-only.
- **Custom themes** are saved by an admin in the Theme Editor, under
  `STORAGE_ROOT/themes`. Editing a bundled theme saves an override there.
- **Semantic roles** are what components ask for: `primary`, `muted`, `destructive`,
  `border` and so on, never a literal color.

## How it works

### Applying a theme

`RootLayout` ([`src/app/layout.tsx`](../../apps/frontend/src/app/layout.tsx)) loads the
selected theme on the server and writes its colors and shape values as CSS variables
on the root element, along with the font-size cookie. The first paint is therefore
already in the right theme, with no flash.

The selection is a cookie. `ThemeProvider`
([`theme-context.tsx`](../../apps/frontend/src/features/theme/components/theme-context.tsx))
changes it and calls `router.refresh()` so the server renders the new theme, and a
check after sign-in brings the cookies in line with the user's saved appearance
settings. Themes are chosen explicitly; Asterism doesn't follow the operating
system's dark mode.

Theme palettes are public, because the sign-in and setup pages use them before
anyone signs in. `/api/theme/list` lists theme IDs, and `/api/theme?name=<id>`
returns one validated palette. A missing custom theme falls back to Atlas
([authentication and security](auth-and-security.md#theme-files)).

### The Theme Editor

Admin Settings → Theme Editor edits a theme's colors and shape and previews the
draft in a scoped element, without changing the page until it is saved. Saving goes
through a server action that checks the admin role itself, then writes a synced
temporary file and renames it into place. A failed save keeps the draft with a
retry; success refreshes the theme list. Bundled themes are saved as overrides, and
new themes get server-generated IDs ([theme storage](theme-storage.md)).

### Color roles

Every color in the app comes from a semantic role:

| Roles                                                               | Used for                            |
| ------------------------------------------------------------------- | ----------------------------------- |
| `background`, `foreground`, `card`, `popover` and their foregrounds | Surfaces and their text             |
| `primary`, `secondary`, `muted`, `accent` and their foregrounds     | Actions, quiet surfaces, highlights |
| `destructive`                                                       | Errors and destructive actions      |
| `border`, `input`, `ring`                                           | Lines, fields, focus rings          |
| `chart-1` to `chart-5`                                              | Charts and the delegation graph     |
| `sidebar-*`                                                         | The sidebar's own surfaces          |

A few conventions:

- Errors use `destructive`; success and "connected" use `primary` with status text.
- Cautions, such as external captioning, use a `primary` tint with a warning icon.
- Levels are named in text as well as color: the context meter says Normal,
  Elevated or Near limit.
- Modal backdrops use `bg-scrim`, which doesn't depend on the theme.
- **`flare`** (`--color-flare`, `#E0A526` light, `#F2C14E` dark) is a brand constant
  outside the theme roles, used for running agents in the delegation graph.

[`src/app/color-tokens.test.ts`](../../apps/frontend/src/app/color-tokens.test.ts)
fails on any Tailwind palette color (such as `text-amber-500`) anywhere in `src`, and
on hex or `rgb()` literals outside the theme code and the Theme Editor.

Measuring a role pair's contrast is only a first check, because focus and
destructive states add opacity. The
[theme and layout review matrix](../reviews/theme-layout-review-matrix.md) checks
the rendered result in every bundled theme.

### Shape and elevation

A theme's shape values set three CSS variables:

| Field     | Values                     | Default (Atlas) | Sets                                                 |
| --------- | -------------------------- | --------------- | ---------------------------------------------------- |
| `radius`  | 0 to 1.25 rem              | 0.45            | `--radius`, which scales every corner tier           |
| `shadow`  | `soft` or `flat`           | `soft`          | `--elevation`, 1 or 0, which scales every shadow     |
| `density` | `comfortable` or `compact` | `comfortable`   | `--spacing`, so compact makes spacing and sizes 0.9× |

Components use shape tiers rather than raw sizes:

| Utility           | Value (Atlas) | Use                                             |
| ----------------- | ------------- | ----------------------------------------------- |
| `rounded-control` | 0.8 × radius  | Buttons, inputs, selects, menu items, list rows |
| `rounded-surface` | 1.4 × radius  | Cards, panels, code blocks, menus and popovers  |
| `rounded-overlay` | 1.8 × radius  | Dialogs and the chat composer                   |
| `rounded-chip`    | pill          | Chips and badges only                           |
| `rounded-dot`     | circle        | Small status dots                               |
| `shadow-raised`   | level 1       | The resting composer, error cards               |
| `shadow-overlay`  | level 2       | Dialogs, sheets, menus, the focused composer    |

[`src/app/shape-tokens.test.ts`](../../apps/frontend/src/app/shape-tokens.test.ts)
fails on raw `rounded-*` and `shadow-*` classes outside the shadcn primitives, the
generated client and the theme code. `rounded-none` and `rounded-[inherit]` remain
for structural cases.

### Type

Fonts are part of the brand, not of a theme. Schibsted Grotesk is set once on the
document and inherited; code, inline code and syntax highlighting use JetBrains Mono;
KaTeX keeps its own fonts. Both are loaded with `next/font`. Text sizes come from the
scale in [ADR-0024](../adr/0024-type-system.md): `text-display`, `text-title`,
`text-heading`, `text-body` and `text-meta`. Users choose a base font size in User
Settings → General, stored as a cookie.

### Prose and code

The `prose` styles in
[`globals.css`](../../apps/frontend/src/app/globals.css) take every color from the
theme:

- tables have a `bg-muted` header, thin `border` rules and lightly striped rows;
- links use `primary` with an underline that becomes solid on hover; every bundled
  theme's primary is at least 4.5:1 on its background and cards;
- blockquotes have a 3 px primary rule and `muted-foreground` text;
- inline code sits on a `bg-muted` chip.

Code blocks are highlighted with the VS palette in light themes and VS2015 in dark
ones ([`syntax-theme.ts`](../../apps/frontend/src/components/markdown-viewer/syntax-theme.ts);
[mapping](markdown-content.md#code-typography-and-syntax-palettes)).

## Rules

- Components use semantic roles and shape tiers, never literal colors or raw radius
  and shadow classes; tests enforce both.
- A theme is applied on the server, before the first paint.
- Theme files hold colors and bounded shape values, never raw CSS.
- Saving a theme is admin-only, checked by the server action itself.
- State is never shown by color alone.

## Where the code lives

1. [`features/theme/`](../../apps/frontend/src/features/theme/): bundled themes,
   schemas, contrast helpers and the provider.
2. [`src/app/layout.tsx`](../../apps/frontend/src/app/layout.tsx): applying the theme
   and fonts.
3. [`src/app/globals.css`](../../apps/frontend/src/app/globals.css): tokens, tiers and
   prose styles.
4. [`src/app/color-tokens.test.ts`](../../apps/frontend/src/app/color-tokens.test.ts)
   and [`src/app/shape-tokens.test.ts`](../../apps/frontend/src/app/shape-tokens.test.ts):
   the token checks.

## Related

- [Theme storage](theme-storage.md)
- [Bundled theme palettes](bundled-theme-palettes.md)
- [Theme and layout review matrix](../reviews/theme-layout-review-matrix.md)
- [Frontend](frontend.md)
