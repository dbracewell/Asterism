# Asterism Frontend (Next.js 16)

Requires Node.js 22.13+ and pnpm 11+.

## Configuration and development

Use only the repository-root `.env.example` / `.env`; app-local dotenv files are
rejected. The root README documents the required strict portable syntax and
initialization steps. `PUBLIC_URL` sets Better Auth's public base URL;
`BETTER_AUTH_SECRET`, `SYSTEM_KEY`, and `ADMIN_PASSPHRASE` are persistent secrets.
Auth storage defaults to `${STORAGE_ROOT:-/storage}/users.db`, with an optional
`BETTER_AUTH_DB_PATH` override.

Browser API, WebSocket, and SSE requests always use the current origin. No
`NEXT_PUBLIC_*` URL settings are needed. Server-side API calls use loopback port 8000. Next.js rewrites `/api/py/*` to FastAPI for local development; nginx handles
that path in Docker. The rewrites preserve trailing slashes so FastAPI collection
routes do not redirect browsers to the internal backend origin and lose their
Authorization header. After changing this routing, restart Next.js and reload
with browser caching disabled to discard any previously cached 308 redirects.

From the repository root:

```bash
pnpm install
pnpm dev                              # both applications in mprocs
pnpm --filter @asterism/frontend dev  # frontend only
```

Both commands use the root launcher. Explicitly exported variables take precedence
over the root file. Restart the root launcher after changing `.env`; restarting only
an mprocs pane retains its inherited environment. Docker Compose also consumes the
root file.

Runtime auth and the official migration CLI use the same database path. Create
its parent directory before local migrations (Docker creates `STORAGE_ROOT`). To
intentionally recreate auth storage, stop the app, run
`pnpm --filter @asterism/frontend reset:db`, inspect the absolute target, and type
`RESET`. Noninteractive cancellation never deletes the selected database.

Open `http://localhost:3000`. Next.js allows only one dev process per app directory.

## Current versus planned capabilities

The admin navigation marks **Groups, Users, Image Generation, Code Execution and
Export** as **Planned**. Their panes explain future scope and offer no configuration
actions. Providers, Theme Editor, Tools and Image Captioning remain available;
user settings expose General, Personas, Skills, and Agents.

| Capability           | Available now                                                                                                                                            | Planned                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Providers and models | Admin provider/model configuration; per-chat model selection                                                                                             | —                                                          |
| Agents and tools     | User main/sub-agent settings; admin tool policy and provider settings                                                                                    | —                                                          |
| Skills               | Private skills editor/assignments, admin policy, slash discovery, branch-local activation and provenance ([contract](../../docs/architecture/skills.md)) | Automatic skill selection                                  |
| Appearance           | User theme/font preferences; admin Theme Editor                                                                                                          | —                                                          |
| Image captioning     | Admin captioning policy and file-processing integration                                                                                                  | —                                                          |
| Users and access     | Admin/user access checks, owner scoping and backend user lifecycle                                                                                       | Users management screens and permission-policy controls    |
| Groups               | —                                                                                                                                                        | Group management and group policy settings                 |
| Image Generation     | Image search and captioning are separate existing capabilities                                                                                           | Image-generation providers, models and generation workflow |
| Code Execution       | —                                                                                                                                                        | Sandboxed execution and runtime settings                   |
| Export               | Individual file downloads                                                                                                                                | Data/conversation export tools                             |
| Personas and memory  | Persona CRUD/defaults, chat selection and immutable execution inputs                                                                                     | Long-term memory engine                                    |

The Users badge describes unfinished administration screens, not missing access
control. Backend list/provision/delete routes already have authorization and
lifecycle checks. Navigation visibility does not grant access. Persona settings manage separate USER.md instructions and one default; chats can
follow that default or select a fixed persona. Accepted turns preserve their
instructions and provenance. Long-term memory remains future work. See the [product-surface inventory](../../docs/architecture/frontend-and-themes.md#current-versus-planned-product-surface) for ownership
and limits.

## Authentication layout

Setup and login share a route-scoped dynamic-height scroll container. Small forms
center; taller forms scroll through the final action, including at 200% text size.
Validation failures focus a wrapping summary without discarding input. Keyboard
scroll padding keeps focus rings visible. Auth-only viewport metadata requests
layout resizing for supporting virtual keyboards while retaining browser zoom.
See the
[frontend layout guide](../../docs/architecture/frontend-and-themes.md#authentication-viewport-and-focus-contract-us-321).

## Settings, dialogs and file panes

Settings section navigation follows the pane width and preserves unrelated URL
parameters. Theme Editor stacks its list and form in narrow containers; file grids
fit below 250px. Dialogs share a dynamic viewport height cap and scroll through long
content to their footer and close actions. See the
[container and scroll contracts](../../docs/architecture/frontend-and-themes.md#settings-dialogs-and-file-panes-us-322).

## Agents and the new-chat page

Every user has exactly one main agent, configured under **User Settings → Agents**.
It has no model of its own and there is nothing to choose: every new chat uses it,
with the model and persona picked in the composer. Users may define any number of
sub-agents, each bound to one fixed model; a project selects which of them its chats
may delegate to, and General chats never delegate. The new-chat page therefore shows
only the workspace (General or a linked project) and up to four suggested prompts
from the project description and the user's eligible skills. See
[agent runtime](../../docs/architecture/agent-runtime.md).

## Chat content and composer layout

Chat history and the composer share normal flow. The composer has a bounded scroll
area for expanded context and attachments, so it cannot cover the last response.
Wide Markdown tables, code and math scroll locally with keyboard focus; long text,
filenames and tool arguments wrap. Query failures expose retry and distinguish an
initial failure from a failed refresh of saved messages. See the
[chat layout contract](../../docs/architecture/frontend-and-themes.md#rich-chat-content-and-composer-clearance-us-323).

## Sidebar navigation

General has an expandable list of five chats per page alongside the five-project
list. It stays scoped to General while browsing projects. A longer General chat
list appears below Workspaces when General is selected, matching the scoped
project-chat section. Both General lists expand independently. General and
Projects share text alignment and full-row selection highlighting. Chat actions remain
available, and deleting the last chat on a later page returns to a valid page.
Persisted sidebar preferences are read on the server for consistent hydration;
icon-collapse mode hides nested controls and empty-state text. See the
[workspace navigation contract](../../docs/architecture/project-workspaces.md).

## Mobile workspace layout

The workspace shell fills the dynamic viewport. A full-width sticky mobile header
opens the sidebar with one tap; its title does not overlap the trigger. Drawer
navigation dismisses it, and closing restores focus and normal page interaction.
Main pages scroll in the workspace inset, Settings panes scroll locally, and
sidebar navigation scrolls between its header and user footer. See the
[mobile shell contract](../../docs/architecture/frontend-and-themes.md#mobile-workspace-shell).

## LLM provider administration

Administrators configure providers under **Settings → Admin Settings → Providers**.
Choose **OpenAI** for the fixed canonical API URL, or **Generic OpenAI** for an
administrator-supplied compatible HTTP(S) URL. Model discovery is performed by
the authenticated backend API, not directly by the browser. Context-window and
tri-state vision values show their catalog/provider/manual/unknown provenance;
unknown Generic OpenAI metadata can be completed manually and manual values are
preserved on refresh. See
[LLM Providers and Model Capabilities](../../docs/architecture/llm-providers.md).

## Files and project context

**Files** manages uploaded sources, processing status, and canonical image captions.
Users can retry failed work and regenerate a file's embedding and caption.
Captions become searchable after successful generation without an approval step.
Regeneration discloses when an external provider may receive the image.
Administrators select captioning through the single versioned `knowledge.processing` policy; policy
changes queue replacements while existing ready generations remain searchable.

Projects and library pickers compose the shared FileManager. Adding a library file
to a project creates a reference; removing the reference preserves its source and
artifacts. Chat attachment scope follows the active branch and current project.
Runtime policy derives `search_knowledge` availability from that live context.
All server data uses generated clients and TanStack Query. Query errors expose
Retry; cached files stay visible on refresh failure, and failures never appear as
empty results. Processing actions report errors and support retry.

## Docker and migrations

Only the repository-root Dockerfile and Compose configuration are supported.
Dependencies use the root workspace lockfile; the standalone frontend lockfile,
Dockerfile, and build-approval configuration have been removed.

The container runs the official `auth` CLI before Next.js, pinned to 1.6.11 to
match Better Auth. The image includes `src/lib/auth-cli.ts` and passes it explicitly
with `--config`; startup requires no package downloads or custom migration script.
Migrations create missing tables without resetting users. Migration failure prevents
startup. Back up persistent storage before upgrades; do not use `reset:db` for
container startup. Update the CLI alongside Better Auth when upgrading.

Local migrations, from the repository root:

```bash
pnpm --filter @asterism/frontend migrate:db
pnpm --filter @asterism/frontend exec node --test scripts/test-docker-auth-migrations.mjs
```

Local proxy regression check (stop local dev servers first; uses ports 8000 and
30999 with an in-memory test database):

```bash
node scripts/test-dev-proxy.mjs
```

The combined deployment smoke test is documented in the root README.

## Quality and API generation

See [Frontend layout, themes, and product surface](../../docs/architecture/frontend-and-themes.md)
for theme loading, scroll ownership and current-versus-planned settings. The
[2026-10-17 review](../../docs/reviews/2026-10-17-codebase-review.md) records
the original theme trust defects, short-screen setup clipping and palette contrast
failures. US-31.1 now validates public palette reads and requires administrator
authorization in editor actions. US-31.2 stores custom palettes/overrides under
`STORAGE_ROOT/themes`, keeps bundled defaults read-only, atomically saves edits,
and retains failed drafts for retry. See [theme storage and lifecycle](../../docs/architecture/theme-storage.md)
for backup/reset and the single-writer deployment contract. US-31.3 disables raw
Markdown HTML and automatic image resources, limits links and constrains KaTeX;
see the [content policy](../../docs/architecture/markdown-content.md). EPIC-32 layout work is complete. US-33.1 repairs bundled palette and shared
control contrast. US-33.2 adds semantic feature states, named settings/icon controls,
inherited body typography, JetBrains Mono code and reduced motion; the wordmark
now uses the UI face (see [ADR 0024](../../docs/adr/0024-type-system.md) for the
type scale: `text-display`, `text-title`, `text-heading`, `text-body`, `text-meta`). See [typography, labels and motion](../../docs/architecture/frontend-and-themes.md#typography-labels-and-motion-us-332)
and the [syntax mapping](../../docs/architecture/markdown-content.md#code-typography-and-syntax-palettes).
US-33.3 extends these fixtures with all-theme schema/contrast gates and a
container/height/text-size browser matrix; see the [review matrix](../../docs/architecture/theme-layout-review-matrix.md)
for exact coverage, artifact locations, manual review and exceptions.

For full browser verification, use the root isolated runner; it owns fresh auth,
backend, and file/vector storage plus the internal JWKS bridge. Playwright serves a
production build (set `E2E_DEV_SERVER=1` to use `next dev` while iterating), and
screenshot comparisons run only on macOS, where the baselines were rendered. Its fresh-install
project runs before account creation. The authenticated workspace spec uses real
app APIs and sockets against a local model double; focused harness specs retain
mocked boundaries. Every spec imports `test` from `e2e/support/test.ts` so unhandled
page errors fail the run; keep that shared fixture when adding cases. Model-picker dialog regressions exercise pointer selection,
search, keyboard replacement and Escape/focus return at desktop, short-phone and
enlarged-text sizes. Knowledge mocks use the generated-contract response helper in
`e2e/support/knowledge-artifact.ts`, including required generation/identity fields
and the current `extractions` map. See [US-34.3 verification](../../docs/reviews/us-34.3-verification-2026-10-24.md)
and [runner details](../../scripts/README.md#run-isolated-e2emjs).

From the repository root:

```bash
pnpm --filter @asterism/frontend lint
pnpm --filter @asterism/frontend typecheck
pnpm --filter @asterism/frontend test
node scripts/run-isolated-e2e.mjs       # isolated E2E fixture, from repo root
pnpm --filter @asterism/frontend codegen
```

The correct architecture links are under [`docs/architecture`](../../docs/architecture/README.md).

## Chat capacity errors

The chat error alert displays retryable capacity errors. Controller saturation
closes with WebSocket code 1013; the existing reconnect policy allows ten attempts
three seconds apart. Work saturation keeps the control channel open for an
explicit resume/regenerate retry, cancellation or approval. A saved pending turn
can resume after capacity frees; reconnecting does not post another message.
See [chat admission](../../docs/adr/0020-chat-capacity-admission.md) for backend
limits and accounting.

## Current runtime and operator guides

- [Execution context and module boundaries](../../docs/architecture/execution-context.md)
- [Agent settings, model provenance, delegation, and prompts](../../docs/architecture/agent-runtime.md)
- [REST acceptance, drafts, branches, and WebSocket transport](../../docs/architecture/chat-and-websocket.md)
- [Project and chat UI](../../docs/architecture/project-workspaces.md)
- [Tool policy and approval](../../docs/architecture/tool-authorization.md)
- [Context provenance and memory limits](../../docs/architecture/context-isolation.md)
- [Clean initialization and reset with model-bundle retention](../../docs/architecture/development-reset.md)

## Implementation history

Dated story notes are preserved in the
[documentation history archive](../../docs/archive/us-28.2-documentation-history-2026-10-17.md).
Use the runtime and operator guides above for current contracts.

### Bundled palette contrast

Atlas (default light) and Night Atlas (dark) are the native palettes; the six
other bundled themes are optional presets that retain documented source palettes and
accessibility adaptations. Every palette also defines `chart-1`…`chart-5`, and the
`:root` fallback in `globals.css` mirrors Atlas (enforced by `bundled-palettes.test.ts`,
which also checks 3:1 input/focus boundaries). Themes may also set `radius`,
`shadow` (soft/flat) and `density` (comfortable/compact); omitted values fall
back to Atlas. See [shape values](../../docs/architecture/theme-storage.md#shape-values-us-413).
Feature code uses the `rounded-control`/`surface`/`overlay`, `rounded-chip`/`dot` and
`shadow-raised`/`overlay` tokens; see [shape and elevation tokens](../../docs/architecture/frontend-and-themes.md#shape-and-elevation-tokens-us-414). Shared controls use distinct input boundaries, opaque focus rings and
readable hover/selected states. See the [palette mapping and review contract](../../docs/architecture/bundled-theme-palettes.md).
The test-only `/e2e/theme-contrast` route exercises production controls with each
cookie-selected theme; `e2e/theme-contrast.spec.ts` records text, boundary and focus
ratios plus screenshots. Custom theme overrides are not rewritten or certified.
Icons come only from Lucide, with one stroke width set by `LucideProvider`
([icons](../../docs/architecture/frontend-and-themes.md#icons-us-415)); UI colors
come only from theme tokens (`src/app/color-tokens.test.ts`). Brand icons, the web
manifest and the Open Graph image are generated from `src/app/icon.svg` with
`pnpm --filter @asterism/frontend generate:icons`; see
[brand assets](../../docs/architecture/frontend-and-themes.md#brand-assets-us-416).

## Personas

User Settings → Personas manages up to 20 owned personas, each with a name and
USER.md instructions. Choose one default; chats can follow it for each new message
or keep an explicit selection. Save uses revision checks and retains drafts after
conflicts. Choose another default and switch explicitly selected chats before
deleting a persona. Accepted turns preserve their instructions; resume reuses them
and regeneration captures current settings. Delegates inherit the recorded persona
within their existing capability ceilings. No long-term memory engine is active.
See [binding and storage limits](../../docs/adr/0021-personas-and-execution-binding.md).

This schema requires fresh initialization. For an older development database, use
the explicit reset workflow when ready to discard its data; story tests use
disposable storage and do not reset the working database.

## Skills settings

Open **User Settings → Skills** (`/settings?t=user&setting=skills`) to search and
page through your private skills, create a SKILL.md template, view/edit source,
preview Markdown, or delete with confirmation. Preview uses the shared Markdown
renderer: HTML is not executed and remote images are omitted. Errors retain the
source; conflicting edits offer an explicit reload that confirms discarding drafts.

Under **User Settings → Agents → Manage main-agent skills**, select up to 100
owned skills across search/pages and save assignments with the bottom-right
button. These writes do not change instructions, tools, or generation defaults.
The dialog explains the admin activation policy; editing and assigning remain
available when policy is disabled. Policy status does not grant permissions.
Private query caches and open drafts are scoped to the authenticated owner.
Type `/` at the start of a message to search eligible assigned skills, or type
leading commands such as `/review-code /write-docs Explain this`. Selection order
is preserved. Ordinary URLs, paths and later prose remain text. Unknown commands
retain the message and offer an explicit **Send as literal text** option.

Active skill chips continue across follow-ups. Remove, reorder or refresh them
before sending; changes apply only when that message is accepted. Updates are
pinned until explicit refresh/reactivation. Unavailable skills must be removed
before sending. Skill-only messages are supported. Draft text and pending skill
changes persist in this tab across reloads, scoped to user/workspace/branch.
Per-message labels show the pinned skill names/revisions. See the
[skills contract](../../docs/architecture/skills.md).

Administrators can enable or disable activation under **Admin Settings → Skills**
(`/settings?t=admin&setting=skills`). Enable **Enable skill activation**, then
choose **Save skill policy**. The policy defaults to disabled; users still need
owned skills assigned to their main agent. Disabling retains documents,
assignments and historical snapshots while blocking affected execution.
