# Terminology

One name for each thing, used the same way in the app, the
user guide (`docs/guide/`, written in
[EPIC-89](epics/EPIC-89-USER-GUIDE.md)), the [architecture guides](architecture/README.md)
and the code. When you write documentation, use the **Term** column. When you
read code, the **In code** column tells you what to search for.

The plain-language definitions match the in-app help registry
([`registry.ts`](../apps/frontend/src/features/help/registry.ts)). If a definition
here and the registry disagree, fix both in the same change.

## People and access

| Term                  | Plain definition                                                                                                                    | In code                     | Avoid                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| Administrator (admin) | Someone who runs the instance: providers, users, groups and policies.                                                               | `admin` token role          | "superuser", "owner"                                                              |
| User                  | Anyone with an account.                                                                                                             | `users`, `AuthedUser`       | "member" (unless of a class)                                                      |
| Group                 | Everyone is in exactly one group, which decides the models and tools they may use. Built-in groups are admin, educator and student. | `groups`, `group_id`        | "role" (roles are separate, see administrator)                                    |
| Educator              | Someone who may create and run classes.                                                                                             | educator group membership   | "teacher" in UI text; fine in examples                                            |
| Student               | A user in the student group, the default for new accounts.                                                                          | student group               | "learner" for the group (use "learner" only for the person using a learning mode) |
| Suspended account     | An account an admin has blocked. It can't sign in, and its open pages stop working.                                                 | Better Auth ban             | "disabled", "locked"                                                              |
| Deletion request      | A user's request that an admin delete their account. It changes nothing by itself.                                                  | `account_deletion_requests` | —                                                                                 |

## Chats and agents

| Term               | Plain definition                                                                                         | In code                                                           | Avoid                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Chat               | A conversation with the assistant, kept so you can come back to it.                                      | `chats`, `messages`                                               | "thread", "session"                                                      |
| General chat       | A chat that doesn't belong to a project.                                                                 | chat with `project_id = None`                                     | "global chat", "standalone chat"                                         |
| Project            | A workspace that groups related chats and shares its files with each of them.                            | `projects`                                                        | "workspace" as a name, "folder"                                          |
| Main agent         | The assistant that answers your chats. Each user has exactly one, with no model of its own.              | main-agent configuration, `agent_profiles` row with the main role | "agent profile", "persona", "default agent"                              |
| Sub-agent          | A helper with its own instructions and one fixed model, which the main agent can hand part of a task to. | sub-agent definition                                              | "child agent" (except when describing a running delegation), "assistant" |
| General chat set   | The sub-agents that General chats may delegate to, chosen on the main agent. Empty for a new user.       | `general-sub-agents`                                              | "default sub-agents"                                                     |
| Delegation         | The main agent handing a task to a sub-agent during a turn.                                              | `sub_agent` tool, `DelegationRecord`                              | "handoff"                                                                |
| Model              | The AI model that writes replies. Chosen per chat.                                                       | `models`, `ChatModelChoice`                                       | "engine", "LLM" in user-facing text                                      |
| Provider           | A service that hosts models, such as OpenAI or an OpenAI-compatible server.                              | `providers`, `ProviderType`                                       | "vendor", "backend"                                                      |
| About you          | Facts about the user that Asterism keeps in mind when answering. Information, not instructions.          | `users.about_md`, `accepted_about`                                | "profile", "memory", "persona"                                           |
| Turn               | One message from the user and everything Asterism does to answer it.                                     | user message plus its assistant steps                             | "exchange", "round"                                                      |
| Branch             | One path through a chat's edits and regenerations.                                                       | message tree, active child                                        | "version", "fork" (a fork is a specific action, see agent runtime)       |
| Compare models     | Sending the same message to two or three models and showing the answers side by side.                    | comparison, `comparison_id`                                       | "A/B test"                                                               |
| Canvas             | A panel beside the chat where the main agent puts long documents, code and web pages.                    | `canvas_*` tools                                                  | "editor", "artifact"                                                     |
| Tool approval      | A tool call that waits for you to approve or deny it before it runs.                                     | `tool_permission_request`                                         | "permission prompt"                                                      |
| Context compaction | Summarizing earlier turns when a chat nears the model's context limit. Messages are never deleted.       | `chat_compactions`                                                | "truncation", "memory"                                                   |

## Files and knowledge

| Term             | Plain definition                                                                                                               | In code                                     | Avoid                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------- |
| Files (library)  | Everything you've uploaded, in one place.                                                                                      | `user_files`                                | "documents", "uploads" as a name |
| Attachment       | A file added to one message.                                                                                                   | chat file reference                         | —                                |
| Project file     | A library file added to a project, so every chat in it can use it.                                                             | `project_files`                             | "copy" (no copy is made)         |
| Files in context | The files the assistant may use in this chat: the project's files plus this chat's attachments.                                | execution file scope                        | "knowledge base"                 |
| Sources          | The passages from your files that an answer relied on.                                                                         | citations, retrieval hits                   | "references"                     |
| Processing       | Turning an upload into searchable text or an image embedding. Shown as a status in Files.                                      | file knowledge artifact and its generations | "indexing" in user-facing text   |
| Team pack        | A file that shares a setup (sub-agents, skills, templates, rubrics, project settings) without files, keys or provider details. | `packs`                                     | "export", "bundle"               |

## Learning and study

| Term              | Plain definition                                                                                                              | In code                                                   | Avoid                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| Learning mode     | How the assistant helps: Standard, Tutor, Explain-back, Review my work, Spot the error, Draft feedback or Research assistant. | `learning_modes`, `mode` prompt layer                     | "persona", "style"                                       |
| Hint levels       | In Tutor mode, help that gets stronger one step at a time: Nudge, Hint, Worked example.                                       | `none`, `nudge`, `hint`, `worked_example`, `answer`       | —                                                        |
| Show answer       | Revealing the full answer, after confirming.                                                                                  | `confirm_reveal`                                          | —                                                        |
| Mode restrictions | Limits on modes and answer reveals, from your own lock, a course policy, or both.                                             | effective mode policy                                     | "mode lock" for the whole thing (the lock is one source) |
| Rubric            | The criteria work is assessed on and what each level looks like.                                                              | rubric documents in `prompt_templates`, `accepted_rubric` | "marking scheme"                                         |
| Prompt template   | A form that builds a clear prompt from fields.                                                                                | prompt template documents                                 | "snippet"                                                |
| Prompt coach      | A review of your draft message before you send it.                                                                            | prompt coach                                              | —                                                        |
| Skill             | Saved instructions you can switch on in a chat with `/`. Grants no tools or files.                                            | `skills`                                                  | "plugin", "command"                                      |
| Flashcard, deck   | A question and answer; a deck groups a project's cards.                                                                       | study decks and cards                                     | —                                                        |
| Quiz, attempt     | A saved set of questions; each time you take it is an attempt.                                                                | quizzes and attempts                                      | "test"                                                   |
| Study notes       | Saved summaries and study plans for a project.                                                                                | study notes                                               | —                                                        |
| Reflection        | A short end-of-session note on what you learned and what is unclear.                                                          | `reflections`                                             | "journal"                                                |
| AI-use log        | A record of how you used AI, to share with a teacher. Never contains answer text.                                             | `ai-use-log`                                              | "history export"                                         |
| Class             | A group of students run by an educator.                                                                                       | `classes`                                                 | "course" (a course is what a class publishes)            |
| Course            | A project an educator publishes to a class; each student gets their own copy.                                                 | `course_versions`, `course_copies`                        | "class project"                                          |
| Class insights    | Totals that show an educator which course files the class finds hard, from students who opted in.                             | class insights                                            | "analytics"                                              |

## Administration

| Term                | Plain definition                                                                | In code                            | Avoid          |
| ------------------- | ------------------------------------------------------------------------------- | ---------------------------------- | -------------- |
| Usage               | Tokens and estimated cost of every model call, per user.                        | `usage_records` (the usage ledger) | "billing"      |
| Budget, usage limit | A group's optional daily or monthly token allowance per user.                   | group token budgets                | "quota"        |
| Admin policy        | An instance-wide on/off or setting an admin controls, such as Skills or Canvas. | `settings/app/*`                   | "feature flag" |
| Status              | The admin view of readiness, load, queues and storage.                          | `status` domain                    | "health page"  |

## Terms for contributors only

These appear in architecture guides and code, not in the app or the user guide.

| Term                                | Meaning                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution                           | One run of the main agent or a sub-agent, with its own UUID and recorded inputs.                                                            |
| Execution file scope (file ceiling) | The files an execution may read, fixed when it starts. Resume can lose files from it but never gain them.                                   |
| Live check                          | Re-authorizing against current data at the moment of use, in addition to the recorded scope.                                                |
| Ordinary tool                       | A tool a user assigns to an agent, within admin policy and model support.                                                                   |
| Internal tool                       | A tool the server offers from context (`sub_agent`, `search_knowledge`, `load_skill`, `canvas_*`, `generate_image`). Users never assign it. |
| Prompt layer                        | One labeled part of the system prompt (`platform`, `agent`, `profile`, `mode`, `task`, `project`, `skills`, `skill_catalog`, `runtime`).    |
| Pinned                              | Copied onto an accepted turn so later edits don't change it (About you, skills, mode, rubric).                                              |
| Provenance                          | Content-free identities, revisions and digests recording what a run used.                                                                   |
| Artifact generation                 | One processing result for a file. A new generation replaces the old only after it succeeds.                                                 |
| Admission                           | The finite limits on chat work slots and connections.                                                                                       |
| Work slot                           | The one unit of running work a chat may hold: a reply, a title or a compaction.                                                             |
| Controller                          | The server side of one open chat WebSocket.                                                                                                 |
