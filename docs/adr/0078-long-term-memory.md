# ADR-0078 — Long-term memory

Status: accepted; the store and boundary are implemented in US-93.1
([EPIC-93](../epics/EPIC-93-LONG-TERM-MEMORY.md)). Policies, proposals, the
per-turn layer and exports follow in US-93.2 to US-93.6. Amends the memory
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
  - who saved it (`person` or `agent` when a confirmed proposal saved it); US-93.4
    adds the proposing agent when it adds proposals
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

Each accepted message keeps a private snapshot of the memories it was sent with:
each one's id, revision and text, as `accepted_about` keeps the About you text.
Resume uses the snapshot, so editing a memory afterwards doesn't change a
recorded turn. Regeneration picks up current memories. Deleting a memory removes
its text from every snapshot, so once someone deletes something Asterism stops
sending it, resumes included. Sub-agents inherit the recorded layer.

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

### Memory grants nothing

Like About you, memory is information about the person, framed that way in the
prompt, never instructions. Its text can't grant tools, files, delegation or
other memory. Text from files, the web or tools reaches memory only through a
proposal the person confirms (US-93.4).

## Consequences

- A person's preferences and needs follow them across projects, which the old
  boundary prevented by design. The content rule and per-project memory are what
  keep a project's material from leaking into another.
- Memory is personal data: it joins Download my data, backups and upgrades in
  US-93.6, and is refused to everyone but its owner.
- The vector table is rebuildable, so it needs no migration of its own when the
  embedding model changes.
