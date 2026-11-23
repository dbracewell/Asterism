# ADR-0076 — Download my data

Status: accepted and implemented for US-86.8 on 2026-11-18
([EPIC-86](../epics/EPIC-86-MULTI-USER-DEPLOYMENT-READINESS.md)).

## Context

People in a multi-user deployment need to take their data with them, especially
before asking for their account to be deleted (ADR-0070). Their data is spread over
about twenty tables, the file store and canvas versions. An archive can be large,
because it includes every uploaded file. The app's existing downloads fetch a blob
with the bearer token and save it, which holds the whole file in browser memory.

## Decision

**One archive, built in the background.** Settings → General → Your data starts a
build (`POST /data-export`, 202). One job runs at a time for the whole instance
(`JobManager(max_concurrency=1)`), so a large library does not slow chats. Each
person has at most one archive: a new request replaces the last, and one that is
still being built refuses a second (409). The state is a `data_exports` row. The
page polls it while the build runs.

**What is in it.** A zip under one top folder:

- `README.md`; `account.json` (name, email, group, dates); `settings.json` (the
  settings aggregate the app reads, without the instance's model list);
  `about-you.md`; `memories.json`, every memory with `sensitive` marked
  ([ADR-0078](0078-long-term-memory.md), added in US-93.6).
- Per chat: `chat.md`, the active branch as a readable conversation, and
  `chat.json`, the chat row plus every message on every branch. Canvas items are
  in their natural file type at their current version, and every version is in the
  JSON.
- `skills/*.md`, and `files/` with the library files as stored.
- `records/*.json`: projects, study decks, cards, review logs, quizzes and
  attempts, notes, reflections, prompt templates, image requests, usage, class
  memberships, educator and deletion requests, memory proposals and their audit
  events, and the memories each turn used.

The record tables are an **allowlist** (`records.RECORD_TABLES`), read with the
owner filter on `user_id` and streamed into the zip a page at a time. A new table
is not exported until someone adds it. Left out on purpose:

- credentials: ChatGPT plan connections and authorizations, providers;
- bookkeeping: send receipts, composer drafts;
- derived data, rebuilt from the files: knowledge artifacts and vectors;
- agent traces.

File caches, thumbnails and storage keys are dropped from file rows.

**Where it lives.** `storage_root/exports/<sha256 of user id>/<id>.zip`. It is
written as `.partial`, set to mode 0600 and renamed when complete. `exports/` is
outside the backed-up trees: archives are copies, and they expire. A ready archive
is kept for 7 days. Expired rows and files are removed when read and at startup.
A restart marks interrupted builds failed. Deleting the account removes the folder,
and the rows go by cascade.

**Downloading.** `POST /data-export/link` returns
`/api/py/data-export/<id>/archive?ticket=<expiry>.<HMAC>`, valid for 5 minutes. The
ticket is an HMAC-SHA256 with `SYSTEM_KEY` over the export id, its owner and the
expiry. The browser navigates to the link, so the archive streams straight to disk
with `Content-Disposition: attachment` and `Cache-Control: no-store`. The archive
route takes no bearer token. It reads the owner from the export row, checks the
signature in constant time, refuses a suspended account (401), and serves only
that owner's current, ready archive. The link carries no user id or email, so
proxy logs don't record them. The route is left out of the OpenAPI schema.

**Help.** Glossary entries explain usage limits, suspended accounts, deletion
requests and Download my data, and the General and Your Asterism page guides link
to them.

## Consequences

- People can leave with their data in open formats (Markdown, JSON, original
  files) without an administrator's help.
- While a large archive builds, other people's builds wait their turn. The page
  says it can take a few minutes.
- Archives use disk for up to 7 days per person. The Status page's storage figure
  includes them.
- Anyone who obtains a link within its 5 minutes can download that archive, the
  same as any short-lived download URL. Links are created only on request, and the
  page uses each one at once.
- The archive has no import path back into Asterism. Moving between instances
  stays an administrator task (settings files, backups).
