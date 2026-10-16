# EPIC-26 — Composable execution context

Status: In progress. US-26.1 and US-26.2 are confirmed complete; US-26.3 and US-26.4 remain pending.

Part of the [Projects and Chat Context Refactor](../plans/projects-and-chat-context-refactor.md). Product assumptions, module contracts, exclusions, and shared quality gates are defined there.

Estimated effort: **8–12 engineering person-days**, including story-level verification.

## User stories

### US-26.1 — Execution scope resolver

As a developer, I want one typed execution context used by every runtime consumer.

**Estimate:** 2–3 person-days. **Dependencies:** EPIC-25 and EPIC-29.

- [x] US-26.1-T1: Implement a server-derived context with user/profile/main-agent-or-sub-agent/chat/project IDs, selected and executed model identity, eligible project sub-agent IDs, effective internal tools, active branch, configuration/prompt revision, allowed file IDs, and file provenance.
- [x] US-26.1-T2: Inject small project and chat scope readers into the resolver rather than letting Agent query domain tables.
- [x] US-26.1-T3: Resolve scope at turn start and recheck authorization before each file/retrieval tool call; reject canceled or revoked execution contexts. Connect project deletion to cancellation of affected active runs before deleting project context, once runtime integration exists.
- [x] US-26.1-T4: Pass narrowed context to delegated agents and background/restarted jobs without granting new tools or wider files.
- [x] US-26.1-T5: Test empty scope, cross-user IDs, same-agent different-chat isolation, delegation, and revocation races.

**Acceptance:** An agent used in two chats receives two distinct scopes; delegated agents cannot widen file access; ownership alone is insufficient for a runtime file read.

### US-26.2 — Composable project prompts

As a user, I want project instructions consistently applied by my main agent and any eligible delegated sub-agents.

**Estimate:** 2–3 person-days. **Dependencies:** US-26.1.

- [x] US-26.2-T1: Extract a PromptComposer from Agent.\_build_system_prompt with typed layers and explicit conflict rules.
- [x] US-26.2-T2: Compose platform rules, agent role/capabilities, profile instructions where supported, project task instructions, and bounded runtime context.
- [x] US-26.2-T3: Use the same composed prompt for token estimates, main-agent calls, delegated calls, and turn replay; never treat file text as system instructions.
- [x] US-26.2-T4: Snapshot prompt revision per turn; apply edits to later turns and persist source/revision provenance rather than logging full private prompts.
- [x] US-26.2-T5: Test precedence, empty project prompt, edits, chat model switching, main-agent settings edits, delegation, and context-budget accounting.

**Acceptance:** Project instructions refine task behavior without expanding capabilities; General chats omit the project layer; token estimates match the actual prompt assembly.

**Implementation and verification (2026-10-16):** Typed prompt layers, explicit
conflict priority, private atomic turn snapshots, public revision/digest provenance,
and inherited project instructions for delegates are implemented. Pending estimates
and replay use the recorded prompt; later turns/regeneration use current edits.
Moving a chat rejects the former project's pending prompt until regeneration.
Forwarded history is user-message task data with a total token budget, and private
system messages are excluded from delegated trace history. Profile layers are
supported by the composer; runtime persona binding remains absent. See
[agent runtime](../architecture/agent-runtime.md#composable-prompts-us-262).

| Gate                           | Result                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Backend unit/integration suite | 409 passed, including 7 prompt composition cases                                                |
| Backend/frontend lint          | Passed                                                                                          |
| Backend/frontend typecheck     | Passed; backend compileall plus targeted basedpyright on all changed modules, 0 errors/warnings |
| Formatting                     | `pnpm format` and backend format checks passed                                                  |
| Frontend unit tests            | 101 passed                                                                                      |
| Frontend migration tests       | 6 passed                                                                                        |
| Root configuration tests       | 29 passed                                                                                       |
| Frontend production build      | Passed                                                                                          |
| OpenAPI/generated clients      | Regenerated from current schema; independent regeneration reproduced all client file hashes     |
| Import cycles                  | 211 modules / 962 imports; no cycles                                                            |
| Isolated Playwright            | 16 passed; runner exit 0. Managed backend reports 143 during intentional shutdown               |
| Diff integrity                 | `git diff --check` passed                                                                       |

Initial runs exposed and repaired test-double/session wiring, the old delegated
trace/system-role expectations, total-block context-budget expectations, and a
pnpm dependency-store mismatch. Dependency downloads needed a network-enabled
rerun; stale pnpm installation metadata was refreshed, then frontend/E2E gates
passed. An initial sandbox production build was canceled and the network-enabled
build passed. No current database reset, compatibility shim, or migration was
performed. User confirmed completion and authorized commit/merge on 2026-10-16;
the checklist is [archived](../archive/todo-completed-2026-10-16.md).

### US-26.3 — Shared retrieval and file-tool authorization

As a user, I want relevant project and chat files searched through the same reliable pipeline.

**Estimate:** 2–3 person-days. **Dependencies:** US-26.1.

- [ ] US-26.3-T1: Move search logic from the built-in tool into an injected RetrievalService using the resolved scope and existing extraction/vector interfaces.
- [ ] US-26.3-T2: Replace agent knowledge-base assignments with contextual access; derive contextual retrieval as an internal tool through US-29.4 policy, rather than a user-selectable agent toggle or assignment.
- [ ] US-26.3-T3: Apply owner and allowed-file filters before vector search and equivalent checks to every file reading/summarization/image path.
- [ ] US-26.3-T4: Preserve current-generation readiness, result limits, captions, image routing, citations, and scope provenance.
- [ ] US-26.3-T5: Test empty scope fails closed, foreign and unrelated files, unavailable embeddings, replacement generations, and stale authorization.

**Acceptance:** General chats can retrieve attached files; project chats can retrieve project and local files; direct file tools cannot bypass retrieval authorization.

### US-26.4 — Context provenance and memory isolation

As a user, I want project information to stay within its intended context.

**Estimate:** 2–3 person-days. **Dependencies:** US-26.2 and US-26.3.

- [ ] US-26.4-T1: Add project/chat/scope-revision, main/sub-agent configuration, selected target set, and actual model/provider provenance to execution and retrieval traces without logging file bodies or full prompts.
- [ ] US-26.4-T2: Audit any existing summary, cache, memory, and resume paths for cross-chat reuse; key derived context by its source scope.
- [ ] US-26.4-T3: For any active long-term memory path, scope project-derived writes/reads by project and General-chat-derived writes/reads by chat; do not add a new memory engine.
- [ ] US-26.4-T4: If no long-term memory integration exists, define the typed boundary and tests for future integration without building project-wide conversational memory.
- [ ] US-26.4-T5: Test reuse of one agent/profile across projects, moves, restart, and removal; document that existing historical messages cannot be unlearned.

**Acceptance:** Project/chat content is not automatically written into a shared profile namespace; traces identify which context was used; moving a chat is an explicit transfer of its history.

## Shared definition of done

Complete only one story at a time, on its own feature branch. Run relevant lint, type checks, unit/integration tests, generated-client checks, and E2E for changed workflows. Record unrun gates accurately. Update todo/documentation; obtain user completion confirmation before merge. This plan does not authorize resetting the current database during planning.
