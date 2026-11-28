# EPIC-122: Per-message search rows

Status: complete (2026-11-28). Source: repository review (2026-11-26), work
deferred from EPIC-117.

## Objective

Adding a message to a chat indexes that message only, not the whole chat.

The chat search index (`chat_search`, SQLite FTS5) has one row per chat that
holds its title and all its message text. Database triggers rebuild that row
whenever a message is added, edited or deleted. A chat holding a megabyte of
text rewrites that megabyte on every new message. This matters for chats with
several hundred messages, or ones with large pasted documents.

## Stories

### US-122.1: Index each message separately

As a user, I want long chats to stay quick to write to and still be found by
search.

- [x] An ADR records the change: one index row per message plus one per chat
      title, and how results are grouped into one hit per chat.
- [x] A versioned migration replaces the triggers and table, and rebuilds the
      index from existing chats and messages.
- [x] Adding, editing and deleting a message touch only that message's row;
      renaming a chat touches only its title row.
- [x] Search returns the same chats as before, one result per chat, still
      limited to the owner.
- [x] Tests: the upgrade from the previous revision, search results, and the
      work done per message write.
- [x] Release note (Data).
