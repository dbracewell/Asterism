# EPIC-117: Correctness cleanup

Status: in progress (2026-11-27). Source: repository review (2026-11-26),
verified against the code at `40101ac7`.

## Objective

Fix the smaller bugs the review confirmed, in settings, chat and housekeeping.

Deferred to a later epic: incremental streaming, per-message search rows,
splitting the largest modules, moving blocking work off the event loop and
N+1 queries. None causes problems at today's scale.

## Stories

### US-117.1: Settings and admin consistency

- [x] A settings import that fails partway leaves nothing applied, and never
      gives the admin group a budget.
- [x] Model discovery keeps the draft model.
- [x] Pack review and course apply offer only tools the person's group allows.
- [x] Tool settings check component parameters; the generic setting route for
      study chat checks groups; nested secrets are redacted.
- [x] Tests and release note.

### US-117.2: Chat and frontend fixes

- [x] The chat connection's heartbeat timeout has a margin over the server's
      ping; stray `console.log` calls are removed.
- [x] Chat titles can be generated again later in a chat.
- [x] File names containing `%` open and show correctly.
- [x] Sending a message refreshes only the queries it changes.
- [x] Downloads share one helper; the shared event worker drops closed tabs and
      closes the stream on sign-out.
- [x] The query client is per request on the server; the canvas preview keeps
      listening until a valid message arrives.
- [x] Tests and release note.

### US-117.3: Housekeeping

- [ ] Word tables with many columns keep a positive picture width; ZIP names
      keep their folder when disambiguated.
- [ ] `SECURITY.md` names the supported version.
- [ ] The container health check doesn't follow redirects; `reset-databases`
      checks the database URL prefix; `.dockerignore` excludes docs, tests and
      local data.
- [ ] The unused proxy-list call in `setup.mjs` is removed.
