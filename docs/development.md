# Developing Asterism

How to set up a development environment, run the app locally, and run the checks
that CI runs. For deploying an instance, see the [deployment guide](deployment.md);
for how the system is built, see the [architecture guides](architecture/README.md).

## Prerequisites

- **Node.js** 22.13 or later and **pnpm** 11 or later
- **Python** 3.13 or later, linked against **SQLite 3.45** or later (the backend uses
  SQLite's binary JSON functions), and **uv**
- **mprocs** 0.9.6 or later, to run both apps side by side (`brew install mprocs`,
  or its npm or cargo install)
- **Docker**, only for the container checks

## Set up

1. Install dependencies:

   ```bash
   pnpm install
   pnpm --filter @asterism/backend sync
   ```

2. Create the root `.env` from the example and fill it in:

   ```bash
   cp .env.example .env
   openssl rand -base64 32   # once for each secret
   ```

   Set `PUBLIC_URL` (normally `http://localhost:3000`), the three secrets, and
   `STORAGE_ROOT` to an absolute directory you can write to. The file has a
   [strict syntax](deployment.md#env-file-syntax).

3. Check the configuration. This reads the settings and reports where each came
   from and whether it is valid, without opening a database or printing values:

   ```bash
   pnpm config:check
   ```

4. Create the storage directory, then create or upgrade both databases:

   ```bash
   pnpm --filter @asterism/frontend migrate:db
   pnpm --filter @asterism/backend init:db
   ```

   Both keep existing data. Run them again after pulling schema changes; the backend
   refuses to start until its database is at the current revision.

## Run

```bash
pnpm dev
```

The root launcher checks and loads `.env`, then starts the frontend and backend in
mprocs panes. Press `q` to stop both. Changing `.env` needs a restart of the
launcher, not just of one pane.

Open <http://localhost:3000>, never the backend port. Next.js forwards `/api/py/…`
(WebSockets included) to FastAPI on port 8000, as nginx does in the container. The
API schema is at <http://localhost:3000/api/py/openapi.json>. The backend never
receives Better Auth's secret or the admin passphrase.

To run without mprocs, start each app in its own terminal:

```bash
pnpm --filter @asterism/frontend dev
pnpm --filter @asterism/backend dev
```

The package scripts are the supported entry points. Raw `next`, `uvicorn` or
`python -m` commands don't load `.env`, so their caller must provide a complete
environment.

The first time you open the app, create the administrator account with
`ADMIN_PASSPHRASE` and connect a model provider, as in the
[deployment guide](deployment.md#5-first-administrator-and-setup).

### Resetting local data

`pnpm reset:db` deletes and recreates both local databases and clears uploaded
files and search vectors, keeping downloaded model bundles. It shows the exact paths
and asks you to type `RESET`; in a script, pass `pnpm reset:db -- --yes`. It is for
throwaway development data only, never part of an upgrade
([initialization and reset](architecture/development-reset.md)). Back up anything
you want to keep first.

## Checks

Run these before opening a pull request. CI runs the same ones.

```bash
pnpm format:check    # or pnpm format to fix
pnpm lint
pnpm typecheck
pnpm test            # backend, frontend and root script tests
pnpm docs:check      # links, anchors and images in the documentation
pnpm check:pins      # base images by digest, actions by commit SHA
node scripts/run-isolated-e2e.mjs   # browser tests against a disposable stack
```

`pnpm ci:local:quality` and `pnpm ci:local:e2e` run the full CI jobs locally,
including a clean install.

- **Unit and integration tests** never load `.env` and use disposable storage. They
  never touch your working database.
- **The isolated end-to-end runner** creates a temporary auth database, storage and
  configuration, starts both apps on ports 3000, 3100 and 8000 (which must be free),
  runs Playwright with one worker, and removes everything afterwards. Install the
  browser once with `pnpm --filter @asterism/frontend exec playwright install chromium`.
- **Focused runs** use the workspace scripts, for example
  `pnpm --filter @asterism/backend test` or `pnpm --filter @asterism/frontend test`.
  Each app's README lists its own commands: [backend](../apps/backend/README.md),
  [frontend](../apps/frontend/README.md).

### Container checks

CI's **Build and check the image** job (`image-checks`, US-91.2) builds the full
CPU image on every push and pull request, with the build cache kept in GitHub
Actions, and runs the first four checks below against it. A change that breaks
the image fails there, not in an upgrade. The fourth (US-91.6) seeds a volume
with the previous release's image and upgrades it to the new one: an account,
a chat, indexed files and a theme must all survive, and the previous image must
refuse the upgraded volume. Before the first release it is skipped with a
message. The image must stay within a **5 GB**
budget (unpacked); when it grows past it, the job lists the largest layers.
Raise `--max-size-gb` in `.github/workflows/ci.yml` only as a decision, noted in
the release notes.

With Docker, these check the image and its configuration using generated,
throwaway secrets, containers and volumes:

```bash
docker build -t asterism:local .
pnpm check:image                      # starts it: healthy, both databases migrated, pages answer, UID 10001, size budget
pnpm check:fetch-browser-container    # the web fetch tool's headless Chromium renders JavaScript
pnpm check:theme-storage-container    # themes save and replace as UID 10001 on a fresh volume
pnpm check:upgrade                    # the previous release's volume upgrades to this image, keeping its data
pnpm test:container-config            # the same .env values reach the repo loader, Compose and docker run
python3 docker/smoke-test.py asterism:local   # both secret modes, two origins, headers, no leaked secrets
pnpm test:container-launch            # the backend refuses more than one worker
pnpm capacity:check                   # a class of 30 against the image (a 10-minute run plus setup)
```

The [scripts README](../scripts/README.md) describes every root script and its options.

### Pinned build inputs

The Dockerfile names each base image by tag and digest
(`python:3.13-slim-trixie@sha256:…`), and every workflow names each action by
commit SHA with its version after it (`actions/checkout@<sha> # v4.4.0`), so a
rebuild of a commit pulls the same bases and runs the same workflow code
(US-92.1). `pnpm check:pins` fails on an image without a digest or an action
without a SHA, naming the file and line. A `FROM` naming an earlier stage and a
local action (`uses: ./…`) need neither. To pin a new one:

```bash
docker buildx imagetools inspect node:22-bookworm-slim | grep -m1 Digest
gh api repos/actions/checkout/git/ref/tags/v4.4.0 -q .object.sha   # an annotated tag: resolve it with git/tags/<sha>
```

### Dependency updates

Dependabot ([`.github/dependabot.yml`](../.github/dependabot.yml)) opens pull
requests weekly for GitHub Actions, the Dockerfile's base images, npm (the pnpm
lockfile) and uv (the backend lockfile). Each ecosystem's minor and patch updates
come grouped in one pull request; each major update comes on its own. Releases
younger than a week are held back, except for security updates. For the base images,
Dependabot only refreshes digests: moving to a new Python or Node version is a
planned change, made by hand with its own pull request. The E2E job's
`container:` image isn't covered by Dependabot: update its digest by hand.

To review one:

1. Read what changed: Dependabot links each package's release notes. For a major
   update, read its migration guide (for Next.js, `node_modules/next/dist/docs/`),
   and check whether it changes stored data, such as better-auth's tables.
2. Let CI finish. **Build and check the image** includes the upgrade check from the
   previous release, so a base image or auth change that breaks stored data fails
   there.
3. A change to what ships in the image (a base image, a backend or frontend runtime
   package) gets a release-notes line under Image when it fixes a vulnerability or
   changes behavior. Development-only updates need none.
4. Merge like any other pull request. A pull request that fails stays open: fix it on
   its branch, or close it and tell Dependabot to ignore that version
   (`@dependabot ignore this minor version`) with a reason in the comment.

## Working on the code

- **Changing the API.** After a backend route or schema change, regenerate the
  frontend client with `pnpm codegen` while the backend is running (it reads
  `http://localhost:8000/api/py/openapi.json`, or the file or URL in
  `OPENAPI_INPUT`), and commit the result.
- **Changing the schema.** Every backend schema change ships as an Alembic migration
  with an upgrade test ([backend README](../apps/backend/README.md#database-initialization-and-migrations),
  [ADR-0069](adr/0069-versioned-schema-migrations.md)).
- **The version.** The root `package.json` holds the app version. The frontend
  and backend `package.json`, the backend's `pyproject.toml`, its `uv.lock`
  entry and `ASTERISM_VERSION` in `.env.example` (the image a fresh install
  runs) repeat it, and `pnpm check:workspace-tasks` fails when one differs
  (US-91.1, US-91.5). Status and backups read it from the backend package.
- **Release notes.** A change that administrators need to know about
  (configuration, stored data, the image or documented behavior) adds a line
  under "Unreleased" in [`release-notes.md`](release-notes.md).
  `pnpm check:release-notes` compares your branch, including uncommitted work,
  with `origin/main` and fails when it adds a migration or changes
  `scripts/config-contract.mjs` without touching the release notes. CI runs it
  against the pull request's base.
- **Process.** Work is planned as epics and stories in `docs/epics/` and tracked in
  [`todo.md`](../todo.md); [`AGENTS.md`](../AGENTS.md) describes the workflow and the
  rules every change follows.
- **Documentation.** Update the matching architecture guide in the same change
  ([writing guides](architecture/CONTRIBUTING.md)).

## Releasing

Releases use [semantic versions](https://semver.org/). While the version is 0.x,
raise the minor version for new features or changes to stored data or
configuration, and the patch version for fixes only.

1. Make sure everything to release is merged into `main`, CI passed on it, and
   "Unreleased" in the [release notes](release-notes.md) says what an
   administrator needs to know.
2. On an up-to-date, clean `main`, check, then release:

   ```bash
   pnpm release 0.2.0 --dry-run
   pnpm release 0.2.0
   ```

   The command refuses unless `main` matches `origin/main`, has no local
   changes, and all three expected CI checks passed on that commit (it asks
   GitHub with `gh`). It refuses a version that isn't newer than the last
   `v*` tag or is older than the current version, and an empty "Unreleased".
   Then it sets the version in every package (`scripts/app-version.mjs`), turns
   "Unreleased" into `## 0.2.0 (<date>)` under a new empty "Unreleased", and
   commits `release: v0.2.0` with the annotated tag `v0.2.0`.

3. Check the commit with `git show`, then publish it:

   ```bash
   git push origin main v0.2.0
   ```

   To change your mind before pushing: `git tag -d v0.2.0 && git reset --hard HEAD~1`.

4. Pushing the tag runs the **Release** workflow (`.github/workflows/release.yml`,
   US-91.5). It checks the tag is the app version, builds the CPU image for amd64
   and arm64 on native runners, pushes each by digest only, pulls it back and
   runs the image checks above against it. Only when both pass does it tag
   `ghcr.io/dbracewell/asterism:<version>`, and `latest` too when the version is
   the newest `v*` tag, so a late or re-run older release never moves `latest`
   back. Watch it under Actions; if it fails, nothing is tagged. Re-run it once
   the cause is fixed outside the image, or release a new patch version, since
   the tag stays.

   To rehearse before a release, run the workflow by hand (Actions → Release →
   Run workflow): it builds, pushes by digest and checks both architectures,
   and tags nothing. Only a pushed tag publishes; a run started by hand never
   does, even on a release tag.

   The first publish creates the package as private. Make it public once, in
   the package's settings on GitHub, so administrators can pull it without
   signing in.
