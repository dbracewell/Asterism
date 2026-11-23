# EPIC-91: Release readiness

Status: proposed (2026-11-19). Source: user request (2026-11-19), following
EPIC-90.

## Objective

Make every release something an administrator can trust and install without
building from source: one version number, an image that CI has started and
checked, release notes that list what to do, and a published image they can pull.

Out of scope: new features, hosting, and automatic updates.

## Where things stand (verified 2026-11-19)

| Area          | What happens today                                                                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version       | Three numbers disagree: the root `package.json` says 1.0.0, `apps/frontend` and `apps/backend` say 0.1.0. Status and backup manifests report the backend package version (`asterism-core`), so every install says 0.1.0. There are no git tags.       |
| CI and Docker | CI builds only the `frontend-build` stage and runs `docker/test-backend-launch.py`, which checks the worker guard in a minimal image and "does not substitute for the full application smoke test". Nothing in CI builds the full image or starts it. |
| Image checks  | `pnpm check:fetch-browser-container` (US-90.8) and `scripts/check-theme-storage-container.mjs` exist but run only by hand. The image's size (4.4 GB after US-90.8) is not watched.                                                                    |
| Release notes | `docs/release-notes.md` started in US-90.8 with an "Unreleased" section. Nothing asks a story to add to it, and nothing turns "Unreleased" into a version.                                                                                            |
| Upgrades      | Migrations ship with a test that upgrades a database seeded at the previous revision (ADR-0069). No test upgrades a real install from one image to the next, with both databases, files and vectors.                                                  |
| Installing    | Administrators clone the repository and run `docker compose up -d --build`. A build downloads several GB of dependencies; there is no image to pull.                                                                                                  |

## Decisions

- **One story at a time,** each confirmed and merged on its own.
- **The CPU image is the one CI checks and publishes.** The GPU build stays a
  build option (US-90.8), and no GPU image is published.
- **Semantic versions, starting at 0.2.0** (decided 2026-11-19). The project has
  never released, and 0.x says the API and storage may still change between
  minor versions; ADR-0069 keeps stored data upgradable either way.
- **GitHub Container Registry,** as `ghcr.io/dbracewell/asterism` (decided
  2026-11-19), next to the repository and its Actions.
- **amd64 and arm64 images** (decided 2026-11-19): servers are mostly amd64, and
  arm64 covers Apple Silicon and ARM servers. Both are checked before publishing.

## User stories

Suggested order: US-91.1 → 91.2 → 91.3 → 91.4 → 91.5 → 91.6.

### US-91.1: One version for the app

As an administrator, Status, backups and the image all name the same version.

- [ ] Set the version to 0.2.0 in one source and make the
      root, frontend and backend packages agree with it; a check in
      `pnpm check:workspace-tasks` (or its own script) fails when they differ.
- [ ] Status and the backup manifest report that version, plus the git commit
      the image was built from (a build argument; "unknown" outside Docker).
- [ ] The image carries OCI labels for version, commit and source.
- [ ] Tests; update the deployment guide's upgrade steps ("Status shows the new
      version").

### US-91.2: CI builds and starts the real image

As a maintainer, a change that breaks the image fails CI, not an upgrade.

- [ ] A CI job builds the full CPU image with a layer cache.
- [ ] It starts the container with throwaway secrets, waits for healthy, and
      checks the `auth` migration ran, the sign-in page and `/api/py/health`
      answer, and the container runs as UID 10001.
- [ ] It runs `pnpm check:fetch-browser-container` and the theme storage check
      against that image.
- [ ] It fails when the image grows past a size budget (start at 5 GB), printing
      the largest parts, so growth is a decision.
- [ ] Document the job in `docs/development.md`; add it to the expected status
      checks in `AGENTS.md`.

### US-91.3: Release notes are part of the work

As an administrator, every change I need to act on is in the release notes.

- [ ] Add release notes to the Definition of Done in `AGENTS.md`: a story that
      changes configuration, stored data, the image or a documented behavior
      adds a line under "Unreleased".
- [ ] A check fails when a new Alembic revision or a change to the
      configuration contract (`scripts/config-contract.mjs`) lands without a
      change to `docs/release-notes.md`.
- [ ] Describe the sections (Configuration, Data, Image, Behavior) at the top of
      the file.

### US-91.4: Cut a release

As a maintainer, one command prepares a release the same way every time.

- [ ] `pnpm release <version>`: checks a clean, up-to-date `main` and passing
      checks; sets the version (US-91.1); turns "Unreleased" into the version
      and date and opens a new empty "Unreleased"; commits and tags `v<version>`.
- [ ] It refuses a version that isn't newer, or empty release notes.
- [ ] Document the steps, including pushing the tag, in `docs/development.md`.

### US-91.5: Publish the image

As an administrator, I install and upgrade by pulling an image instead of
building one.

- [ ] On a `v*` tag, CI builds the CPU image for amd64 and arm64, runs the
      US-91.2 checks, and pushes it to `ghcr.io/dbracewell/asterism` as the
      version and `latest`.
- [ ] `docker-compose.yml` can use the published image, with building from source
      still documented; the deployment guide's install and upgrade steps use it.
- [ ] The release notes link the image, and say the GPU build is built from
      source (`TORCH_VARIANT=gpu`).

### US-91.6: Test upgrading from the previous release

As an administrator, upgrading keeps my data, because CI has tried it.

- [ ] A CI job starts the previous release's image on a fresh volume, seeds data
      through the API (an account, a chat, a file with vectors, a theme), then
      starts the new image on the same volume.
- [ ] It checks the container becomes healthy, both databases migrated, and the
      seeded data is there; and that the previous image refuses the upgraded
      volume with its version message.
- [ ] Skip with a clear message until a previous release exists (after US-91.5).
