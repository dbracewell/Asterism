# EPIC-118: Release pages

Status: complete (2026-11-27). Source: preparing the 0.6.0 release.

## Objective

Every published release has a GitHub Release page with its release notes, so
the Releases page and `SECURITY.md` name the same latest version.

The release workflow published, signed and verified the image for v0.2.2
through v0.5.0, but never created Release pages: the two that exist (0.2.0 and
0.2.1) were made by hand, so the Releases page still shows 0.2.1 as the latest.

## Stories

### US-118.1: The release workflow creates the Release page

As a maintainer, I want each tag's GitHub Release made for me.

- [x] After the image is published and verified, a job creates the tag's
      Release from its section of the release notes, marked latest only when
      it is the newest tag, and updates it on a re-run.
- [x] Only that job can write to the repository.
- [x] Pages for v0.2.2 through v0.5.0 are created from the release notes.
- [x] Tests, release guide and release note.
- [x] Links in the notes, relative to `docs/`, point at that version's files on
      GitHub.
