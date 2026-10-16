# Project workspaces (US-27.1 and US-27.2)

The sidebar exposes General and Projects instead of folder navigation. Workspace
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

Visible chat attachment scope belongs to US-27.3;
sub-agent selection and settings belong to US-27.4/27.5. Folder and standalone
knowledge-base endpoints/routes remain for EPIC-28 cleanup, but folder navigation
is no longer mounted in the app sidebar. No API/schema compatibility path or data
reset is needed for this frontend story.

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
The standalone knowledge-base consumers remain until US-28.1 removes that domain.

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
