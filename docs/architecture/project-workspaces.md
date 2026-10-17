# Project workspaces (US-27.1–27.3)

The sidebar exposes General and Projects. Workspace
selection follows the URL and the current chat's persisted project association;
there is no separate browser-wide selected-project state. Recent sidebar chats
are queried for that workspace, and pagination resets when its identity changes.
While resolving an existing chat's workspace, the sidebar does not display cached
General chats as though they belonged to that project.

## Routes and actions

| Route                            | Purpose                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `/projects`                      | Search project names/descriptions, page through results, and create projects            |
| `/projects/[projectId]`          | Project description, paginated chats, shared file explorer, new chat, and settings link |
| `/projects/[projectId]/settings` | Edit name, description, and task instructions; delete with confirmation                 |
| `/general`                       | Paginated General chats and new General chat                                            |
| `/?project_id=[projectId]`       | New chat composer with explicit project identity and model selection                    |
| `/c/[chatId]`                    | Existing chat with linked workspace identity and move dialog                            |

Project search results link to their overview. Project new-chat links pass the
project ID to the existing receipt-based create API. The composer verifies project
metadata before allowing a send; an unavailable project is never silently replaced
with General. General uses a null project ID. Existing chat model selection and
historical model provenance are unchanged.

## Forms, concurrency, and lifecycle

All core API operations use generated Hey API query/mutation options with TanStack
Query. Successful project edits, creation, deletion, and moves use the application's
global mutation-cache invalidation. Forms use existing shadcn Field, Input,
Textarea, Dialog, Select, and confirmation components. The layout follows the
existing app's semantic color tokens, font, spacing, and sidebar selection styles;
project names and task instructions carry the hierarchy without a new visual theme.

Settings retain the revision associated with the editing draft. Background reads
do not replace unsaved text or silently advance its revision. A rejected stale
save keeps the draft and reports the conflict. **Reload current settings** fetches
the latest version explicitly. Pending mutations disable their controls. Cached
read failures preserve visible results and show retry controls; initial loading,
initial failure, and empty results are distinct states.

Moving a chat requires choosing a different destination. The dialog explains that
history and local attachments transfer, prior project information may remain in
historical answers, and pending generations need regeneration. Moving is disabled
while the UI reports an active run; the backend independently rejects active or
unauthorized moves. Destinations support paginated project search and General.

Project deletion confirms that chats detach into General, history and local
attachments remain, library files remain, project memberships/instructions are
removed, and active runs are canceled. Deletion sends the current context revision.
The backend remains responsible for ownership and live authorization on all paths.

## Story boundary and verification

Chat model selection and project sub-agent selection are described below.
Standalone folder and knowledge-base domains, API paths, generated contracts, and
UI routes are removed. Fresh initialization creates only the supported schema;
the current database is retained during verification.

Component tests cover project creation/search/pagination, loading/error/empty and
cached refresh failures, scoped new-chat links, guarded settings edits/conflicts,
deletion confirmation/cancel, moves/rejections, and active-run disabling. Browser
coverage mounts the same production components on a test-only, unauthenticated
harness with mocked generated-client HTTP endpoints. It verifies navigation links,
request scopes/bodies/revisions, project settings, deletion, moves, retries, and
desktop/mobile layout. Existing backend project/chat tests cover real ownership,
revision, move, and deletion behavior. Harness tests do not exercise an authenticated
end-to-end project workflow or external model providers.

## Composable project files (US-27.2)

The project overview and library compose the same FileManager provider, ribbon,
list/grid, selection, search/sort/pagination, upload control, drop zone, processing
status, and file links. The provider accepts a discriminated `source` (library or
project ID) and explicit permitted `actions` (upload, physical delete, regenerate).
Only the selected source's generated query runs; project filtering and pagination
use the project file endpoint, rather than filtering a library page in the browser.
Providers are keyed by project identity, selection resets on query/sort/page
changes, and selected actions include only currently visible selectable files.
The explorer supports library and project sources.

Project scope permits upload/regeneration and offers separate membership controls;
physical file deletion is offered in the library. The library picker uses the shared
explorer in picker mode, excludes current project members using each file's project
summaries, and permits only membership addition. Existing library artifacts are
reused without invoking upload or regeneration. Project badges and file details
link to project overviews, and memberships remain visible when processing fails or
a processing record cannot be loaded.

Add/remove requests use immutable file IDs, the current project context revision,
and the atomic project membership API. Revision conflicts preserve the selection
and expose an explicit project refetch before retry. Success relies on the global
mutation-cache invalidation policy. Upload first creates library files and then
adds their returned IDs to the project. If membership fails, an explicit message
explains that the files remain in the library for a later add; the upload is not
repeated or rolled back by deleting the files.

Removal confirmation explains that the library source, processing artifacts, other
projects, and chat-local attachments remain. Future turns lose project membership
access while historical answers may retain information. Physical deletion confirms
removal of project/chat memberships and derived extractions, captions, and vectors.
The backend continues to enforce ownership, revision, and live scope boundaries.

Additional component tests cover shared memberships, project-local query parameters,
picker exclusions, missing/failed artifacts, permission-limited controls, removal
versus deletion, revision refresh, and upload membership recovery. Browser coverage
runs the production project overview/explorer in the existing test-only workspace
harness with mocked HTTP endpoints; it checks membership requests, upload, filtering,
selection, links, deletion separation, and desktop/mobile layout. It does not test
an authenticated project workflow against a real backend or external providers.

## Visible chat attachment scope (US-27.3)

The new-chat and saved-chat composers expose a collapsible **Files in context**
display. Project files and active-branch chat attachments are separate groups.
General has no project-file group contents. Saved scopes come from the generated
chat-scope query; each displayed file uses chat-scoped immutable-ID metadata.
Only five metadata rows per group are mounted at a time. Scope errors and refreshes
hide stale rows until authorization is verified. Branch/message, workspace, and model
identity changes remount the scope reader; generated mutation invalidation refreshes
membership changes. Reopened chats use the persisted active branch, never a library
scan to infer local membership.

A shared library picker reuses the explorer's selection/search/sort/pagination and
excludes current selections, known active-scope files, and the current project's
members. Choosing a library file stages its immutable ID in a lazy server draft;
uploads use the draft upload API before a chat ID exists or for the current chat.
Drafts grant no runtime access. Queued/uploading/ready-to-send/failed states are
separate from canonical processing/embedding/caption states. Users can upload or
retry without sending, remove a staged reference, or discard all draft attachments.
Sources and artifacts remain in the library. Navigation attempts draft cleanup;
server expiry bounds abandoned references when cleanup cannot reach the server.
Explicit discard clears local selections even when cleanup fails, with an explanatory
message. Expired/unavailable draft errors retain the prompt and permit explicit discard.

Before a new send, a generated draft read verifies that its exact IDs match visible
selections and none is unavailable. This prevents a lost upload/pick acknowledgement
from silently including an unseen staged file. Unchanged failed-send retries retain
the original request ID, file IDs, and draft ID without rereading a potentially
consumed draft, allowing durable receipt replay. Editing attachments resets the retry
identity. Successful acceptance consumes the draft; local upload bytes are not copied
into projects. New-chat workspace changes reset the composer/draft; model changes
preserve staged files and change the next-send request scope. Follow-up requests retain
an explicit parent and model revision. Saved context estimates use the current saved
conversation/model response; they are hidden during refresh and labeled **Saved
context**. Unsent draft attachments are explicitly excluded from that estimate.

Saved local attachments offer confirmed, source-preserving removal across the chat's
branches. Independent project membership remains visible. **Add to project** is an
explicit, revision-guarded mutation for a local file; staging, sending, retrieval, and
moving chats never automatically promote it. Active generation disables these controls;
the backend independently enforces lifecycle and live scope boundaries.

Retrieval source cards read validated `search_knowledge` tool-result metadata,
show project/chat provenance at retrieval plus artifact generation/match kind, and
recheck live chat authorization for source names and links. Other tool results or
malformed source records do not create citation links. Source lists initially mount
20 citations, with an explicit control to show more. Links use
`/c/[chatId]/files/[fileId]`; that route verifies the scoped metadata API and exposes
only a scoped image/download. Each byte request rechecks scope. Revoked/deleted or
inactive-branch sources show unavailable/retry states with no library fallback.
Historical answer text and original retrieval provenance remain historical information.

Component coverage includes scope grouping, General isolation, branch refresh failure,
explicit promotion/removal, library staging and draft forwarding, upload/send retries,
expired-draft cleanup, unknown staged IDs, and revoked citations/views. Browser coverage
uses production composer/context/citation/view components in the existing test-only
file harness with mocked generated-client HTTP endpoints, including two project chats
with different local files, reopen, model/branch changes, and desktop/mobile layouts.
The harness does not run an authenticated full ChatSession/provider workflow; backend
integration tests separately cover ownership, branches, durable receipts, and source
lifecycle. No backend API/schema change or working-database reset is required.

## Main configuration and sub-agent settings

The Agents settings pane queries the singleton main configuration and a paginated
owned sub-agent list through generated TanStack Query options. Main configuration
has one editor and no model binding, creation, deletion, or default-agent controls.
It edits instructions, the step limit, ordinary tools, and the six supported
generation defaults: temperature, top P, presence/frequency penalties, maximum
tokens, and seed. Blank values defer to the provider; defaults apply only when the
selected execution model supports them.

Sub-agent definitions have required explicit fixed-model bindings and separate
create/edit/delete controls. Cards show the fixed model/provider, or its immutable
ID when metadata is unavailable. Inactive/missing models retain their binding;
saving requires choosing an available model, with no automatic replacement.
Model and tool queries recheck on editor mount. Query failures expose retry;
failed saves retain edits. Unavailable ordinary tools can be removed explicitly,
while context-managed tools are excluded from manual controls and save payloads.
Admin tool configuration remains independent.

`GET /agents/sub-agents` returns `items`, `total`, `page`, and `page_size` (default
10, maximum 100). The agent service composes the owner-scoped select, filters to
sub-agents, and orders by name/ID before the shared database pagination helper.
Only records in the page receive model-availability enrichment. User-settings
snapshots remain separate from this browsing contract. Deletion confirms removal
from project selections and loss of active delegation access, with history and
files retained. Global mutation-cache invalidation refreshes settings queries.

Component tests cover singleton controls, generation persistence/validation,
fixed-model editing, failed saves/catalog queries, and hidden internal tools.
The test-only `/e2e/agent-settings` route composes the production pane with mocked
HTTP endpoints to exercise persistence, CRUD, pagination, unavailable bindings,
and query failure recovery. Backend API/service tests independently verify actual
owner isolation, singleton protection, fixed-model validation, and pagination.

## Chat model selection and project delegation

Draft/new chats start from the user's explicit default model without choosing an
automatic replacement when it is missing or unavailable. Both draft and saved
chat pickers use the generated live model catalog and display model/provider
identity, image support, tool support, and context window. Unknown capabilities
remain unknown. Cached catalog refresh failures are visible; failed verification
blocks sends and regeneration. Main-agent configuration stays independent of model
selection. Historical assistant turns show the immutable execution snapshot's
model/provider and configuration revision, including when viewing older response
versions after a model switch or catalog change.

Saved model changes use the observed model revision and disable send/regenerate
while the mutation is pending. Active generation and durable send acceptance also
block switching. A rejected model mutation retains the current identity and
requires an explicit generated chat refetch before another selection. Regeneration
uses the chat's current server selection; the UI marks it busy immediately and
never relabels earlier executions. General displays that it never delegates and
exposes no sub-agent membership controls.

Project settings compose an independent `ProjectSubAgents` section. Selected
workers and candidates have separate bounded pages, fixed-model/provider labels,
loading/failure/empty states, and explicit select/deselect actions. New projects
have no selected workers. Membership changes use the generated atomic batch
mutations with the revision observed by the corresponding list. Conflicts retain
visible state, disable further mutations, and require explicit list reload.
Global mutation-cache invalidation updates both lists and project metadata;
unsaved project instruction drafts keep their original revision so they cannot
overwrite intervening membership changes silently.

`GET /projects/{project_id}/sub-agent-candidates` returns the same paginated shape
as selected memberships: `agents`, `total`, `page`, `page_size`, and
`context_revision`. It checks project ownership, composes the agent domain's
owner-scoped select, filters to sub-agent definitions outside the project's
selected set, and orders by name/ID before database pagination. Selected and
candidate pages share a small project-specific response-enrichment function.
This keeps already-selected or foreign definitions from consuming candidate pages.
Unavailable models retain their explicit binding; new selection is disabled for
those definitions, while an existing selection can be removed. Deleted definitions
leave the project selections through the existing revocation boundary. Removing
selection revokes active delegated access while retaining historical answers/files.

Browser verification includes the production `AppPage` and `ChatSession` (with
mocked HTTP/WebSocket boundaries) for draft choice, reopening a persisted choice,
model switching, regeneration under the selected model, active-run disablement,
and restoring an older response's original provenance. Project scenarios use the
production settings page for two independent selections, conflict/reload,
unavailable fixed models, deselection, and deletion. These test routes are available
only under the test configuration profile. Backend integration tests independently
verify real ownership, runtime General non-delegation, capability revocation,
selection atomicity, execution snapshots, and candidate filtering before pagination.
The browser harness does not invoke real provider services or authenticated user
sessions against the real backend.
