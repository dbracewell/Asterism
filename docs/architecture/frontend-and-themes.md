# Frontend layout, themes, and product surface

## Runtime ownership

The Next.js App Router owns authentication pages and the workspace shell.
`DashboardLayout` composes the sidebar, current-user context and page content.
Domain server data uses generated Hey API clients and TanStack Query; the shared
mutation cache owns normal invalidation. Settings sections load lazily and use
URL parameters to select the active section.

`RootLayout` loads theme metadata and CSS variables on the server, applying theme
colors and the font-size cookie to the root element. `ThemeProvider` exposes
selection helpers; cookies plus `router.refresh()` update server-rendered theme
state. `ThemeCheck` reconciles the logged-in user's saved appearance preferences
with those cookies. This is custom theme loading, not automatic OS dark-mode
selection. Syntax highlighting currently chooses VS/VS2015 by light/dark type.

## Theme files and editing

Bundled palettes live in [`features/theme/bundled`](../../apps/frontend/src/features/theme/bundled)
and are statically imported into the application. The theme repository composes
these read-only defaults with validated custom files under `STORAGE_ROOT/themes`.
Saving a bundled ID creates a persistent override; new palettes use server-generated
IDs. Each save writes and syncs a temporary file and atomically renames it into place.
Malformed files are isolated individually. No process-global palette cache exists.

Theme Editor uses an administrator-authorized server action and TanStack mutation.
Failures retain the draft with a retry action; success returns the persisted ID,
refreshes the catalog and resets dirty state. Public catalog APIs support setup,
sign-in and ordinary selection with `Cache-Control: no-store`. Missing custom IDs
resolve to Light without a saved-preference refresh loop.

See [theme storage and lifecycle](theme-storage.md) for schema, single-writer
ownership, backup/reset, container permissions and cache freshness. The
[theme trust boundary](auth-and-security.md#theme-trust-boundary) documents access.

Bundled palette sources, semantic mappings, accessibility deviations and the
rendered control contract are documented in [bundled theme palettes](bundled-theme-palettes.md).

## Rich-content trust

Main/user chat messages and sub-agent replies share `MarkdownViewer`. It disables
raw HTML, permits an explicit subset of link URLs, and renders Markdown images as
omitted-image text without loading them. KaTeX math uses `trust: false`, strict
validation and bounded size/expansion. Fenced code, GFM and scoped citations remain
supported. File extracted text/captions remain literal React text. See the
[Markdown and file-content policy](markdown-content.md) for the exact contract.

## Layout and scrolling

Global CSS suppresses body overflow and the body uses `h-screen`. The workspace
relies on child panels owning scroll areas with shrinking flex content. This makes
`min-h-0`, `min-w-0` and explicit scroll ownership essential. Authentication now
owns its own scroll area, described below. The workspace bounds its shell to
`100dvh`; its main inset scrolls ordinary pages while specialized panels retain
their own scroll areas. The mobile header stays full-width at the top.
Settings, Theme Editor, file panes, dialogs and chat follow the container and
scroll contracts below.

The completed contract in [EPIC-32](../epics/EPIC-32-RESPONSIVE-LAYOUT-AND-REACHABILITY.md)
requires controls and final content to remain reachable across short/narrow windows,
nested panes, long content and enlarged text. `scrollWidth <= clientWidth` alone
cannot detect clipped vertical content or controls hidden by `overflow: hidden`.

### Rich chat content and composer clearance (US-32.3)

`ChatSession` uses a shrinking column with two flow siblings: the conversation
history and composer. History owns vertical scrolling and has no fixed tail
reserve. The composer can occupy at most 60% of the available session height;
its input container owns scrolling through expanded saved context, staged files,
errors, multiline input and controls. Its jump-to-latest button remains outside
that inner scroll area. History retains the remaining space, so composer growth
cannot cover the final message or response actions. Both areas shrink horizontally,
with a shared 64rem maximum width. Existing stream follow/manual-scroll locking
and persistence/model/scope boundaries remain in place; no resize observer or
new scrolling framework is introduced.

The shared Markdown renderer wraps prose, links, inline code and omitted-image
labels at long tokens. Tables and fenced code have bounded horizontal scroll
regions, keyboard focus and visible focus outlines. Each code block (including
unlabelled fences) keeps literal text and a separate copy header, so horizontal
scrolling does not move its copy action out of reach. KaTeX's generated `.katex`
spans get bounded, keyboard-focusable horizontal scroll areas and start alignment
to keep the first term accessible. Raw HTML, automatic Markdown images, URL and
math security settings remain governed by the [content policy](markdown-content.md).
Authorized image attachments remain separate application components.

Message/version actions, thinking/tool arguments, sub-agent activity, citation
metadata, attachment names and file-context controls wrap within their owners.
The file context and queued-attachment sections flow through the composer's scroll
area rather than imposing independent viewport-based height caps. Send/stop use
existing fixed-size buttons; they do not stretch to the full attachment-list height.
New-chat composition retains ordinary workspace-page scrolling.

Conversation loading has a named status. Initial query failures have a local
retry action; a failed background refresh retains saved messages with an explicit
warning and retry. Empty chats have an explicit start message. Scope refreshes
continue to fail closed: unverified cached file-scope links are withheld rather
than treated as authorization. All server-state operations continue through the
generated clients and TanStack Query.

`chat-reachability.spec.ts` uses production chat/renderer/composer components with
synthetic long tokens, code, tables, equations, tool arguments, citations and files.
It exercises 320/390/768/1440px windows, 300px heights, 640px/320px panes beside
synthetic side panels, 200% text, multiline drafts and expanded context. It checks
actual horizontal keyboard scrolling, focus/hit testing, final actions, loading,
empty/failure/cached-refresh states and manual-history position during streaming.
Existing authenticated mobile-shell tests additionally cover the actual sidebar.

### Settings, dialogs and file panes (US-32.2)

`SettingsCard` observes its own content width: below 640px its section tabs form a
horizontally scrollable strip; at larger widths its 160px navigation column scrolls
vertically. The Radix orientation follows that arrangement for arrow-key navigation.
Both navigation and active content can shrink, and the active pane owns vertical
scrolling. Section changes use `useReadWriteSearchParams`, preserving unrelated
parameters, including repeated values, while updating `t` and `setting`. General
Settings stacks appearance controls and bounds its model selector to the pane;
sub-agent cards shrink within their parent.

Theme Editor uses a named CSS container. Its theme list and form stack until the
editor itself reaches 48rem, independent of viewport width. The stacked theme list
has a 15rem scroll limit; the form flows in the settings pane so its last field,
validation and Save action remain reachable. Color fields adapt to their own width.

The file grid uses `minmax(min(100%,250px),1fr)` tracks. File cards and processing
status can shrink; names truncate within the card while open/download controls wrap
instead of sharing clipped metadata. Project badges wrap long names. List rows
switch to a single row only when their own container reaches 48rem. The ribbon's
sections, controls and pagination footer wrap, and file selection has a visible keyboard focus ring.
The file list owns scrolling within the available height. Picker bodies reserve
at least 20rem for their ribbon, files and footer; short dialogs scroll their
outer content to expose that body. Ordinary workspace file panes can shrink to
their actual remaining height without overlapping the footer.

Shared `DialogContent` and `AlertDialogContent` own vertical scrolling and are capped
at `calc(100dvh - 2rem)`, with horizontal gutters and wrapping long messages. Ordinary
dialogs use content-sized grid rows, so long validation does not compress away the
footer. The close button remains reachable by returning to the top or keyboard focus;
footers scroll with the content. Agent forms use that outer scroll owner rather than
an independently scrolling form, and their columns follow the dialog container width.
Library/project file pickers retain a flex layout with an 80dvh preferred height,
subject to the shared cap; their headers/ribbons do not shrink. Image previews fit
within the same dynamic-height limit. All production callers were inspected: main
configuration, sub-agent create/edit, project create, chat move, project/library file
pickers, image preview, and the reusable confirmation dialog.

Browser regressions in `settings-responsiveness.spec.ts` cover 320/390/768/1440px
viewports, 300px heights, and 640px/240px nested panes. They assert focus and center
hit testing after scrolling, dialog footer/close reachability, duplicate URL parameter
preservation, and file open/download/regenerate actions. These are browser layout
checks, not a certification of physical device keyboard behavior.

### Authentication viewport and focus contract (US-32.1)

The `(auth)` route layout owns a `100dvh` scroll container with padding and scroll
padding. It uses vertical auto margins on the nonshrinking form: shorter forms
center, while taller forms start at the padded top and remain scrollable to the
last control. Form width/minimums and wrapping error text keep content within the
viewport without an authentication-level horizontal `hidden`/`clip` rule. The root
body rules remain unchanged.

The auth route exports `interactiveWidget: "resizes-content"` through Next.js
viewport metadata. Supporting browsers can resize the layout viewport when a
virtual keyboard opens; the route does not disable zoom or cap the scale. Browser
behavior is platform-dependent; see [Chrome's viewport behavior](https://developer.chrome.com/blog/viewport-resize-behavior).
Tests simulate reduced viewport sizes rather than certifying physical iOS/Android
keyboard behavior.

Auth errors use the existing semantic `FieldError`. A new or repeated error returns
focus to the summary and scrolls its start into view. It wraps unbroken server
messages, is described by the named form, and has a visible keyboard outline.
Tab continues from the summary through the fields to submit, preserving entered
values. The setup passkey label now targets the passkey input. Setup remains
available only with zero users; role/session checks and auth persistence are
unchanged.

Browser coverage exercises setup and login at 320/390px widths, 300/800px heights,
100%/200% root text size, and 640×300 landscape with both text sizes. It checks
keyboard order, focus rings and clearance, hit testing, actual wheel scroll and
touch submission, validation errors, a long message, viewport shrink/recovery and
successful login in disposable storage. See [verification evidence](../reviews/us-32.1-verification-2026-10-18.md).

### Mobile workspace shell

The dashboard uses a dynamic-height, nonshrinking sidebar provider and a shrinkable
main inset with vertical scrolling and an isolated page-content stacking context.
The mobile header is a full-width sticky grid:
its title cannot overlap the sidebar trigger, and both open/close controls have
44px touch targets. The sidebar uses a single click handler for touch, mouse and
keyboard activation, avoiding the former touch-end plus synthesized-click double
toggle. Mobile navigation closes the drawer; dismissal restores focus to the
trigger and releases the modal interaction lock. The mobile close button omits the
desktop expansion tooltip so Escape dismisses the drawer directly.

Sidebar navigation can scroll between its header and user footer. Ordinary project
and General pages scroll in the main inset; SettingsCard gives the selected pane
its own vertical scroll area. Project pagination wraps to avoid widening a narrow
page. The existing File Manager list and chat history retain local scrolling.
The mobile browser regression uses real authentication and production routes with
synthetic API content to check these owners, actual touch navigation and wheel
scrolling. US-32.2 and US-32.3 extend these contracts to narrow settings/file
panes, tall dialogs, rich-content overflow and expanded composer content.

## Theme and component consistency

Semantic variables cover text/surface, primary/secondary/muted/accent, destructive,
border/input/ring and sidebar roles. Chart defaults remain in global CSS rather
than the theme JSON contract. Shared shadcn components consume these variables;
image/download failures, required indicators, chat errors and connection/delegation
statuses now consume semantic roles. Errors use `destructive`; connected/completed
indicators use `primary` with explicit status text. Context usage adds Normal,
Elevated and Near limit text rather than relying on yellow/red alone. Library
overlay scrims retain their own styles. AnimatedBorder pairs its inner background
with foreground, preventing text from inheriting the outer primary foreground. Focus and destructive states use opacity,
so raw token contrast measurements are only a first check.

The [dated review](../reviews/2026-10-17-codebase-review.md) records 12 failing
normal-text pairs across seven of eight bundled themes and palette-source links.
[EPIC-33](../epics/EPIC-33-THEME-CONTRAST-AND-UI-CONSISTENCY.md) owns corrections,
source attribution, composited-state checks, accessible labels, code typography
and reduced motion. Source fidelity permits documented accessibility adaptations.

## Typography, labels and motion (US-33.2)

Inter is inherited from the document instead of being applied to every element.
The workspace and authentication ASTERISM wordmarks deliberately retain Montserrat
through the existing `font-monsterrat` utility. The logo link/icon can shrink
inside the header while the full wordmark and mobile close target stay separate. Inline code, fenced code and syntax
spans use Geist Mono; KaTeX keeps its own typography. Prose counters use the defined
muted foreground and code backgrounds use literal `transparent`. See the
[syntax palette mapping](markdown-content.md#code-typography-and-syntax-palettes).

General settings associate Theme, Font Size, Show Thinking and Default Model with
their controls. Theme Editor creation/duplication names and setup passkey labels
remain intact. Theme color triggers and hex inputs are named, and hex inputs
retain the shared focus/invalid styles. Copy, image enlargement, sidebar creation and chat menus have
accessible names. Sidebar actions become visible on keyboard focus within the
row/group as well as on hover. The image preview has a named dialog and description;
the unused download icon was removed because it had no action.

Icon Button variants and sidebar menu actions have a 24 CSS pixel minimum, including
at the smallest selectable 12px root font. Checkbox/switch primitives retain their
existing expanded hit areas. Pointer review uses center hit testing and actual
bounds at narrow/desktop sizes; this is scoped evidence, not a claim that every
application target meets an accessibility standard. Neighboring sidebar actions
remain separate controls with their existing spacing.

`prefers-reduced-motion: reduce` disables CSS animation, transitions and smooth
scrolling, including pseudo-elements and the animated composer border. The scroll
mask is removed in that mode. Loading/status text stays present, and dialogs still
open, close with Escape and return focus. These changes preserve auth, settings
persistence and Markdown trust boundaries. [Verification](../reviews/us-33.2-verification-2026-10-19.md)
records the executed gates and scope; the broader review matrix remains US-33.3.

## Current versus planned product surface

Providers/models, main/sub-agent settings, tool policy, theme editing and image
captioning have implementation paths, with limitations recorded above. Groups,
Users, Image Generation, Code Execution and Export settings currently render
placeholder text; their navigation is not evidence of an operational settings API.

The distinct persona/default-profile policy is not implemented by the main-agent
configuration in `agent_profiles`. Current chat composition passes no persona layer
and records `user_profile_id=None`. Typed memory namespace contracts exist, but
there is no active long-term memory engine or automatic cross-chat summaries.
[EPIC-35](../epics/EPIC-35-PRODUCT-SURFACE-AND-PERSONA-FOUNDATIONS.md) separates honest
navigation from the future persona foundation; memory activation needs separate work.

## Verification entry points

Use frontend unit tests for state/labels, the root isolated E2E runner for real
auth/backend/socket flows and fixture browser tests for targeted UI stress cases.
The runner requires ports 3000, 3100 and 8000 free and creates disposable storage.
Existing E2E coverage includes responsive provider/agent controls; a complete
theme/height/container matrix remains pending. See [scripts](../../scripts/README.md)
and the [review evidence](../reviews/2026-10-17-codebase-review.md).
