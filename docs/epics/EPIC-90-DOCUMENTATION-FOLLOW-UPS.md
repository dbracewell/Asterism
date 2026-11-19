# EPIC-90: Fixes found while writing the documentation

Status: proposed (2026-11-19). Source: user request (2026-11-19), from the
follow-ups recorded during EPIC-87 to EPIC-89.

## Objective

Fix the small app problems found while writing the architecture guides, the
README and the user guide. Each is a code, copy or help-text fix that makes the
app match what the guide tells people, or removes a confusing message. Where a
fix changes what a screen shows, the matching guide page and screenshot are
updated in the same story.

Out of scope: new features, apart from two decided below: a headless Chromium
in the image (US-90.8) and the user guide served from the app (US-90.9, EPIC-89
open question 1).

## Where things stand (verified 2026-11-19)

| Problem                         | What happens today                                                                                                                                                                                              | Found in         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Admin routes answer 401         | `get_current_admin` raises `UnauthorizedException` for a signed-in non-admin. The browser treats 401 as an expired token, drops it and refetches, so the request reads as "signed out" instead of "not allowed" | EPIC-87          |
| Hidden branch after a tool step | Regenerating an answer that searched files puts the new branch on the hidden tool-call step. The API reports `2 / 2` there, but no switcher shows, so the earlier answer can't be reached                       | US-89.1          |
| Compaction names a model id     | With no run in progress, `ChatOrchestrator._summarizer` uses `str(self.agent.model_id)` as the name, so a Compact now divider reads "Written by a09bb3f6-…"                                                     | US-89.3          |
| Source page shows no passage    | Opening a source or citation shows the file name, "Authorized source in the current file scope of this conversation." and Download source. The passage is only in the hover preview                             | US-89.3          |
| Help text gaps                  | The help registry has no entry for Spot the error. The `admin.users` page guide says "Accounts are not otherwise changed here", but the page suspends, resets and deletes accounts                              | US-89.5, US-89.9 |
| New sub-agent shows an error    | Create sub-agent shows "Choose an available model. The saved binding remains until you save a replacement." under Model before anything is chosen, though nothing is saved                                      | US-89.7          |
| Labels disagree                 | The sign-in button says **Login** (the form, toast and guide say "sign in"); the sidebar says **New Chat** and the General page **New chat**; Settings says **Default Model**                                   | US-89.2          |
| No Chromium in the image        | The web fetch tool falls back badly on short or JavaScript-heavy pages it would render with Playwright (`tools/builtin/fetch.py`), because the container image has no Chromium                                  | US-88.1          |
| 401 for permission checks       | Nothing stops a new role, group or policy check from raising `UnauthorizedException`, which signs the person out in the browser. US-90.1 fixed the admin checks found so far                                                    | US-90.1          |

## Decisions

- **One problem per story**, so each can be confirmed and merged on its own.
- **Guide and screenshots move with the app.** A story that changes visible text
  or behavior updates the affected `docs/guide/` page and reruns the affected
  shots (`pnpm docs:screenshots --only …`), and `pnpm docs:check` passes.
- **Help text follows the help registry rules (ADR-0032)**, and any change to a
  definition is mirrored in `docs/terminology.md`.
- **Labels use sentence case** ("New chat", "Default model") and "Sign in" for
  the action, matching the guide's voice.
- **Chromium goes in, and the image gets smaller** (decided 2026-11-19).
  Measured on the current image, 10.8 GB in total: the backend `.venv` is 5.6 GB, of which the NVIDIA libraries are 2.9 GB, `torch` 914 MB and
  `triton` 652 MB; the root `node_modules` is 846 MB, development packages
  included; Node is copied twice (about 140 MB). CPU-only `torch` is 585 MB (ARM)
  to 700 MB (x86-64) against about 4.6 GB with its GPU packages, so it becomes
  the default, with a GPU build as a build option. A headless Chromium shell is
  340 MB plus 26 MB of libraries; Playwright's `install-deps` would add 333 MB
  (a virtual display, LLVM and Mesa, extra fonts) that a headless browser does
  not need. `libgbm.so.1` is unpacked from its package on its own so LLVM and
  Mesa stay out. Tried in a throwaway container: JavaScript pages render and
  screenshots work as the non-root user with the fetch tool's launch arguments.
  Expected result: about 6.5–7 GB.
- **The guide is served from the app** (decided 2026-11-19), so it matches the
  installed version and works where the repository is unreachable. The Markdown in `docs/guide/` stays the source and still reads on
  GitHub. It gets its own trusted renderer; the chat Markdown viewer's URL policy
  (`components/markdown-viewer/policy.ts`) is not loosened.
- **The switcher follows the step that holds the versions** (US-90.2, decided
  2026-11-19). Regenerate re-runs from the visible answer's parent, so the new
  version is a sibling of the run's first step. When that step calls a tool,
  it has no footer, and nothing the backend does can put the version on the
  visible answer: a run that searches again always starts with a tool step. So
  the visible answer's switcher controls the nearest step in its turn that has
  other versions (`features/chat/lib/turn-branch.ts`). The tree and the API
  are unchanged. The run-diff dialog keeps its "first fork in the turn" rule;
  the two differ only when one turn has forks at two different steps.

## User stories

Suggested order: US-90.1 → 90.2 → 90.3 → 90.4 → 90.5 → 90.6 → 90.7 → 90.8 →
90.9 → 90.10.

### US-90.1: Admin routes refuse non-admins with 403

As a signed-in non-admin who opens an admin request, I'm told it's not allowed,
and I stay signed in.

- [x] `get_current_admin` raises a 403 (forbidden) for an authenticated non-admin;
      a missing or invalid token still gets 401.
- [x] The frontend keeps its cached token on 403 and shows "not allowed" rather
      than signing the person out.
- [x] Backend and frontend tests for both cases; check nothing else relies on the 401.
- [x] Folded in: `POST /users/` refuses a signed-in non-admin without the system
      key with 403; another user's agent reads as 404, like a missing one.

### US-90.2: The branch switcher shows after regenerating a tool-using answer

As a user, when I regenerate an answer that searched my files, I can switch back
to the earlier answer.

- [x] Reproduce: a project chat whose answer used `search_knowledge`; regenerate.
- [x] Decide where the fix belongs: create the sibling at the visible answer, or
      show the switcher for the step that holds the branches. Record the choice.
- [x] Fix, with a test that the earlier answer is reachable.
- [x] Add a project-chat branch shot to the screenshot pipeline and use it in
      `docs/guide/02-chatting/regenerating-and-branches.md`.

### US-90.3: Compaction summaries name their model

As a user who reads a compaction summary, I see which model wrote it.

- [x] Look up the run model's name when compacting outside a run, instead of
      using its id.
- [x] Test the Compact now path; check stored records and the divider.
- [x] Consider repairing stored records whose name is an id (data migration if
      the stored value changes).

### US-90.4: The source page shows the passage

As a user who opens a source or citation, I see the passage Asterism used, not
only the file name.

- [x] Show the cited passage (and its place in the file where known) on the
      scoped file page, with plain wording instead of "Authorized source in the
      current file scope of this conversation."
- [x] Keep Download source and Back to conversation.
- [x] Tests; update `docs/guide/02-chatting/sources-and-citations.md` and add a
      shot of the page.

### US-90.5: Help text covers Spot the error and the Users page

As a reader of the in-app help, I find Spot the error explained and the Users
page described correctly.

- [x] Add `concept.mode-spot-the-error` to the help registry and list it under
      `concept.learning-mode`.
- [x] Rewrite the `admin.users` page guide for suspend, reactivate, reset links,
      delete and deletion requests.
- [x] Mirror any changed definitions in `docs/terminology.md`; registry tests pass.

### US-90.6: A new sub-agent shows no error before it's submitted

As a user creating a sub-agent, I'm not warned about a saved model that doesn't
exist.

- [ ] Show the "saved binding" message only when editing a sub-agent whose bound
      model is unavailable; a new sub-agent shows a plain hint until submitted.
- [ ] Tests for new and edited sub-agents; retake `sub-agent-new`.

### US-90.7: Consistent labels

As a user following the guide, the buttons say what the guide says.

- [ ] Rename **Login** to **Sign in**, **New Chat** to **New chat** and
      **Default Model** to **Default model**; check other title-case labels in
      settings (for example **Font Size**, **Show Thinking**, **Prompt Coach**)
      and fix them the same way.
- [ ] Update tests and E2E selectors that match the old text.
- [ ] Rerun the affected shots and update the guide pages that quote the labels.

### US-90.8: Slim the image and add Chromium

As an administrator, the web fetch tool reads JavaScript-heavy pages in the
container, and the image is smaller than before.

- [ ] Measure the current image and record the size of its largest parts.
- [ ] Install CPU-only `torch` and `torchvision` by default from PyTorch's CPU
      index, with a GPU (CUDA) build selected by a Docker build argument; image
      generation, embeddings and captioning tests pass on both.
- [ ] Ship only the frontend's runtime packages (Next standalone output or a
      production-only install), keeping the `auth` migration command working at
      startup; copy the Node runtime once.
- [ ] Install Playwright's headless Chromium shell with the minimal library set
      (no `install-deps`), and comment the `libgbm` step in the Dockerfile.
- [ ] Container test: the fetch tool renders a JavaScript-heavy page as the
      non-root user with its launch arguments.
- [ ] Measure again; record before and after sizes, the GPU build and the
      Chromium behavior in the deployment guide and release notes.

### US-90.9: Serve the guide in the app and link the Help center to it

As a user reading the in-app help, I can open the full walkthrough for the
version of Asterism I'm using.

- [ ] Add a `/help/guide/[...slug]` route that renders `docs/guide/*.md` at build
      time with a trusted Markdown renderer, separate from the chat viewer
      (whose policy stays unchanged).
- [ ] Serve `docs/guide/images`, turn relative `.md` links into app routes, and
      point links outside the guide to the repository.
- [ ] Copy `docs/guide` into the Docker frontend build stage.
- [ ] Add a "Read the full walkthrough" link to each page guide that has a guide
      page, with a test that every link resolves.
- [ ] The Markdown files stay readable on GitHub and `pnpm docs:check` passes.

### US-90.10: 403 is the rule for "signed in but not allowed"

As a signed-in person refused by any route, I'm told it's not allowed, and I
stay signed in. As a contributor, I can't accidentally answer a role or
permission check with 401.

- [ ] State the convention in `docs/architecture/auth-and-security.md`: 401
      means "sign in again" (missing, expired or forged token, suspended or
      deleted account, wrong system key); 403 means "signed in but not
      allowed"; another user's resource is 404.
- [ ] Audit every `UnauthorizedException` raise and move any role, group or
      policy check to `ForbiddenException` (or `NotFoundException` for
      ownership), with tests updated.
- [ ] Add a backend test that fails when `UnauthorizedException` is raised
      outside an allowlist of token, suspension, deletion and system-key
      checks, with a message that points to the convention.
- [ ] Note the convention in `apps/backend/README.md` where routes and
      dependencies are described.
