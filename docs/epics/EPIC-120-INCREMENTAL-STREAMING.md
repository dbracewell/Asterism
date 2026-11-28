# EPIC-120: Incremental streaming

Status: proposed (2026-11-27). Source: repository review (2026-11-26), work
deferred from EPIC-117.

## Objective

A reply streams only its new text, so the data sent grows with the length of
the reply, not with its square.

Today every streamed event carries the whole reply so far (`content` and
`thinking`), and every open tab receives it. A reply of a few thousand words
sends tens of megabytes to produce about 15 KB of text. This hurts on slow or
mobile connections, and on the server once about twenty long replies stream at
once.

## Stories

### US-120.1: Decide the streaming format

As a maintainer, I want the new chat stream format written down before it is
built.

- [ ] An ADR covers the format: appended text for `content` and `thinking`,
      numbered in order; a snapshot of the text so far when a tab connects
      mid-reply or misses a number; and the final message as the source of truth.
- [ ] The ADR covers exercise runs, whose text is never streamed (ADR-0043).

### US-120.2: The server sends only new text

As a user, I want a long reply to cost no more to stream than its own length.

- [ ] Stream events carry only the text added since the last event, with a
      sequence number.
- [ ] A tab that connects mid-reply first gets the text so far.
- [ ] Cancelling or failing a reply still saves the full text written so far.
- [ ] Exercise runs keep hiding their text.
- [ ] Tests (including bytes sent for a long reply) and release note.

### US-120.3: The browser builds the reply from new text

As a user, I want the reply on screen to match what was saved, even after a
dropped connection.

- [ ] The chat page appends new text in order and asks for a snapshot when a
      number is missing.
- [ ] Every open tab of the same chat shows the same text.
- [ ] The finished message replaces the streamed text.
- [ ] Unit and E2E tests, including reconnecting mid-reply, and release note.
