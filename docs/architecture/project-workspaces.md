# Project navigation and settings (US-27.1)

The sidebar exposes General and Projects instead of folder navigation. Workspace
selection follows the URL and the current chat's persisted project association;
there is no separate browser-wide selected-project state. Recent sidebar chats
are queried for that workspace, and pagination resets when its identity changes.
While resolving an existing chat's workspace, the sidebar does not display cached
General chats as though they belonged to that project.

## Routes and actions

| Route                            | Purpose                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `/projects`                      | Search project names/descriptions, page through results, and create projects |
| `/projects/[projectId]`          | Project description, paginated chats, new chat, and settings link            |
| `/projects/[projectId]/settings` | Edit name, description, and task instructions; delete with confirmation      |
| `/general`                       | Paginated General chats and new General chat                                 |
| `/?project_id=[projectId]`       | New chat composer with explicit project identity and model selection         |
| `/c/[chatId]`                    | Existing chat with linked workspace identity and move dialog                 |

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

Project file exploration and visible attachment scope belong to US-27.2/27.3;
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
