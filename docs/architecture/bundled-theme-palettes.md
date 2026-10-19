# Bundled palette mappings and contrast

The eight defaults are application adaptations, owned by
[`features/theme/bundled`](../../apps/frontend/src/features/theme/bundled).
They are statically imported; administrator overrides in `STORAGE_ROOT/themes`
remain separate. Palette changes do not rewrite those overrides. The schema,
public catalog, theme IDs and selection behavior are unchanged.

## Sources and identity

References were checked on 2026-10-18. Upstream editor colors describe a palette;
they do not prescribe accessible application controls on every possible surface.

| Bundle                               | Reference and version                                                                                                                                                                                                                                                      | Application mapping                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dracula                              | [Dracula Classic specification](https://draculatheme.com/spec), unversioned web snapshot checked 2026-10-18                                                                                                                                                                | Background, card, popover and sidebar use Classic Background `#282a36`; text uses Foreground `#f8f8f2`; primary/sidebar primary use Purple `#bd93f9`; secondary, muted and accent use Selection `#44475a`.                                                                                                    |
| One Dark                             | Atom [One Dark Syntax colors](https://github.com/atom/one-dark-syntax/blob/master/styles/colors.less), package **1.8.4**; [One Dark UI variables](https://github.com/atom/one-dark-ui/blob/master/styles/ui-variables.less), package **1.12.5**, archived master snapshots | Syntax background `#282c34`, text `#abb2bf` and blue `#61afef` retain the editor identity. Card/sidebar `#21252b`, muted `#31353f`, secondary/accent `#3e4451` are application surface choices. Syntax comments are not suitable UI labels.                                                                   |
| Catppuccin Latte - Mauve             | [Catppuccin palette v1.7.1](https://github.com/catppuccin/palette/blob/v1.7.1/palette.json), [palette reference](https://catppuccin.com/palette/)                                                                                                                          | Base `#eff1f5` for main/card/popover; Mantle `#e6e9ef` for sidebar; Text `#4c4f69`; Mauve `#8839ef` for primary; Surface 0 `#ccd0da` for secondary/muted/accent.                                                                                                                                              |
| Catppuccin Mocha                     | Same Catppuccin v1.7.1 reference                                                                                                                                                                                                                                           | Base `#1e1e2e` for main/card/popover; Mantle `#181825` for sidebar; Text `#cdd6f4`; Lavender `#b4befe` for primary; Surface 0 `#313244` for secondary/muted/accent.                                                                                                                                           |
| Black & Gold (`ucf-knights`)         | Local application palette with historical UCF-inspired colors; **not an official UCF theme or current brand implementation**                                                                                                                                               | Retains local gold `#ffc904`, black and white. The existing filename alone does not establish an official branding requirement. [UCF's current visual guide](https://www.ucf.edu/brand/visual-expression/) now specifies Bold Gold `#edb80d`; this local palette deliberately makes no claim of following it. |
| Default Light, Default Dark, Flowers | Local application palettes, no external version or branding claim                                                                                                                                                                                                          | Preserve the blue/neutral light and dark families and the pink/lilac Flowers identity. The checked-in JSON is their source of truth.                                                                                                                                                                          |

These are semantic application mappings rather than complete ports of upstream
syntax/UI themes. Decorative `border` and `sidebar-border` may remain subtle;
`input` identifies interactive boundaries and `ring` / `sidebar-ring` identify focus.

## Accessibility choices

Every changed token, including its previous value, is retained in the
[US-33.1 evidence](../reviews/us-33.1-theme-contrast-2026-10-18.json).
The original [80-pair audit](../reviews/2026-10-17-theme-contrast.json) remains
unchanged so the 12 failing pairs can be compared directly.

- Latte uses Text rather than Subtext 1 for muted labels on Surface 0; Sidebar is canonical Mantle. Input boundaries use Subtext 0 `#6c6f85`, and sidebar focus uses Mauve. The error red is deepened to `#800820` for tinted controls.
- Mocha Sidebar is canonical Mantle; boundaries use Overlay 2 `#9399b2`, sidebar focus uses Lavender, and destructive text uses Flamingo `#f2cdcd` to remain readable over a red tint.
- Dracula uses canonical Background across its principal surfaces. Muted text `#bfc7df`, input edges `#a3adc9` and error text `#ffe0e0` are deliberately lighter application variants. Sidebar focus uses Purple rather than Selection. Canonical Comment is not used as normal-sized UI text.
- One Dark uses its main text for muted labels and input boundaries rather than comment gray. Destructive text `#ffc1c6` is a lighter red adaptation for tinted controls.
- Default Light uses a darker blue `#1d4ed8` for primary/sidebar primary and focus, darker muted labels `#626574`, recognizable input edges `#757782` and deeper error red `#991b1b`.
- Default Dark uses light blue `#8eaeff` with dark primary/sidebar text `#14151a`; it also supports readable links. Input edges `#9295a5`, focus `#a9acc0` and error text `#ff9991` work on its dark surfaces.
- Flowers deepens primary/sidebar pink and focus to `#b51c55`, uses dark plum `#3d1a3f` on bright accent pink, darkens muted labels to `#75465a`, identifies inputs with `#8e5a70` and deepens error red to `#991133`.
- Black & Gold uses dark gray `#333333` for muted/accent surfaces, `#c7c7c7` muted labels, `#a0a0a0` input edges and `#ff9999` error text. This preserves gold text on the accent surface.

## Shared control states

Unchecked switch thumbs use the background role against the stronger input track,
avoiding a light-on-light thumb in dark themes.

Input, textarea, select, input-group and outline-badge fills use opaque `background` instead of
translucent `input`; the stronger `input` token is reserved for their visible
boundaries. Outline buttons also use that boundary role. Focus rings on these
controls, buttons, badge links, checkbox, switch and tabs use the opaque focus token. Invalid
input borders retain opaque destructive color in both light and dark themes.

Primary hover mixes 8% black into primary; secondary hover mixes 5% black into
secondary. This avoids fading a filled button into its surroundings or lightening
One Dark's secondary surface toward its text. Destructive buttons use 10% tint at
rest and 15% on hover, retaining their destructive text role. Sidebar group labels
use the full sidebar foreground; inactive tabs use muted foreground. Active tabs
retain their accent surface on hover so the text/surface pair stays valid.

The input-role audit also covers direct consumers: appearance selectors no longer
force an input-colored fill, model-picker menus use popover surfaces and a standard
Input for filtering, and the actual chat composer uses a muted surface with a visible
container boundary/focus ring. Only non-text toggle indicators retain input-colored
fills. This prevents stronger input boundaries from turning text-bearing surfaces
into low-contrast fills.

## Review coverage and limits

The test-profile-only `/e2e/theme-contrast` route uses the real cookie-selected
palette and existing production controls. Its browser spec retains all ten original
paired text roles per bundle, then measures actual resting, hover, selection,
invalid and keyboard-focus states. Text uses 4.5:1; interactive boundaries and focus
use 3:1. Computed CSS colors, including alpha backgrounds, are resolved by Chromium
and composited over ancestor backgrounds in sRGB. Threshold decisions use unrounded
ratios; screenshots provide a separate visual review.

The scoped [verification report](../reviews/us-33.1-verification-2026-10-18.md)
links all eight screenshots and machine-readable results. This is evidence for the
bundled palettes and the reviewed components, not whole-application accessibility
certification or validation of user-authored themes. Feature-specific colors,
syntax highlighting and typography are covered by the [US-33.2 implementation](frontend-and-themes.md#typography-labels-and-motion-us-332); the wider reusable review
matrix and explicit CI policy remain US-33.3 work.

The [2026-10-19 select-readability follow-up](../reviews/us-33.1-select-readability-2026-10-19.md)
adds the real chat model picker inside its animated primary-colored panel. Select
triggers explicitly own both background and foreground, so the selected value cannot
inherit an incompatible primary foreground from the surrounding panel.
