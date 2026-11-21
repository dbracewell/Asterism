# Completed checklist: 2026-11-20

## Release readiness

[EPIC-91](../epics/EPIC-91-RELEASE-READINESS.md) is complete: US-91.1 to US-91.6 were each confirmed and merged through pull requests #11 to #18, review fixes included. Decided 2026-11-19: semantic versions from 0.2.0, images on GitHub Container Registry for amd64 and arm64, the GPU build from source only. 0.2.0 was released on 2026-11-20 and published, public, as `ghcr.io/dbracewell/asterism:0.2.0` and `latest`.

- [x] US-91.1: One version for the app
  - [x] Set the version to 0.2.0 in one source and make the root, frontend and backend packages agree with it; a check in `pnpm check:workspace-tasks` (or its own script) fails when they differ.
  - [x] Status and the backup manifest report that version, plus the git commit the image was built from (a build argument; "unknown" outside Docker).
  - [x] The image carries OCI labels for version, commit and source.
  - [x] Tests; update the deployment guide's upgrade steps ("Status shows the new version").
- [x] US-91.2: CI builds and starts the real image
  - [x] A CI job builds the full CPU image with a layer cache.
  - [x] It starts the container with throwaway secrets, waits for healthy, and checks the `auth` migration ran, the sign-in page and `/api/py/health` answer, and the container runs as UID 10001.
  - [x] It runs `pnpm check:fetch-browser-container` and the theme storage check against that image.
  - [x] It fails when the image grows past a size budget (start at 5 GB), printing the largest parts, so growth is a decision.
  - [x] Document the job in `docs/development.md`; add it to the expected status checks in `AGENTS.md`.
- [x] US-91.3: Release notes are part of the work
  - [x] Add release notes to the Definition of Done in `AGENTS.md`: a story that changes configuration, stored data, the image or a documented behavior adds a line under "Unreleased".
  - [x] A check fails when a new Alembic revision or a change to the configuration contract (`scripts/config-contract.mjs`) lands without a change to `docs/release-notes.md`.
  - [x] Describe the sections (Configuration, Data, Image, Behavior) at the top of the file.
- [x] US-91.4: Cut a release
  - [x] `pnpm release <version>`: checks a clean, up-to-date `main` and passing checks; sets the version (US-91.1); turns "Unreleased" into the version and date and opens a new empty "Unreleased"; commits and tags `v<version>`.
  - [x] It refuses a version that isn't newer, or empty release notes.
  - [x] Document the steps, including pushing the tag, in `docs/development.md`.
- [x] US-91.5: Publish the image
  - [x] On a `v*` tag, CI builds the CPU image for amd64 and arm64, runs the US-91.2 checks, and pushes it to `ghcr.io/dbracewell/asterism` as the version and `latest`.
  - [x] `docker-compose.yml` can use the published image, with building from source still documented; the deployment guide's install and upgrade steps use it.
  - [x] The release notes link the image, and say the GPU build is built from source (`TORCH_VARIANT=gpu`).
- [x] US-91.6: Test upgrading from the previous release
  - [x] A CI job starts the previous release's image on a fresh volume, seeds data through the API (an account, a chat, a file with vectors, a theme), then starts the new image on the same volume.
  - [x] It checks the container becomes healthy, both databases migrated, and the seeded data is there; and that the previous image refuses the upgraded volume with its version message.
  - [x] Skip with a clear message until a previous release exists (after US-91.5).

## Multi-user deployment readiness

[EPIC-86](../epics/EPIC-86-MULTI-USER-DEPLOYMENT-READINESS.md)'s checklist is in the [2026-11-18 checklist](todo-completed-2026-11-18.md). Its last note leaves `todo.md` here: the one-time reset of pre-baseline development databases (US-86.1) is the user's to run. Startup refuses such a database with a message naming `pnpm reset:db`, so it can't be missed.
