# ADR-0078 — Long-term memory

Status: accepted; implemented in US-93.1 to US-93.6
([EPIC-93](../epics/EPIC-93-LONG-TERM-MEMORY.md)). Amends the memory
boundary in [context isolation](../architecture/context-isolation.md) and
[ADR-0066](0066-about-you.md) ("no long-term memory engine exists").

## Context

About you (ADR-0066) is one text a person writes about themselves. People also
want Asterism to remember things that come up as they work: that they learn best
from worked examples, an accessibility need they mentioned, the conventions they
chose for a project. Until now the memory boundary was typed but stored nothing,
and it deliberately offered no user-only partition, so nothing could follow a
person from one project to another.

## Decision

### Two kinds of memory

- **User memory** is about the person and applies in every chat and project:
  how they like to learn, accessibility needs and disabilities they choose to
  share, their background. Its category is one of `learning`, `accessibility`,
  `background` or `other`.
- **User memory never holds project content**: no facts, files, tasks, answers or
  decisions from a project. That content belongs in that project's memory, so it
  can't reach another project through the person.
- **Project memory** goes deeper for one project: its goals, the person's
  decisions and conventions in it. It belongs to one project (`project_id`) and
  is used only in that project's chats. It has no category.
- General chats use user memory only. Project chats use user memory plus that
  project's memory.

### The revised boundary

`MemoryNamespace` gains a `user` kind, keyed by the user alone. It is used only
for user memory, under the content rule above. This replaces the "no user-only
partition" rule. The `project` kind keys project memory by user and project, as
before. The `chat` kind stays for derived caches (`DerivedContextKey`) and keys
no memory: General chats read user memory, not memory of their own.

Keys stay metadata, never capabilities. Every read and write is reauthorized
against the live owner, and project memory also against the live project. A
moved chat doesn't relabel memories: a project memory keeps its project.

### Storage

- **The `memories` table** holds one row per memory:
  - owner, `kind` and `project_id` (required for project memory, absent for user
    memory)
  - text, category and `sensitive`
  - the source chat, message and execution it came from
  - who saved it (`person` or `agent` when a confirmed proposal saved it); the
    proposal records the proposing agent configuration
  - revision and timestamps
- **Text** is 1 to 2,000 characters and at most 8,000 UTF-8 bytes. It follows
  About you's character rules: no NUL, and no control characters other than tab,
  newline and carriage return. Leading and trailing whitespace is trimmed. The API
  validates these, and check constraints enforce length, bytes, NUL and the kind
  rules in the database.
- **Caps:** at most 200 user memories per person, and 200 memories per person in
  each project. A create over the cap is refused with 409 and changes nothing.
- **Edits** need the expected revision (409 on a mismatch), like About you. Each
  edit adds one to the revision and rewrites the memory's vector.
- **Vectors** live in their own LanceDB table behind `VectorStore`
  (`memory_vectors`), one row per memory, keyed by owner and memory id, embedded
  with the bundled knowledge model. They are a cache of the text. A missing
  vector is rebuilt from the row, never the reverse.

### Private by default

Only the owner sees their memories, through owner-scoped queries: not educators,
not admins in the app, and not other members of a project. Admin tools and
exports for other people never include memory text.

### Sensitive memories

`sensitive` is set for every accessibility memory (a check constraint enforces
it), and the person may set it on any other. Sensitive text never appears in
logs, diagnostics, audit records or error messages, and Your Asterism shows the
label. Audit records hold ids, kinds and times for every memory, never text.

### Deletion

- **Account deletion** deletes every memory and vector of that person.
- **Project deletion** deletes that project's memories and their vectors. User
  memory is kept.
- **Chat deletion** keeps saved memories: the person chose to keep them. Their
  source chat, message and execution become empty, and the source reads "chat
  deleted".
- **Delete all** removes every memory of the chosen kind, or every memory.

### Pinning (US-93.5)

Each accepted turn pins the memories chosen for it (decided 2026-11-23):

- **Choosing:** the person's user memories, plus the chat's project memories in a
  project chat, never another project's. When there are at most 8, all of them;
  otherwise the ones nearest the prompt by embedding, then by recency for any
  without a vector. At most 8 memories and 1,000 tokens of their text.
- **Where the text lives:** execution history is immutable (database triggers on
  accepted inputs and recorded prompts), so the pinned text is not kept there.
  It lives in `message_memories` (owner, message, memory, revision, text,
  position), whose rows are deleted with the memory, the message or the account.
  A recorded run keeps only the memory ids and revisions
  (`MessageExecution.memories`), and its recorded prompt never holds a memory
  layer.
- **Running:** each run builds the memory layer from the pins it was prepared
  with, after rechecking `memory_available`. Resume therefore sends the accepted
  text even after an edit, and nothing for a memory deleted since: once someone
  deletes something, Asterism stops sending it, resumes included. Regeneration
  selects again and re-pins. Comparison columns share their turn's pins.
  Sub-agents inherit the run's layer.
- **The layer** comes after About you, framed as information about the person
  that they chose to keep, not instructions, and grants nothing. Only ordinary
  chats use memory; drafting chats don't.

### Policies (US-93.2)

Memory is used in a chat only when every switch allows it, each read live:

1. the admin `memory` policy: off by default, optionally limited to groups
   (`group_ids`, ADR-0058);
2. the person's "Use memory" setting (`memory_enabled`), on unless they turn it
   off;
3. for a course project, the class's `memory_enabled` (ADR-0068), which the
   effective mode policy reports with the class and educator as its source.

`memory_available` checks them in that order and names the first that is off.
Reading and proposing (US-93.4, US-93.5) call it on every send, resume and
regeneration. The switches never hide or delete saved memories: people can
always see and delete their own.

### Proposals (US-93.4)

The main agent can offer a memory with the internal `propose_memory` tool. It
is offered in the person's conversations (never drafting chats, never to
sub-agents) while `memory_available` allows it and the model supports tools,
and each call rechecks that live. The Memory policy gates it, not the Tools
allowlist. The tool's description and a runtime prompt section set the rules:
user memory is only about the person, never project content; accessibility and
health memories only from what the person said about themselves; never text
from a file, web page or tool result.

- **A proposal is a chat record** (`memory_proposals`): kind, text, category,
  `sensitive`, the run's request message, the run and the proposing agent. At
  most one per run, so one per turn. Deleted with its chat. Tool results carry
  the proposal id, never the text, so the card follows the reply's branch.
- **Nothing is saved until the person clicks.** The card shows the text and
  where it goes ("You, in every chat" or "This project") with Save, Edit and
  Dismiss. Saving rechecks ownership, the chat's live project and
  `memory_available`, then creates the memory with `saved_by = agent` and the
  run as its source.
- **A dismissed proposal isn't proposed again in that chat**: the tool refuses
  text matching a dismissed proposal there (ignoring case and spacing).
- **Audit:** `memory_proposal_events` records each proposal, save and dismissal
  with ids and times only, never text. It outlives the chat and is deleted with
  the account.

### Exports, backups and upgrades (US-93.6)

- **Download my data** ([ADR-0076](0076-download-my-data.md)) has
  `memories.json`: every memory of both kinds in the memory API's shape, so each
  carries `sensitive`. Proposals, their audit events and the per-turn pins are in
  `records/`.
- **Backups** ([ADR-0072](0072-backup-and-restore.md)) already copy every LanceDB
  table, `memory_vectors` included. Because vectors are copied after the database
  snapshot, a backup can hold a vector without its memory, or a memory without
  its vector.
- **Rebuild on start:** each start, in the background, embeds every memory whose
  vector is missing or from an older revision, and deletes vectors without a
  memory, owner by owner. If the embedding model isn't ready it stops after the
  first failure and the next start tries again; turns rank by recency meanwhile.
  This covers a restore and a memory saved while the model was down.
- **Upgrades:** the upgrade check seeds a user memory and a project memory and
  checks they come back unchanged. It skips this, saying so, while the previous
  release has no memory (0.3.1 and earlier).

### Memory grants nothing

Like About you, memory is information about the person, framed that way in the
prompt, never instructions. Its text can't grant tools, files, delegation or
other memory. Text from files, the web or tools reaches memory only through a
proposal the person confirms (US-93.4).

## Consequences

- A person's preferences and needs follow them across projects, which the old
  boundary prevented by design. The content rule and per-project memory are what
  keep a project's material from leaking into another.
- Memory is personal data: it is in Download my data, backups and the upgrade
  check (US-93.6), and is refused to everyone but its owner.
- The vector table is rebuildable, so it needs no migration of its own when the
  embedding model changes.
