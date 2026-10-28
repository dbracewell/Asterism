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
The searchable model picker portals inside its owning dialog and uses that dialog
as its collision boundary, keeping pointer selection and search focus within the
modal. Escape closes an open model popup and restores its trigger; a subsequent
Escape closes the dialog. Pickers outside dialogs retain their body portal.
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
border/input/ring, chart-1…5 and sidebar roles. Shared shadcn components consume these variables;
image/download failures, required indicators, chat errors and connection/delegation
statuses now consume semantic roles. Errors use `destructive`; connected/completed
indicators use `primary` with explicit status text. Context usage adds Normal,
Elevated and Near limit text rather than relying on yellow/red alone. Cautions
(sub-agent tools, external captioning) use a `primary` tint with a warning icon;
modal backdrops use the theme-independent `bg-scrim` token. Since US-41.6,
`src/app/color-tokens.test.ts` fails on Tailwind palette colors (`text-amber-500`,
`bg-black/80`, …) anywhere in `src` and on hex/`rgb()` literals outside
`features/theme` and the theme editor. Focus and destructive states use opacity,
so raw token contrast measurements are only a first check.

The [dated review](../reviews/2026-10-17-codebase-review.md) records 12 failing
normal-text pairs across seven of eight bundled themes and palette-source links.
[EPIC-33](../epics/EPIC-33-THEME-CONTRAST-AND-UI-CONSISTENCY.md) owns corrections,
source attribution, composited-state checks, accessible labels, code typography
and reduced motion. Source fidelity permits documented accessibility adaptations.

## Shape and elevation tokens (US-41.4)

Shape follows hierarchy. All tiers derive from the theme `--radius` (US-41.3), so
a theme's corner radius scales every tier together; elevation is multiplied by the
theme `--elevation` (`flat` removes it).

| Utility           | Value (Atlas)         | Use                                                          |
| ----------------- | --------------------- | ------------------------------------------------------------ |
| `rounded-control` | 0.8 × radius (≈5.8px) | Buttons, inputs, selects, menu items, list rows, thumbnails  |
| `rounded-surface` | 1.4 × radius (≈10px)  | Cards, panels, callouts, code blocks, images, menus/popovers |
| `rounded-overlay` | 1.8 × radius (≈13px)  | Dialogs and the chat composer                                |
| `rounded-chip`    | pill                  | Chips/badges only                                            |
| `rounded-dot`     | circle                | Small status and progress indicators                         |
| `shadow-raised`   | level 1               | Resting composer, error card, prose tables, theme preview    |
| `shadow-overlay`  | level 2               | Dialogs, sheets, menus/popovers, focused composer            |

Floating menus and popovers use the surface radius (their `p-1` padding nests the
control-radius items cleanly) with overlay elevation. Icon buttons use the control
radius; pills are reserved for chips. `rounded-none` and `rounded-[inherit]` remain
structural escapes. `src/app/shape-tokens.test.ts` fails on raw `rounded*` /
`shadow*` scale classes outside `components/ui`, `lib/client` and
`features/theme`; shadcn primitives map their shells onto the same tokens.

## Icons (US-41.5)

Lucide (`lucide-react`) is the only icon set. `LucideProvider` in
`src/app/providers.tsx` sets one stroke width (`ICON_STROKE_WIDTH = 2`) for every
icon, so components set only size and color, never `strokeWidth`.
`src/app/icon-library.test.ts` fails on imports from other icon packages, on
per-icon `strokeWidth`/`absoluteStrokeWidth` props and on icon-package dependencies.

## Brand assets (US-41.6)

`src/app/icon.svg` is the single source for every raster brand asset;
`pnpm --filter @asterism/frontend generate:icons` regenerates them with Playwright
Chromium (the Open Graph render needs network access for Schibsted Grotesk):

| Output                                             | Purpose                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| `src/app/favicon.ico` (16/32/48), `icon.svg`       | Browser tab icons (Next metadata file conventions)                |
| `src/app/apple-icon.png` (180, full bleed)         | iOS home screen                                                   |
| `public/icon-192.png`, `icon-512.png`              | Web manifest icons                                                |
| `public/icon-maskable-512.png`                     | Manifest `maskable` icon, mark inside the 80% safe zone           |
| `src/app/opengraph-image.png` (1200×630) + alt.txt | Link previews (`og:image`, `twitter:image`) in Night Atlas colors |

`src/app/manifest.ts` serves `/manifest.webmanifest`, taking its background and
theme colors from the bundled Atlas palette. The root layout sets `metadataBase`
from `PUBLIC_URL` so preview images resolve to absolute browser-facing URLs. The
auth proxy matcher already excludes image and `.webmanifest` paths, so crawlers and
install prompts fetch them without a session (`e2e/brand-metadata.spec.ts`).

## Message anatomy (US-43.1)

`features/chat/components/message/` holds the transcript parts that
`MessageItem` composes:

| Part              | Role                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `MessageMarker`   | Small constellation on the first assistant message of a turn; later steps keep its column |
| `MessageBody`     | Skill badges and Markdown; user text sits in a card-surface bubble                        |
| `MessageMeta`     | Stopped state, relative time and tok/s; the time shows the full timestamp in a tooltip    |
| `MessageActions`  | Response version switcher, regenerate and copy                                            |
| `MessageThinking` | Current "Thinking" collapsible (replaced by the timeline in US-43.2)                      |

Each message is an `article` named "Your message" or "Assistant message".
Metadata is transparent until the message is hovered or holds focus, and always
shown on coarse (touch) pointers. The time is focusable, so Tab from the actions
reaches it and opens the full timestamp; a tap opens it on touch.

`src/lib/relative-time.ts` formats "now", minutes, hours, "yesterday", days, then a
calendar date. Day boundaries and the tooltip use the user's stored `timezone`
(invalid zones fall back to UTC), not the browser's. `useNow` (`src/hooks`) shares
one 30-second clock and returns null during server rendering and hydration, so
relative labels never cause hydration mismatches. Coverage:
`src/lib/relative-time.test.ts` and `e2e/message-anatomy.spec.ts` (hover, keyboard,
touch and time zones).

## Typography, labels and motion (US-33.2)

Schibsted Grotesk is inherited from the document instead of being applied to every
element ([ADR 0024](../adr/0024-type-system.md) defines the `text-display`,
`text-title`, `text-heading`, `text-body` and `text-meta` scale). The workspace and
authentication wordmarks use the same face in sentence case. The logo link/icon can shrink
inside the header while the full wordmark and mobile close target stay separate. Inline code, fenced code and syntax
spans use JetBrains Mono; KaTeX keeps its own typography. Prose counters use the defined
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
records the executed gates and scope. The [US-33.3 review matrix](theme-layout-review-matrix.md)
extends these fixtures with per-bundle schema/contrast gates, container/height/text
coverage, zero-retry CI execution and retained browser evidence.

## Current versus planned product surface

Admin navigation retains five **Planned** badges and future-release explanations:
Groups, Users, Image Generation, Code Execution and Export. These panes offer no
configuration actions or placeholder API calls. Available panes remain discoverable
and unbadged: Providers, Theme Editor, Tools and Image Captioning. User Settings
provides General and Agents. Settings navigation wraps long labels alongside the
badges and scrolls the entire focused tab into view; keyboard arrows follow the
container's horizontal/vertical orientation and preserve unrelated URL parameters.

| Capability           | Available now                                                                         | Planned                                                    |
| -------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Providers and models | Admin provider/model configuration; per-chat model selection                          | —                                                          |
| Agents and tools     | User main/sub-agent settings; admin tool policy and provider settings                 | —                                                          |
| Skills               | Private editor/assignments, admin policy, slash discovery and branch-local activation | Automatic selection                                        |
| Appearance           | User theme/font preferences; admin Theme Editor                                       | —                                                          |
| Image captioning     | Admin captioning policy and file-processing integration                               | —                                                          |
| Users and access     | Admin/user access checks, owner scoping and backend user lifecycle                    | Users management screens and permission-policy controls    |
| Groups               | —                                                                                     | Group management and group policy settings                 |
| Image Generation     | Image search and captioning are separate existing capabilities                        | Image-generation providers, models and generation workflow |
| Code Execution       | —                                                                                     | Sandboxed execution and runtime settings                   |
| Export               | Individual file downloads                                                             | Data/conversation export tools                             |
| Personas and memory  | Persona CRUD/defaults, chat selection and immutable execution inputs                  | Long-term memory engine                                    |

The Users pane says that admin/user access checks already exist. Better Auth
carries the role; verified JWTs and backend `AdminUserDep` enforce protected
administration. Owner checks scope user data. The backend already lists user IDs,
provisions a user/main configuration and deletes users with lifecycle cleanup;
those routes are not the missing Users management screen. The Settings page
withholds Admin Settings from ordinary users, including attempted admin deep links.
Neither a role label in UI nor a Planned badge replaces server authorization.

Image search, image captioning and ordinary file downloads do not activate image
generation or bulk data/conversation export. Likewise, agent tools are not a
sandboxed code execution environment. No administration endpoint, capability
assignment or execution permission is introduced by these placeholder panes.
[US-35.1 verification](../reviews/us-35.1-verification-2026-10-24.md) records the
pane, role-visibility and keyboard/browser checks.

User Settings → Personas manages owned USER.md documents and the user default,
separately from `agent_profiles`. Chat selectors support the current default or a
fixed persona. Save uses revision checks; conflicts retain drafts until an explicit
reload. Default and selected-chat deletion protections are enforced server-side.
Accepted turns and historical execution labels preserve persona identity/revision.
See [persona binding](../adr/0021-personas-and-execution-binding.md). Typed memory
namespaces remain future contracts; no long-term memory engine or automatic
cross-chat summaries are active.

## Verification entry points

Use frontend unit tests for state/labels, the root isolated E2E runner for real
auth/backend/socket flows and fixture browser tests for targeted UI stress cases.
The runner requires ports 3000, 3100 and 8000 free and creates disposable storage.
Existing E2E coverage includes responsive provider/agent controls; the
[theme/layout matrix](theme-layout-review-matrix.md) defines automated coverage and
remaining manual/device checks. See [scripts](../../scripts/README.md)
and the [review evidence](../reviews/2026-10-17-codebase-review.md).

## Private skills settings (US-40.2)

User Settings includes Skills: searchable/paginated private source documents,
source/preview dialogs, and confirmed deletion. Agents includes a separate
revision-checked main-agent skill-assignment dialog. Existing settings URL state
and responsive container scrolling apply. Previews use the shared Markdown trust
boundary; private query caches and drafts follow authenticated identity. Runtime
activation/slash discovery and branch-local composer controls are implemented. See [skills](skills.md) for behavior,
policy, owner-scoping, and draft/conflict contracts.

## Skill commands in chat (US-40.4)

The shared chat input composes an optional authenticated skill controller for both
new and existing General/project chats. Existing Popover, Button, Badge, FieldSet
and Empty primitives provide discovery, controls and errors. A pure leading-command
parser leaves ordinary slash text alone. Generated eligible queries supply names;
accepted snapshots stay server-owned. Skills are never inferred from descriptions.

Pending prompt/skill metadata persists per owner/workspace/branch in tab-local
storage. Accepted and pending states remain distinct, with explicit stale-state
reload and literal-send recovery. Read the [skills contract](skills.md#chat-composer-and-slash-commands)
for keyboard, touch, replay and failure behavior. No UI library dependencies were added.

Admin Settings includes a lazy Skills pane with the global activation switch.
It uses the existing admin-only policy API, generated query/mutation options,
and shared mutation invalidation. Non-admin users cannot mount its controls or
request policy through this pane. User-owned source/assignment editing remains
separate and available while activation is disabled.
