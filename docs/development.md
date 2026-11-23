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

   This installs what the published image has, without PyTorch. To work on local
   image generation (the Diffusers generator), install the `local-image` extra
   instead: `pnpm --filter @asterism/backend sync:local-image`, which runs
   `uv sync --extra local-image`. A plain `sync` removes it again. Its tests skip
   the parts that need torch without it; CI runs them with the extra
   (`pnpm --filter @asterism/backend test:local-image`).

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

CI runs its jobs in parallel: repository checks (formatting, links, pins,
release notes, the config script tests and the Docker frontend build), the
backend, the frontend, the image, and the browser tests split into four shards.
Two summary jobs keep the required check names: **Lint, Typecheck, Test**
passes when the repository, backend and frontend jobs pass, and **Frontend E2E
(Playwright)** when every shard passes. A new push to a pull request cancels
its previous run.

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
message. The image must stay within a **4.25 GB**
budget (unpacked; lowered from 5.25 GB on 2026-11-22 once EPIC-94 removed torch
from the image, which then measured 3.82 GB on amd64); when it grows past it,
the job lists the largest layers.
The budget is set once, as `DEFAULT_MAX_SIZE_GB` in `scripts/check-image.mjs`,
so CI, the release workflow and a local `pnpm check:image` all check the same
one. Change it only as a decision, noted in the release notes.

With Docker, these check the image and its configuration using generated,
throwaway secrets, containers and volumes:

```bash
docker build -t asterism:local .
pnpm check:image                      # starts it: healthy, both databases migrated, pages answer, UID 10001, no test tooling or pip, size budget
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
planned change, made by hand with its own pull request. For uv, Dependabot updates `uv.lock`
within `pyproject.toml`'s ranges and never raises an upper cap (such as
`lancedb<0.30`, which guards the stored vectors): raising one is a change made by
hand. The E2E job's
`container:` image isn't covered by Dependabot: update its digest by hand. The
default backend install must not include torch, torchvision, diffusers or
accelerate: `pnpm check:default-install` (run in CI) fails on an update that
pulls one in and names the package that does; move it to the `local-image`
extra or leave the update out.

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

### Vulnerability scans

Trivy scans for known vulnerabilities (US-92.2):

- **Build and check the image** scans the built image and both lockfiles
  (`pnpm-lock.yaml`, `apps/backend/uv.lock`). It fails on a critical or a high
  with a fix (highs since US-95.5), and prints a table of every high and of
  criticals with no fix yet. Highs and criticals with no fix are reported
  without failing.
- The release workflow scans each architecture's pulled-back image the same way,
  so a release with a fixable critical or high is never tagged.
- The weekly **Vulnerability scan** workflow scans
  `ghcr.io/dbracewell/asterism:latest` for vulnerabilities found since it was
  released. A critical or high with a fix opens the one issue labelled
  `vulnerability-scan`, or updates it when the finding is new. Close the issue
  once the patch release that fixes it is published.

To scan locally, install the pinned Trivy and point the check at it:

```bash
TRIVY=$(node scripts/install-trivy.mjs) pnpm check:vulns --lockfiles
TRIVY=$(node scripts/install-trivy.mjs) pnpm check:vulns --image asterism:local
```

To fix a finding, update the dependency or the base image digest. To accept one
instead (it can't be reached, or no fixed release exists), add it to
[`.trivyignore.yaml`](../.trivyignore.yaml) with a `statement` saying why and an
`expired_at` date a few weeks out. On that date Trivy reports the finding again,
and `pnpm check:trivyignore` (in the quality job) fails until it is fixed or
renewed with a new reason. The check also fails on an entry missing either field.

The workflows don't use `aquasecurity/trivy-action` or `setup-trivy`: in March
2026 both had their tags repointed to a credential stealer
([GHSA-69fq-xp46-6x23](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23)).
Instead, `scripts/install-trivy.mjs` downloads a pinned release and refuses it
unless its SHA-256 matches the one in the script. Dependabot can't update that
pin. To move it, pick a release at least two weeks old, copy the Linux 64-bit,
Linux ARM64 and macOS ARM64 tarball hashes from its `trivy_<version>_checksums.txt`
into `TRIVY_TARBALLS`, update `TRIVY_VERSION`, and let CI run the scans.

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

   Each architecture is built with an SPDX SBOM and full provenance
   (`provenance: mode=max`), stored as an attestation manifest beside the image
   in the index (US-92.3). The checks pull back the architecture's image
   manifest itself, so `pnpm check:image` measures the image without them, and
   `scripts/release-image.mjs` reads the SBOM there so a rehearsal fails on one
   that can't be attested. After tagging, the publish job attests the published
   index with `actions/attest` (build provenance, and one SBOM per architecture)
   and runs `gh attestation verify` for both; the run fails if they don't
   verify. It then signs the index with cosign, keyless (US-92.4), and runs
   `cosign verify` for the release workflow's identity on this tag and the
   GitHub Actions OIDC issuer; the run fails if it doesn't verify. Only the
   publish job has `id-token: write` and `attestations: write`, and a rehearsal
   never reaches it, so it attests and signs nothing.

   To rehearse before a release, run the workflow by hand (Actions → Release →
   Run workflow): it builds, pushes by digest and checks both architectures,
   and tags nothing. Only a pushed tag publishes; a run started by hand never
   does, even on a release tag.

   The first publish creates the package as private. Make it public once, in
   the package's settings on GitHub, so administrators can pull it without
   signing in.

5. Check the published image as an administrator would, with the commands in
   [Verify the image](deployment.md#verify-the-image).

## Repository settings

The supply-chain checks (EPIC-92) rely on these settings on GitHub, which only
the repository owner can change. Each was on as of 2026-11-22; check them after
any change to the repository's settings or ownership.

- **A ruleset on `main`** (Settings → Rules → Rulesets, "Base", targeting the
  default branch): changes arrive by pull request; the three CI checks
  (`Lint, Typecheck, Test`, `Build and check the image` and
  `Frontend E2E (Playwright)`) must pass, on a branch up to date with `main`
  ("Require branches to be up to date before merging"); and `main` can't be
  deleted or force-pushed. Without it, a pull request can merge before its
  checks finish.
- **A ruleset on `v*` tags** ("Tag Ruleset", targeting `refs/tags/v*`): restricts
  creating, updating and deleting the tags, with only the repository admin role
  allowed to bypass. Pushing a `v*` tag publishes a release, so only maintainers
  may create one, and a published tag can't be moved to another commit.
- **Private vulnerability reporting** (Settings → Advanced Security), which
  [`SECURITY.md`](../SECURITY.md) tells reporters to use.
- **Dependabot alerts** (Settings → Advanced Security), alongside the
  [dependency updates](#dependency-updates) and
  [vulnerability scans](#vulnerability-scans) above.

To check them from a terminal:

```bash
gh api repos/dbracewell/Asterism/rulesets --jq '.[] | "\(.name) \(.target) \(.enforcement)"'
gh api repos/dbracewell/Asterism/private-vulnerability-reporting --jq .enabled
gh api repos/dbracewell/Asterism/vulnerability-alerts --silent && echo "Dependabot alerts on"
```
