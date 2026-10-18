# Codebase, architecture, and UI review — 2026-10-17

## Planning summary

The architecture is a reasonable foundation for a single-instance application. Keep
the current domain separation and execution-context design. Prioritize the theme
filesystem boundary, untrusted Markdown rendering, responsive reachability, and
theme accessibility before adding more product surfaces. A rewrite is not justified
by this review.

This is a breadth-first review of the current checkout, not a complete security or
accessibility certification. The baseline was clean `main`; review changes are on
`docs/codebase-review-2026-10-17`. Runtime code and theme JSON remain unchanged;
the epics below describe pending remediation. No working database was reset.

| Order | Epic                                                                    | Outcome                                                                             | Initial estimate   |
| ----- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------ |
| 1     | [EPIC-31](../epics/EPIC-31-THEME-AND-CONTENT-TRUST-BOUNDARIES.md)       | Confine theme access, enforce server authorization, and constrain untrusted HTML    | 5–8 engineer-days  |
| 2     | [EPIC-32](../epics/EPIC-32-RESPONSIVE-LAYOUT-AND-REACHABILITY.md)       | Reachable controls on short/narrow screens and bounded rich content                 | 5–8 engineer-days  |
| 3     | [EPIC-33](../epics/EPIC-33-THEME-CONTRAST-AND-UI-CONSISTENCY.md)        | Accessible palette mappings, consistent semantic states, repeatable checks          | 5–8 engineer-days  |
| 4     | [EPIC-34](../epics/EPIC-34-QUERY-BOUNDS-AND-ARCHITECTURE-GUARDRAILS.md) | Database-side search composition, runtime/module boundaries and browser-gate repair | 5–9 engineer-days  |
| 5     | [EPIC-35](../epics/EPIC-35-PRODUCT-SURFACE-AND-PERSONA-FOUNDATIONS.md)  | Honest settings navigation and a distinct persona/default-profile foundation        | 6–10 engineer-days |

Estimates include focused tests and documentation, assume one engineer, and are
planning ranges rather than commitments. Execute one story at a time. EPIC-31 is
the recommended next epic; start with US-31.1. EPIC-35 persona implementation is a
separate product milestone, not a prerequisite for fixing the current UI.
Pull US-34.3 forward alongside the initial planning order to restore the currently
failing browser gate before expanding visual coverage.

## Coverage and method

Reviewed root/app READMEs, architecture guides, current epics/checklists, CI and
isolated E2E setup; backend initialization, storage/JSON adapters, owner-scoped
queries, indexed search, execution/delegation scope, retrieval reauthorization,
job/cache bounds and JWT verification; frontend route/layout shells, settings,
project/files/chat surfaces, Markdown, shared controls, theme actions/API/loader,
and all eight bundled palettes. Generated clients and tests were inspected as
contract evidence, not manually regenerated because API contracts did not change.

Browser work used disposable auth storage and synthetic credentials. A harmless
path-traversal probe read only the repository's own frontend package manifest.
No sensitive file reads or filesystem write exploit was attempted. Static layout
risks below are explicitly distinguished from browser reproductions. Theme
measurements cover 80 opaque text-role pairs, not every composited UI state.

## Findings

### F1 — High: theme access crosses its intended filesystem/admin boundary

**Confirmed browser defect and source evidence.** An ordinary disposable user
received HTTP 200 from `/api/theme?name=../../package`; decoding the response
yielded the public manifest name `@asterism/frontend`. The
[theme GET route](../../apps/frontend/src/app/api/theme/route.ts) joins caller input
to `public/themes` without a basename allowlist or containment check. The `.json`
suffix constrains the probe to JSON paths but does not confine it to themes.

[Theme server actions](../../apps/frontend/src/features/theme/server/actions.ts)
also accept filenames without containment checks or action-local admin/session
authorization. Hiding the Theme Editor tab and requiring a session in
[the proxy](../../apps/frontend/src/proxy.ts) do not establish administrator
authorization. `saveTheme` does not await `writeFile`, so its try/catch and success
invalidation do not reliably reflect persistence. Client-only Zod validation is
not a server trust boundary. Action write exploitation was not tested.

The [Dockerfile](../../Dockerfile) copies `public` without assigning the runtime
user ownership, whereas `.next` is explicitly owned by that user. Saving themes
under the application bundle also lacks a persisted-storage contract and can fail
or disappear on replacement. Treat container edit persistence as a source-derived
deployment risk; no Docker runtime reproduction was performed. **Owner: EPIC-31.**

### F2 — High: rich content has no explicit sanitization boundary

[MarkdownViewer](../../apps/frontend/src/components/markdown-viewer/index.tsx)
enables `rehypeRaw` and has no sanitization plugin or explicit HTML allowlist.
Untrusted model/user content can therefore introduce HTML layout and resource
elements rather than only Markdown. This warrants tests for overlay/style abuse,
external image requests, URL handling and KaTeX output. React's handling of event
attributes is not an HTML policy. This review does **not** claim a demonstrated
JavaScript-execution exploit. **Owner: US-31.3**, with overflow work in US-32.3.

### F3 — High: setup controls are clipped on a short viewport

**Browser reproduced at 390×300.** The fresh setup form was 394px tall and its
submit button occupied y=366–394, below the viewport. Body overflow was `hidden`
and no element offered a vertically scrollable overflow container. See the
[captured viewport](assets/2026-10-17-auth-390x300.png). This is representative of
short windows/landscape and a keyboard-reduced viewport, not a simulation of a
specific mobile keyboard.

[Global CSS](../../apps/frontend/src/app/globals.css) locks body overflow;
[RootLayout](../../apps/frontend/src/app/layout.tsx) uses `h-screen`; the
[sign-in page](<../../apps/frontend/src/app/(auth)/sign-in/page.tsx>) centers a form
without owning scrolling. A zero horizontal-overflow assertion alone would miss
this defect. **Owner: US-32.1.**

### F4 — Medium: remaining layout risks need adversarial container tests

**Source-derived risks, not yet reproduced across all routes:**

- [Theme Editor](../../apps/frontend/src/features/settings/ui/admin-settings/theme-editor.tsx)
  keeps a horizontal two-column layout with a `w-60` selector and `w-sm` empty-state
  heading inside clipped flex ancestors; the content column lacks `min-w-0`.
- [File grid](../../apps/frontend/src/components/file-manager/file-list.tsx) uses
  `minmax(250px,1fr)` plus horizontal padding. A pane narrower than its minimum can
  require horizontal scrolling even when the outer viewport fits.
- [Shared DialogContent](../../apps/frontend/src/components/ui/dialog.tsx) has no
  default height limit/scroll policy. Some callers add one; audit the remaining
  create/edit/confirm dialogs on short screens rather than assuming all fail.
- Markdown tables/math/long tokens have no shared responsive containment policy.
  [ChatSession](../../apps/frontend/src/features/chat/components/chat-session.tsx)
  reserves a fixed 150px tail gap for an absolutely positioned composer that can
  grow with attachments and scope panels; measure last-message reachability.
- [SettingsCard](../../apps/frontend/src/features/settings/ui/setttings-card.tsx)
  chooses orientation from viewport width, clips its shell, and replaces the URL
  with only `t` and `setting`, discarding unrelated query parameters.

Recent provider/agent responsive fixes are useful patterns to retain. Broaden
coverage to container width, short height, enlarged text, keyboard focus, long
names and real content; do not globally hide overflow to make assertions pass.
**Owner: EPIC-32.**

### F5 — High: seven bundled themes have failing normal-text pairs

The [machine-readable measurements](2026-10-17-theme-contrast.json) use WCAG sRGB
relative luminance with a 4.5:1 normal-text threshold. There are **12 failing pairs
out of 80**, across seven themes. Values below are rounded for display; threshold
decisions use unrounded values.

| Theme                  | Failing paired text roles and ratios                        |
| ---------------------- | ----------------------------------------------------------- |
| Default Light          | muted 4.05; sidebar primary 3.36                            |
| Default Dark           | sidebar primary 2.46                                        |
| One Dark               | muted 2.03                                                  |
| Dracula                | muted 4.09                                                  |
| Flowers                | primary 3.33; muted 4.11; accent 2.30; sidebar primary 3.33 |
| Catppuccin Latte Mauve | muted 4.05                                                  |
| Catppuccin Mocha       | None among these ten opaque pairs                           |
| Black & Gold           | muted 3.08; accent 4.33                                     |

Several opaque ring/background pairs are below 3:1, including Light (2.53) and
Dracula's sidebar (1.73). Actual focus styles also use alpha (`ring-ring/30`), so
passing raw tokens cannot certify rendered focus visibility. Decorative borders
need not all meet the same requirement; test the cues needed to identify controls.
Destructive buttons use tinted backgrounds in the shared component, so test those
composited states rather than assuming a nonexistent destructive foreground token.

Palette-source comparison:

- Catppuccin's main colors mostly match its [official palette](https://catppuccin.com/palette/).
  Mocha's sidebar `#1c1c2c` and Latte's `#ebeef3` are custom rather than canonical
  mantle/crust values. Prefer a documented canonical surface mapping. Mocha's
  primary `#b4befe` is Lavender, not Mauve; its generic name is accurate.
- Dracula's base and purple match the [official specification](https://draculatheme.com/spec).
  Its muted text `#a3adc9` is an accessibility adaptation, but still fails on muted
  `#44475a`. Do not restore the darker comment color merely for source fidelity.
- One Dark's palette derives from the [original Atom source](https://github.com/atom/one-dark-syntax/blob/master/styles/colors.less).
  Its comment-like muted color is unsuitable for small interactive UI labels.
- Black & Gold has a UCF-themed filename but no source attribution. Verify any
  intended institutional branding before claiming official fidelity. Flowers and
  the defaults have no declared upstream source; treat them as local palettes.

[W3C text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
are the acceptance references. Preserve theme identity while adjusting semantic
roles; document intentional deviations. **Owner: EPIC-33.**

### F6 — Medium: visual and accessibility conventions are inconsistent

Auth errors, API-image errors, required markers and sub-agent success icons use
hard-coded red/green/white colors outside theme roles. The Theme Editor add button
is named “Add provider”; its duplicate icon button has no explicit accessible name.
The setup Admin Passkey label points to `name` rather than `adminPasskey`. General
settings use headings beside controls without explicit form-label associations.
The base stylesheet applies the sans family to every element, including code;
Markdown syntax highlighting always selects VS/VS2015 rather than the chosen
palette. Global prose counters reference undefined `--foreground0`.

Small icon controls include 20px variants; assess effective target areas/spacing
before declaring a WCAG target-size failure. Reduced-motion support is absent for
the custom animated border and bouncing chat dots. These observations need
component/state checks, not a redesign of the entire visual language.
**Owner: US-33.2 and US-33.3.**

### F7 — Medium: indexed search still materializes all candidate IDs

[SqliteFtsSearchIndex](../../apps/backend/asterism/domains/chat/search_index.py)
calls `result.all()` for every owner-matching chat/project ID.
[Search](../../apps/backend/asterism/domains/chat/search.py) then constructs `IN`
predicates before applying scope/pagination. Returned pages are bounded, but
candidate memory and bind-parameter count scale with every match, including chats
outside the requested project. This can become a practical large-library limit;
no measured production threshold or reproduced parameter-limit failure is claimed.
Snippet enrichment also issues one message lookup per non-title chat hit (bounded
by page size). Push matching into SQL composition and batch page enrichment.
**Owner: US-34.1.**

### F8 — Medium: product policy exceeds implemented surfaces

Groups, Users, Image Generation, Code Execution and Export admin panes currently
render placeholder text. Their navigation can imply usable configuration that
does not exist. The [playbook](../../AGENTS.md) requires a separate persona with
at least one/default per user, but the reviewed user/schema registry provides no
distinct persona/default-profile model or `USER.md` lifecycle. `agent_profiles`
contains main/sub-agent configuration, not that persona entity; execution records
`user_profile_id=None`. Long-term memory is correctly documented as unimplemented.

Make the product surface honest now; plan persona foundations separately and keep
memory activation out of that implementation. Do not claim the persona invariant
is enforced by the singleton main-agent configuration. **Owner: EPIC-35.**

### F9 — Medium: the full browser gate has stale agent-settings contracts

The full isolated suite completed **27 passed, 2 failed, retries disabled**.
`authenticated-workspace.spec.ts:431` expects a heading named “Main configuration”;
the captured page instead has a region with that name and a “Main Agent” heading.
`new-chat-agent.spec.ts:80` expects an unavailable-model alert, while the page
exposes a status with the correct text. That spec also retains older “Fixed model”
labels and option-role picker selectors that need reconciliation after the first
failure. Current unit/focused browser tests passing did not protect the full suite.

The first failures are confirmed test/UI contract drift, not evidence that the
preceding scope behavior failed. Later assertions were not all reached and must
not be assumed passing. Restore the full gate without weakening fixed-model,
selection or owner/provenance checks. **Owner: US-34.3.**

## Architecture assessment

| Boundary                   | Assessment                      | Evidence / implication                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain/query ownership     | Sound direction                 | Domain `queries.py` functions own owner filters; `db/queries.py` provides neutral pagination. Keep domain registration in the composition root distinct from shared query mechanics.                                                                                                                |
| Execution and delegation   | Sound in reviewed paths         | Immutable `ExecutionScope`, explicit tool support, General non-delegation, narrowed child scope and fixed-model identities; retain existing revocation/provenance tests.                                                                                                                            |
| Source files and retrieval | Sound in reviewed paths         | FileStore owns opaque sharded keys; project/chat references do not duplicate bytes. Runtime file reader and RetrievalService recheck live scope and artifact generation before release.                                                                                                             |
| State lifecycle            | Appropriate for one process     | Chat jobs retire on detach/idle and shutdown; queues/events/SSE have documented bounds. These are process-local, not distributed coordination.                                                                                                                                                      |
| Storage replaceability     | Partial                         | FileStore, VectorStore and search have protocols. SQLAlchemy/session management is shared, but initialization and FTS are SQLite-only; a PostgreSQL JSONB variant is not full PostgreSQL support. FileStore returns local `Path`, so an object-store swap would require a consumer contract change. |
| Frontend server state      | Mostly consistent               | Core domain data uses generated Hey API + TanStack Query. Theme filesystem operations form an exception; secure that boundary and define its storage owner.                                                                                                                                         |
| Deployment                 | State limits must stay explicit | Run one coordinated backend process/instance. Multiple workers would have separate chat/membership gates, queues and caches; horizontal scaling requires a new coordination design.                                                                                                                 |

Preserve modularity through dependency checks and contract tests. Large files such
as settings service, provider settings and ChatSession merit separation when their
behavior changes; file length alone is not grounds for a speculative refactor.
Do not build a generic query framework or add storage compatibility shims.
Job retirement is not global admission control: `ChatJobManager` has no total
active-job/controller cap. Capacity under concurrent users remains unmeasured;
review admission limits before treating the application as load-hardened.

## Documentation changes made in this pass

- Added this review, raw contrast evidence, a sequenced roadmap and five pending epics.
- Added the frontend/theme architecture guide and linked the review from root and app READMEs.
- Corrected stale source-storage/JSONB claims and documented SQLite-only and single-process limits.
- Documented theme trust/persistence gaps and the distinction between current product surfaces and future persona/memory policy.
- Preserved completed checklist history; added new stories/tasks as pending in `todo.md`.

## Verification

Results are recorded for this review checkout, not inherited from earlier stories.

- Frontend unit/integration: **135 passed / 35 files**, no unhandled errors reported.
- Focused backend scope/retrieval/resource/query tests: **34 passed**.
- Focused Chromium: **6 passed, retries disabled**, covering fresh setup, agent settings and provider controls at 390px and narrow desktop panels.
- Manual Chromium: short setup clipping and ordinary-user theme path traversal reproduced using disposable storage; no sensitive files read.
- Full backend: **437 passed** through the environment wrapper with isolated fixtures.
- Full isolated Chromium: **27 passed, 2 failed**, retries disabled; see F9. Auth/backend/source/vector storage were disposable and the runner cleaned up its servers.
- Backend Ruff: passed. Backend basedpyright: **0 errors, 0 warnings**; compileall passed.
- Frontend ESLint and TypeScript: passed.
- Frontend auth migration/preservation checks: **6 passed** using disposable databases.
- Root configuration tests: **30 passed**; workspace-task configuration check passed.
- Changed documentation Prettier and `git diff --check`: passed.
- Documentation integrity: **16 Markdown files, 153 local links** checked;
  **14 stories and 53 implementation tasks** match the epic files and live checklist exactly.
- Contrast evidence integrity: **8 themes, 80 paired roles, 12 failures** verified.

The first isolated runner attempt was sandbox-blocked from listening locally; the
approved attempt then stopped because port 8000 was occupied. After the user shut
down their servers, full isolated verification was resumed. The temporary frontend
preview was stopped before that run. Preview startup briefly lacked its disposable
auth schema; it was initialized before probes. Those setup errors are not claimed
as product regressions. Production build, Docker smoke checks, external-provider
behavior, exhaustive theme screenshots and assistive-technology testing are outside
this pass unless explicitly recorded below.

The root `pnpm lint` entrypoint stopped at pnpm's automatic dependency-status
install with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. No dependency purge was
approved or performed. Ruff and ESLint were then invoked directly from their
workspaces and both passed; this is not a passing result for the original wrapper.
The host used Node 26.10.0 rather than CI's Node 22.13.0. No remote CI run was
started. The remaining gate failure is recorded as pending US-34.3.
