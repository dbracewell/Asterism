# Completed checklist: 2026-11-28

## Test tooling

EPIC-124 is complete: every story was confirmed and merged on 2026-11-28 through pull requests #200 (US-124.1) and #201 (US-124.2). Development, CI and the image run Node 22.23.5, and the frontend unit tests run on Vitest 5.1.1, jsdom 31.0.1 and jest-dom 8.0.0. Dependabot pull requests #41 and #190 were closed in favor of #201.

### [EPIC-124: Vitest 5 and its test libraries](../epics/EPIC-124-VITEST-5.md)

- [x] US-124.1: Node 22.23 for development and CI
  - [x] `.node-version` moves to the newest Node 22 release at least a week old, and the Dockerfile's Node 22 base image is refreshed to match.
  - [x] CI, the image check and the E2E suite pass on it.
  - [x] Release note (Image), and the development guide names the version.
- [x] US-124.2: Vitest 5, jsdom 31 and jest-dom 8
  - [x] Vitest 5, jsdom 31, jest-dom 8 and `@testing-library/dom` are updated together, following Vitest 5's migration guide for the config and setup file.
  - [x] Every unit test passes unchanged, or with a change the migration guide calls for.
  - [x] Dependabot pull requests #41 and #190 are closed in favor of this one.
