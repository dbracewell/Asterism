# EPIC-13 — Main Agents and Chat Agent Selection

## Status

**Awaiting user confirmation.** US-13.1 is implemented and verified on `feat/us-13.1-main-sub-agent-settings`.

## Goal

Make the distinction between a user's interactive **main agents** and delegated
**sub-agents** explicit. A user can choose exactly one main agent as their
global default, then choose which main agent starts each new chat. The selected
agent is stored on the chat and is used for its entire lifetime.

## Scope and decisions

- A **main agent** is an agent profile where `sub_agent` is `false`; a
  **sub-agent** has `sub_agent` set to `true`.
- Only a main agent may be the global default or be selected for a chat.
- Every main agent must retain the `sub_agent` delegation tool. The settings UI
  displays it checked and locked; the service enforces it for all API clients.
- A chat stores the chosen agent profile ID. Changing the global default affects
  only subsequently created chats, never an existing chat.
- Existing chats will receive a data-preserving migration: where a user's valid
  main default exists, it becomes that chat's agent; otherwise the chat remains
  unassigned and cannot run until the user selects a valid main agent.
- A main agent cannot be converted to a sub-agent while it is the global
  default or assigned to a chat. Deletion follows the same protection.
- The existing user default-agent setting is retained, but its validation and
  semantics are tightened to mean **default main agent**.

## User stories

### US-13.1 — Separate agent settings and protect the default main agent

**As a user**, I want my main agents and sub-agents visibly separated in Agent
Settings and to set only a main agent as my global default, so that I can
understand which agents are available for direct conversations.

**Dependencies:** None.

- [x] US-13.1-T1: Partition the Agent Settings UI into accessible Main agents
  and Sub-agents sections, including empty states and clear delegated-use copy.
- [x] US-13.1-T2: Restrict the default-agent control to main agents, label it
  as the global default for new chats, and require the `sub_agent` tool for
  every main agent.
- [x] US-13.1-T3: Enforce server-side default-setting validation: the ID must
  belong to the user and reference a main agent; reject sub-agents, missing IDs,
  and malformed values. Sanitize stale legacy defaults on reads.
- [x] US-13.1-T4: Prevent converting or deleting the default main agent when
  doing so would leave no valid global default; retain the at-least-one-main
  agent invariant.
- [x] US-13.1-T5: Add backend and frontend tests for classification, default
  selection, rejected sub-agent defaults, and protected default operations;
  regenerate the typed client if the API contract changes.

**Acceptance criteria**

- Main agents and sub-agents are unmistakably visually distinct in settings.
- The default control appears only for main agents and communicates its
  new-chat scope.
- A user cannot persist a sub-agent or another user's agent as their default.
- Each user retains at least one main agent and exactly one valid default main
  agent whenever they have a usable model configuration.

---

### US-13.2 — Bind a selected main agent to each chat session

**As a user**, I want a new chat to use my selected main agent and to keep that
agent for later messages, so that agent changes do not unexpectedly alter an
ongoing conversation.

**Dependencies:** US-13.1.

- [ ] US-13.2-T1: Add nullable `agent_id` ownership-safe chat storage, schemas,
  and a repeatable data-preserving SQLite migration/backfill.
- [ ] US-13.2-T2: Extend chat creation to accept an optional main-agent ID,
  resolve omitted values to the user's default main agent, and reject sub-agent,
  missing, or cross-user IDs.
- [ ] US-13.2-T3: Construct the websocket runtime agent from the chat's stored
  agent ID, not the current global default; return a user-safe error for legacy
  unassigned chats.
- [ ] US-13.2-T4: Prevent deletion/conversion of a main agent that is assigned
  to a chat (or define an explicit safe reassignment flow if required).
- [ ] US-13.2-T5: Add service/router/migration regression tests and regenerate
  the Hey API client.

**Acceptance criteria**

- Every newly created chat records an owned main agent.
- A chat continues using its recorded agent after the user changes their global
  default.
- API callers cannot create a chat with a sub-agent or another user's agent.

---

### US-13.3 — Let users select the main agent when starting a chat

**As a user**, I want to choose a main agent before sending the first message,
so that I can start a conversation with the right specialist without changing
my global default.

**Dependencies:** US-13.2.

- [ ] US-13.3-T1: Add an accessible main-agent selector to the new-chat
  composer; default it to the user's global default and exclude sub-agents.
- [ ] US-13.3-T2: Send the selected ID through the generated create-chat client
  and show the selected agent in the resulting chat view/history where useful.
- [ ] US-13.3-T3: Handle no-main-agent, stale selection, and request-failure
  states with actionable guidance and no silent fallback.
- [ ] US-13.3-T4: Add frontend unit/integration coverage and a Playwright flow
  proving default selection, an override, sub-agent exclusion, and persistence
  across a global-default change.
- [ ] US-13.3-T5: Run full quality gates and document the agent-selection and
  legacy-chat behavior.

**Acceptance criteria**

- Only main agents are offered for a new chat.
- The global default is preselected, but selecting another main agent affects
  only that new chat.
- The selected agent is visible and remains stable after navigation/reload.

## Execution and definition of done

Recommended order: **US-13.1 → US-13.2 → US-13.3**. Work on exactly one story
at a time, use a feature branch per story, and update `todo.md` as tasks move.
For each story, run relevant backend/frontend tests, lint, and type checks;
regenerate the Hey API client after OpenAPI changes. Request user confirmation
before merging each completed story. The epic completes only after all story
acceptance criteria are met and confirmed by the user.
