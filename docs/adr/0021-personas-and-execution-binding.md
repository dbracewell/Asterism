# ADR-0021 — User personas, default selection and immutable execution inputs

Status: implemented and verified in US-35.2; completion confirmed on 2026-10-24.

## Ownership and storage

A persona is an owner-scoped user preference/instruction record, separate from
agent configurations, model selection and memory. Store its name and editable
USER.md Markdown text in the relational database. USER.md is a logical document,
not a user-supplied filesystem path. It guides response style/background; it grants
no capabilities, files, delegation, authentication role or memory access.

Each user has one non-null default-persona pointer. A deferred composite foreign
key requires the pointer to identify a persona owned by that same user. Persona
rows reference their owning user. A fresh-schema insert trigger creates the
initial Default persona as part of inserting a user, so direct SQL and application
provisioning both preserve at least one persona and exactly one default. The user,
persona and singleton main configuration commit atomically. No boolean default
flags or temporary zero-default states are exposed.

A user may own at most 20 personas. Names are trimmed, nonblank and at most 80
characters; USER.md is at most 16,000 characters / 64,000 UTF-8 bytes and contains
no NUL or non-text control characters. Revision fields are positive integers.
Database constraints supplement service validation. SQLite is the supported
adapter; no portability or migration claim is made.

## Editing, defaults and deletion

Persona edits require the expected persona revision and increment it atomically.
Default switches require the expected default-selection revision; they serialize
on the user row and may select only an owned persona. Conflicting edits/switches
return 409 without overwriting a newer revision. Reads and mutations return the
same 404 for foreign and missing IDs.

Deleting the default is rejected: choose another default first. Deleting a persona
explicitly selected by a chat is rejected: switch those chats first. Foreign keys
also enforce these rules for direct SQL and concurrent deletion/selection.
Deleting the user cascades all persona rows. Accepted historical execution traces
retain content-free identity/revision/name metadata and private prompt snapshots;
deletion does not rewrite history.

## Chat selection and acceptance

Chats have an optional explicit persona override and a separate selection revision.
No override means "Use my default": resolve the owner's current default for each
new accepted turn. An explicit override stays fixed when the user changes their
default. Draft/new-chat selection uses the same semantics. Selection changes
require the expected revision, owned resources and an idle runtime guard; they do
not rewrite previously accepted turns.

Message acceptance records the effective persona ID, name, revision and USER.md
input in a server-owned private snapshot in the same transaction as the message
and send receipt. Replaying the same receipt reuses that snapshot. A later persona
edit, default switch or chat selection change affects only newly accepted turns.

A first execution uses the accepted persona snapshot. Each execution stores its
private prompt and public metadata once in an immutable `chat_executions` record;
messages reference that owner/chat-consistent record. Database triggers reject
record updates and changes to a message's accepted persona. Regeneration creates
a new record and updates the request-execution reference. A separate producing-
execution reference on responses preserves their original history, including when
an assistant message itself starts regeneration. Earlier records and accepted
inputs remain unchanged. There are no parallel legacy JSON stores.
Resume reuses the recorded execution and prompt text; it does not read a new default or revised USER.md.
Explicit regeneration captures the current effective persona and instructions.
The profile layer follows platform/agent instructions and precedes project/runtime
layers. Public execution provenance exposes identity/revision/name and digests,
not USER.md content. Context provenance carries the selected profile identity/revision. Future
namespace keys partition by profile identity; derived-context keys include its
source revision. None of these keys authorize access.

## Live checks and delegation

Persona access is owner-scoped at acceptance, selection and execution. Before
provider work and while releasing output/tool/delegated results, recheck that
the recorded persona still exists for the same owner. Edits alone do not revoke
an accepted snapshot; deletion makes pending/running execution unavailable and
requires an explicit regeneration with an available selection. Historical
message viewing still uses chat ownership.

Children inherit the parent's recorded persona layer and identity/revision,
rather than consulting a new default or the current USER.md. Their fixed model,
agent configuration and live project/file/tool ceilings remain authoritative.
General chats never delegate. Persona text cannot enable an internal tool or
expand a child's scope.

## Scope

This implements persona CRUD/defaults, selection and prompt/provenance binding.
It activates no long-term memory store, profile memory engine, automatic memory
reads/writes or cross-chat summaries. Existing databases require the explicit
fresh development reset; verification uses disposable storage and does not reset
working databases. There are no migrations, compatibility aliases or legacy
fallbacks.
