# EPIC-93: Long-term memory

Status: in progress (US-93.1 merged 2026-11-23, PR #73; proposed 2026-11-20). Source: user request (2026-11-20). Decided
2026-11-20: two kinds of memory (user and project), the agent proposes and the
person confirms, relevant memories are added each turn, memories are private,
and a course can turn memory off.

## Objective

Asterism remembers what helps it work with each person, such as how they learn
best and the accessibility needs they have told it about, across every chat and
project. Within a project, it also remembers what matters for that project.
Nothing is remembered without the person saying yes, they can see and change
everything kept about them, and nobody else can read it.

Out of scope:

- memory the agent writes on its own;
- memory shared between people (educators included);
- summaries of other chats;
- sub-agents proposing memories.

## Where things stand (verified 2026-11-20)

| Area                  | What happens today                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| About you             | One text per user (`users.about_md`, ADR-0066), written by the person in Your Asterism, framed as information about them, not instructions. Each accepted message pins it (`accepted_about`); regeneration uses the current text; children inherit the recorded layer. ADR-0066 says Your Asterism is where future memory settings will live.       |
| Memory boundary       | `MemoryNamespace` (`domains/agent/context_provenance.py`) keys future memory by user plus project, or by user plus chat in General. It deliberately offers **no user-only partition** ([context isolation](../architecture/context-isolation.md)). `DerivedContextKey` adds the source chat and scope revision for caches. Neither stores anything. |
| Storage and retrieval | Files are embedded with the bundled knowledge embedding model into LanceDB behind `VectorStore`, searched with an authorized filter before the vector query (`search_knowledge`).                                                                                                                                                                   |
| Policies              | Admin policies gate internal tools (canvas, image generation with a group allowlist, ADR-0058/0064). Course projects restrict chats through one effective `ModePolicy` (ADR-0068).                                                                                                                                                                  |
| Personal data         | Download my data (ADR-0076) exports a person's data, account deletion removes it (ADR-0070), and backups cover the databases, files and vectors (ADR-0072).                                                                                                                                                                                         |

## Decisions

- **One story at a time,** each confirmed and merged on its own.
- **Two kinds of memory** (decided 2026-11-20):
  - **User memory** is about the person, across every chat and project: how they
    like to learn, accessibility needs and disabilities they choose to share,
    their background. It extends Your Asterism. It never holds project content:
    no facts, files, tasks or answers from a project.
  - **Project memory** goes deeper for one project: its goals, the person's
    decisions and conventions in it. It's used only in that project's chats.
  - General chats use user memory only. Project chats use user memory plus that
    project's memory.

  This replaces the "no user-only partition" rule with a new ADR. The user
  namespace is allowed only for user memory, whose content rule is above.

- **The agent proposes, the person confirms** (decided 2026-11-20). The main
  agent suggests a memory with an internal tool, and the chat shows a card to
  save, edit or dismiss it. Nothing is saved without that click. People can also
  add, edit and delete memories themselves.
- **Disability and health information is only kept when the person shares it.**
  The agent may propose an accessibility memory only from something the person
  said about themselves in this chat, never from guessing. The card says plainly
  what will be remembered and where. Such memories are marked sensitive: never in
  logs or diagnostics, and shown with that label in Your Asterism.
- **Relevant memories are added each turn** (decided 2026-11-20). Before a turn,
  a bounded number of the most relevant memories (by embedding similarity with
  the prompt, within a token budget) are added as an information layer, framed
  like About you: information about the person, not instructions. This works with
  models that can't call tools; only proposing needs tool support.
- **Pinned like About you.** Each accepted message keeps a private snapshot of
  the memories it was sent with: each one's id, revision and text, as
  `accepted_about` keeps the About you text. Resume uses the snapshot, so editing
  a memory afterwards doesn't change a recorded turn. Regeneration picks up
  current memories.

  Deleting a memory removes its text from every snapshot too: once someone
  deletes something, Asterism stops sending it, resumes included. Sub-agents
  inherit the recorded layer, and they never
  propose memories.

- **Private, and a course can turn it off** (decided 2026-11-20). Only the owner
  ever sees their memories: not educators, and not admins in the app.
  - The admin `memory_enabled` policy, off by default, has a group allowlist like
    image generation.
  - Each person has a "Use memory" setting.
  - A course's policy can turn memory off for chats in that course. A memory
    turned off is neither read nor proposed there.
- **Memory grants nothing.** Like About you, memory text can't grant tools, files,
  delegation or other memory. Text from files, the web or tools can reach memory
  only through a proposal the person confirms.
- **Traceable.** Every memory records its owner, kind, project, the chat and
  message it came from, the agent that proposed it, and when it was saved or
  changed. Audit records hold ids and times, never the text.

## User stories

Suggested order: US-93.1 → 93.2 → 93.3 → 93.4 → 93.5 → 93.6.

### US-93.1: Memory store and boundary

As a person using Asterism, what Asterism remembers about me is stored safely and
belongs only to me.

- [x] ADR: the two kinds, the user-memory content rule, private by default,
      sensitive memories, pinning, and the revised boundary. Update
      [context isolation](../architecture/context-isolation.md) and
      `MemoryNamespace` (add the `user` kind, used only for user memory).
- [x] A `memories` table with a versioned migration and upgrade test (ADR-0069): - owner, kind (`user` / `project`) and `project_id` (required for project
      memory); - text (bounded, with the About you character rules) and a category (user
      memory: learning, accessibility, background, other); - `sensitive`; - source chat, message and execution; - revision and timestamps.

      A per-person cap applies for each kind.

- [x] Memory vectors in their own LanceDB table behind `VectorStore`, keyed by
      owner and memory id, rewritten on edit.
- [x] An owner-scoped service and API: list, create, edit (expected revision, 409
      on conflict), delete, delete all. Each lists in a deterministic order, filtered
      in the database before pagination.
- [x] Deleting the account deletes its memories and vectors. Deleting a project
      deletes its project memories. Deleting a chat keeps saved memories, whose
      source then reads "chat deleted".
- [x] Tests for ownership, caps, revisions and deletion. Release notes: Data.

### US-93.2: Policies

As an admin, I decide whether memory is available and to whom. As an educator, I
can keep it out of my course.

- [x] An admin `memory_enabled` policy (default off) with `group_ids`, in Admin
      Settings, checked live (ADR-0058). Stored as the `memory` app setting. Until memory is used, Admin Settings shows
      a Planned placeholder (no controls); the policy is set through the API, and
      the working pane is built and tested (decided 2026-11-23).
- [x] A per-person "Use memory" setting (default on when the policy allows).
      Backend only: its control in Your Asterism ships with US-93.5, so nothing
      describes memory before it works (ADR-0032, decided 2026-11-23).
- [x] A course setting that turns memory off for chats in the course, included
      in the effective policy (ADR-0068) with its source shown to the student.
      Backend and the student's notice; the educator's switch ships with US-93.5.
- [x] One `memory_available(user, chat)` check, used for reading and proposing on
      every send, resume and regeneration. Tests for each source. US-93.4 and
      US-93.5 call it there, as they add proposing and reading.

### US-93.3: Your memories in Your Asterism

As a person using Asterism, I can see, add, change and delete everything
Asterism remembers about me.

- [ ] User Settings → Your Asterism → Memory: user memories by category, with
      sensitive ones labelled; add, edit, delete, delete all (with confirmation).
      Built with shadcn/ui, TanStack Query and the generated client.
- [ ] Each project's settings: its project memories, with the same controls.
- [ ] The "Use memory" setting, with a plain explanation of what is remembered,
      who can see it (only you) and how it is used.
- [ ] When the policy or a course turns memory off, the page says so and why.
- [ ] Help text and a help topic; E2E and accessibility tests.

### US-93.4: The agent proposes, the person decides

As a person using Asterism, when I tell it something worth remembering, it offers
to remember it, and I decide.

- [ ] An internal `propose_memory` tool for the main agent in ordinary chats,
      offered when memory is available and the model supports tools: - it takes the kind, text, category and whether the memory is sensitive; - it is limited to one proposal per turn; - it is never offered to sub-agents or in drafting chats.
- [ ] Its description and the main prompt set the rules: - user memory is only about the person, never project content; - accessibility and health memories are only from what the person said
      about themselves.
- [ ] A proposal card in the chat shows the text and where it will be saved ("You,
      in every chat" or "This project"), with Save, Edit and Dismiss. Saving
      rechecks availability and ownership live.
- [ ] Proposals are branch-aware chat records, and a dismissed one isn't proposed
      again in that chat.
- [ ] An audit record (ids and times only) for every proposal and decision.
- [ ] Tests, including text injected from a file, which can only lead to a
      proposal that is never saved without the click.

### US-93.5: Relevant memories in every turn

As a person using Asterism, answers take what it knows about me into account,
without my repeating it.

- [ ] Before a turn, select memories: - user memories, plus the chat's project memories in project chats; - ranked by similarity with the prompt; - bounded by count and tokens; - all available ones when there are few.
- [ ] Add them as one information layer, framed as information about the person,
      not instructions, after About you.
- [ ] Snapshot the selected memories (id, revision and text) privately on the
      accepted message, like `accepted_about`. Resume uses the snapshot, with
      ownership checked; regeneration selects again; children inherit the layer.
      Deleting a memory, or deleting all, removes its text from every snapshot.
- [ ] Tests: - an edit between acceptance and resume, where resume sends the accepted
      text; - a deletion between them, where resume sends nothing for that memory.
- [ ] Show which memories a reply used, in the progress panel or message details,
      with a link to them in Your Asterism.
- [ ] Tests for selection, the budget, pinning, course and policy refusals, and
      that a General chat never receives project memory.
- [ ] Show the memory controls held back in US-93.2: "Use memory" in Your
      Asterism and the educator's course switch, with their help and guide text;
      replace the admin Memory placeholder with the working pane.

### US-93.6: Memory in exports, backups and upgrades

As a person using Asterism, my memories leave with my data and survive upgrades.

- [ ] Download my data (ADR-0076) includes `memories.json`, with sensitive
      memories marked.
- [ ] Backup and restore (ADR-0072) include the memory vectors. A restore
      re-embeds any memory without a vector.
- [ ] The upgrade check (US-91.6) seeds a user memory and a project memory and
      checks they survive.
- [ ] User guide: a "What Asterism remembers" page. Architecture: memory in the
      agent runtime and context-isolation guides. `AGENTS.md`: replace "no
      long-term memory engine exists" with the memory rules. Release notes:
      Behavior.

## Open questions

1. **Limits.** How many memories of each kind, and how long can one be? This
   epic starts at 200 user memories, 200 per project and 500 characters each.
2. **Categories.** Are learning, accessibility, background and other the right
   user-memory categories, or should the person name their own?
3. **About you.** Should About you stay a separate free text next to memories,
   or later become one "about me" memory? This epic keeps both.
