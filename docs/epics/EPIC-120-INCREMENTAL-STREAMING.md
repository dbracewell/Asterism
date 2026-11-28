# EPIC-120: Incremental streaming

Status: complete (2026-11-28). Source: repository review (2026-11-26), work
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

- [x] An ADR covers the format: appended text for `content` and `thinking`,
      numbered in order; a snapshot of the text so far when a tab connects
      mid-reply or misses a number; and the final message as the source of truth.
- [x] The ADR covers exercise runs, whose text is never streamed (ADR-0043).

### US-120.2: The server sends only new text

As a user, I want a long reply to cost no more to stream than its own length.

- [x] Stream events carry only the text added since the last event, with a
      sequence number.
- [x] A tab that connects mid-reply first gets the text so far.
- [x] Cancelling or failing a reply still saves the full text written so far.
- [x] Exercise runs keep hiding their text.
- [x] Tests (including bytes sent for a long reply) and release note.

### US-120.3: The browser builds the reply from new text

As a user, I want the reply on screen to match what was saved, even after a
dropped connection.

- [x] The chat page appends new text in order and asks for a snapshot when a
      number is missing.
- [x] Every open tab of the same chat shows the same text.
- [x] The finished message replaces the streamed text.
- [x] Unit and E2E tests, including reconnecting mid-reply, and release note.
