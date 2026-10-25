# Private instruction skills — US-40.1 and US-40.2

Private document CRUD, main-agent assignments, admin activation policy,
eligible-skill discovery, and the Skills editor/settings UI are implemented.
Slash commands, branch-local active skills, and runtime prompt snapshots are
planned in [EPIC-40](../epics/EPIC-40-USER-SKILLS-AND-CHAT-SLASH-COMMANDS.md).
No runtime currently reads or executes these skill instructions.

## Document contract

The `skills` domain owns the `skills` table and derives indexed `name` and
`description` metadata from the canonical `content` source. Clients write only
that complete SKILL.md-style document, not its owner or metadata. Source text,
including CRLF and Markdown whitespace, round-trips unchanged.

A document starts with a line containing exactly `---`, followed by YAML `name`
and `description` fields, a closing `---` line, and nonempty Markdown instructions.
Only those two frontmatter fields are accepted. Name is 1–64 lowercase ASCII
letters/digits separated by single hyphens; description is nonblank and at most
1,024 characters. Documents are limited to 65,536 UTF-8 bytes, frontmatter to
8,192 UTF-8 bytes. Null characters and invalid UTF-8 are rejected.

The bounded parser reads scalar YAML nodes, without object construction. It
rejects tags, anchors, aliases, sequences, nested mappings, duplicate keys,
nonstring metadata, and unsupported declarations such as `allowed-tools` or
`scripts`. Markdown body text is stored as instructions; it cannot grant tools,
MCP, file access, delegation, or executable resources. The UI preview uses the shared Markdown trust policy: raw HTML is skipped,
unsafe URLs are removed, and remote images are omitted. Storing a document does
not render HTML or run code.

## APIs and ownership

All routes require authentication. Only the owner can read or mutate a skill;
admins have no cross-user skill-document exception. Foreign and missing IDs
return the same 404. Owning CRUD remains available when activation policy is off.

| Route                                     | Contract                                                      |
| ----------------------------------------- | ------------------------------------------------------------- |
| `GET /skills/`                            | Owner-scoped metadata, `query`, `page` and `page_size`        |
| `POST /skills/`                           | Create from `{content}`, return full skill with 201           |
| `GET /skills/{id}`                        | Read full canonical source and derived metadata               |
| `PUT /skills/{id}`                        | Replace `{content, expected_revision}`                        |
| `DELETE /skills/{id}?expected_revision=N` | Revision-checked deletion, 204                                |
| `GET /settings/user/main-agent/skills`    | Assigned skill IDs and main-agent configuration `revision`    |
| `PUT /settings/user/main-agent/skills`    | Replace `{skill_ids, expected_revision}`                      |
| `GET /skills/eligible`                    | Eligible metadata page, `policy_enabled` and `agent_revision` |
| `GET /settings/app/skills`                | Admin-only `{enabled}` activation policy                      |
| `PUT /settings/app/skills`                | Admin-only strict-boolean `{enabled}` replacement             |

Skill IDs are UUIDs. Search is bounded to 200 characters and treats SQL wildcard
characters literally. Page is at least 1; page size is 1–100. Owner filters,
search, assignment eligibility and deterministic updated-time/ID ordering are
applied in the database before pagination. Lists defer the document source column
and return metadata only.

Expected revision inputs are bounded to positive 32-bit integers to reject
oversized JSON values before storage binding. A skill starts at revision 1; each accepted replacement increments it, including
metadata/name changes. Updates and deletes use compare-and-set and reject stale
requests with 409. Per-owner name uniqueness is enforced in the database;
duplicate creates/renames return 409 without changing the existing document.
The owner ID comes from verified authentication. Mutation audit logs contain IDs
and owner information, not instruction content.

## Assignments and policy

`agent_skills` records explicit main-agent assignments, not chat activation or
ordering. Composite foreign keys enforce the same owner for agent and skill and
pin the agent role to main; a check constraint disallows sub-agent assignment in
this first version. At most 100 unique skills can be assigned per request.
Another user's skill ID cannot be assigned, even by an admin.

Assignment replacement uses the main agent's configuration revision as its
optimistic token and increments it atomically. Other main settings updates retain
assignments. Deleting a skill cascades its assignments and increments affected
main-agent revisions in the same transaction; a stale deletion rolls back both.
Deleting a user cascades their skills/assignments. No chat/execution snapshots
exist yet, and later snapshots must remain independent of this deletion cascade.

`skills_enabled` is a strict-boolean application setting with a default of false.
The typed policy endpoints are registered before generic settings routes. Generic
admin setting writes and bulk writes also validate this key strictly; deleting
the setting restores the disabled default. Discovery treats malformed direct
storage values as disabled. Users can read the effective policy status through
eligible discovery, but only admins can modify policy.

Eligible skills are the intersection of the caller's owned skills, explicit main
assignments, and live enabled admin policy. Availability requires no model binding
or tool support: these are instruction skills. Assignment/eligibility never adds
tool permissions. Revoking policy hides eligibility without deleting documents or
assignments. Agent runtime receives no new powers or skill prompt layer here.

## Module and storage boundaries

Document validation, owner-scoped base queries, lifecycle service, assignment
service, and policy access are separate modules. The runtime cannot import skill
storage/service/policy modules; the architecture guard enforces that boundary.
Future chat composition roots will resolve and inject authorized typed snapshots.
Settings storage continues through SQLAlchemy and the existing application-setting
service. Fresh initialization imports both new models through `db.model_registry`;
no data migrations, compatibility paths, or verification resets of working data
are introduced. Generated Hey API types, SDK, queries and Zod schemas include the
new routes and the application-policy field.

## Settings UI and draft lifecycle

`/settings?t=user&setting=skills` uses the existing settings navigation and URL
utility, retaining unrelated/repeated query parameters. The list is searchable
and paginated; create/detail dialogs edit canonical source and preview only the
Markdown body. Source validation remains authoritative on the server. The UI
also counts UTF-8 bytes and blocks oversized saves. Initial loading, initial
failure/retry, empty/matching-empty, and cached refresh failure are distinct.

Dirty source retains its original revision through query refreshes and mutation
failures. A newer server revision produces a reload notice; explicit reload
confirms discarding edits. A pristine editor can adopt newer query data, including
when reopening immediately after a successful save. Save/delete controls wait
for detail refresh to finish; deletion is confirmed and uses the loaded revision.
Closing a dirty editor asks before discarding source. Deletion restores focus to
New skill, and removing the last row of a later page returns to a valid page.

Agents settings exposes a separate main-agent skill dialog with a bottom-right
Save assignments action. Selection persists across result pages and search,
including IDs outside the visible page. It submits only skill IDs plus the
captured configuration revision; it never overwrites other main settings. Dirty
selections survive background reads/conflicts until the user explicitly reloads
or discards. Policy status is read through eligible discovery, so ordinary users
do not call admin policy mutation endpoints. No policy editing UI is added here.

All API state uses generated Hey API query/mutation options and TanStack Query.
Owner-specific query-key fields prevent cache reuse between signed-in users while
preserving generated prefixes for shared mutation-cache invalidation. The owner
comes from authenticated user context, not a potentially stale main-agent query.
An identity change closes and clears open drafts; it never carries private edits
into another owner's session. Mutation metadata uses the existing shared
invalidation handler without duplicate component-level invalidation calls.
