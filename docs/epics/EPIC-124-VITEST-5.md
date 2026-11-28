# EPIC-124: Vitest 5 and its test libraries

Status: proposed (2026-11-28). Source: Dependabot review (2026-11-28).

## Objective

The frontend unit tests run on Vitest 5 with jsdom 31 and jest-dom 8, and
Dependabot can open pull requests for npm again.

Two Dependabot pull requests are held because they need Vitest 5: jsdom 31
(#41), under which Vitest 4.1 can't start a test worker, and jest-dom 8 (#190),
which supports Vitest 5 and later only and needs `@testing-library/dom` as a peer.
Dependabot hasn't opened Vitest 5 itself: npm already has five open pull
requests, its default limit.

jsdom 31 also needs a newer Node 22 (`^22.22.2`), and CI runs Node 22.13.0 from
`.node-version`. Moving Node is a planned change made by hand
([development guide](../development.md#dependency-updates)), so it comes first.

## Stories

### US-124.1: Node 22.22 for development and CI

As a maintainer, I want CI and local development on a Node 22 release that
current test libraries support.

- [x] `.node-version` moves to the newest Node 22 release at least a week old,
      and the Dockerfile's Node 22 base image is refreshed to match.
- [ ] CI, the image check and the E2E suite pass on it.
- [x] Release note (Image), and the development guide names the version.

### US-124.2: Vitest 5, jsdom 31 and jest-dom 8

As a maintainer, I want the unit tests on supported versions of their tools.

- [ ] Vitest 5, jsdom 31, jest-dom 8 and `@testing-library/dom` are updated
      together, following Vitest 5's migration guide for the config and setup
      file.
- [ ] Every unit test passes unchanged, or with a change the migration guide
      calls for.
- [ ] Dependabot pull requests #41 and #190 are closed in favor of this one.
