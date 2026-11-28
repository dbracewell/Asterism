# ADR-0085 — Per-message search rows

Status: accepted (2026-11-28). Implemented in US-122.1
([EPIC-122](../epics/EPIC-122-PER-MESSAGE-SEARCH-ROWS.md)).

## Context

Chat search uses a SQLite FTS5 table, `chat_search`. It held one row per chat
with the title and the text of every message joined together. Triggers on
`chats` and `messages` deleted that row and rebuilt it from all the chat's
messages whenever a message was added, edited or deleted. A chat with a
megabyte of text rewrote that megabyte, and re-tokenized it, on every new
message: slow for chats of several hundred messages or with large pasted
documents.

Two FTS5 details shape the fix:

- Columns marked `UNINDEXED` can't be looked up by index. Finding a row by
  `chat_id` or by a message id stored in such a column scans the whole table.
  Only the integer `rowid` is a fast lookup.
- Messages and chats have UUID primary keys. The implicit SQLite `rowid` of the
  `messages` table is not stable (`VACUUM` may renumber it), so it can't be
  reused as the index key.

## Decision

**One row per message and one per chat title.** `chat_search` becomes
`fts5(chat_id UNINDEXED, user_id UNINDEXED, content)`. A title row's content is
the chat's title; a message row's content is the message's text. `user_id` is
the chat's owner.

**A key table gives each row a stable rowid.** `chat_search_keys(id INTEGER
PRIMARY KEY, chat_id, message_id UNIQUE)` holds one key per row: `message_id`
is null for the title row (unique per chat through a partial index) and set for
a message row. A row's FTS5 `rowid` is its key's `id`. An index on
`(chat_id, message_id)` lets a chat delete find all its keys.

**Triggers touch only the row they name.**

| Write                               | Index work                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| Create a chat                       | Add its key and title row                                                                        |
| Rename a chat                       | Update its title row (nothing when the title is unchanged)                                      |
| Delete a chat                       | Delete all its rows and keys by `chat_id`; the cascaded message deletes then find nothing to do |
| Add a message                       | Add its key and row                                                                              |
| Edit a message's content or chat    | Update its row and key; other column writes (status, tokens) touch nothing                       |
| Delete a message                    | Delete its row and key                                                                           |

**Results are grouped into one hit per chat.** A chat matches when every search
term is in its title or in some message, as before: the terms of one search
can sit in different messages. `SqliteFtsSearchIndex.matching_chats` runs one
`MATCH` per term, each limited to the owner, and intersects the chat ids
(`INTERSECT`). The result is a set of chat ids, so a chat with many matching
messages is one result, and the owner-scoped selects and pagination in
`chat/search.py` are unchanged.

**The migration rebuilds the index.** Revision `5c38bc190c46` drops the old
triggers and table, creates the new ones, and fills them from every existing
chat and message. The upgrade test seeds chats and messages at the previous
revision and checks the rebuilt rows, the search and the new triggers.

## Consequences

- Adding a message writes one small index row, however long the chat is.
  Editing or deleting one rewrites only that message's row, found by key.
- The index holds one more row per message. The total text indexed is the
  same.
- A search of _n_ terms runs _n_ `MATCH` lookups and intersects them; searches
  take at most ten terms.
- One behavior narrows: before, the joined text let a term that FTS5 splits
  into several tokens (such as `snake_case`, read as the phrase `snake case`)
  match across the end of one message and the start of the next. Now each
  phrase must sit within one message or the title.
- `project_search` is unchanged: one row per project already.
