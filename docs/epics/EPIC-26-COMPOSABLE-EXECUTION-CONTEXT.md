# EPIC-26 — Composable execution context

Status: Complete. All four user stories are confirmed complete; US-26.4 was confirmed on 2026-10-16.

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

- [x] US-26.3-T1: Move search logic from the built-in tool into an injected RetrievalService using the resolved scope and existing extraction/vector interfaces.
- [x] US-26.3-T2: Replace agent knowledge-base assignments with contextual access; derive contextual retrieval as an internal tool through US-29.4 policy, rather than a user-selectable agent toggle or assignment.
- [x] US-26.3-T3: Apply owner and allowed-file filters before vector search and equivalent checks to every file reading/summarization/image path.
- [x] US-26.3-T4: Preserve current-generation readiness, result limits, captions, image routing, citations, and scope provenance.
- [x] US-26.3-T5: Test empty scope fails closed, foreign and unrelated files, unavailable embeddings, replacement generations, and stale authorization.

**Acceptance:** General chats can retrieve attached files; project chats can retrieve project and local files; direct file tools cannot bypass retrieval authorization.

**Implementation and verification (2026-10-16):** Retrieval orchestration is now
an injected `RetrievalService` using typed execution scope and the existing
embedding/vector interfaces. The tool is a thin adapter; main/delegated tool
contexts receive that service and a `RuntimeFileReader`. Shared live readers
validate owner, caller/model, project, active branch, current memberships,
delegation, and canceled/replaced execution identity. Inline converted text and
image reads validate before/after reads and before provider calls. Vector queries
prefilter owner and ready allowed files; result release checks queried/current
generations, ownership, UTF-8 bytes, and count bounds. Captions and file/source/
message citations retain scope revision provenance.

Agent knowledge-base assignment storage, endpoints, response fields, service
enrichment, and editing controls are removed. Standalone knowledge-base management
remains scheduled for EPIC-28. See [retrieval architecture](../architecture/knowledge-retrieval.md)
and [agent runtime](../architecture/agent-runtime.md#shared-retrieval-and-file-reads-us-263).

| Gate                           | Result                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Backend unit/integration suite | 421 passed, including 13 new scoped retrieval/file cases                                                 |
| Frontend unit tests            | 102 passed                                                                                               |
| Frontend migration tests       | 6 passed                                                                                                 |
| Root configuration tests       | 29 passed                                                                                                |
| Backend/frontend lint          | Passed                                                                                                   |
| Backend/frontend typecheck     | Passed; backend compileall plus targeted basedpyright on changed modules, 0 errors/warnings              |
| Formatting                     | `pnpm format` and backend format check passed                                                            |
| Frontend production build      | Passed                                                                                                   |
| OpenAPI/generated clients      | Assignment contracts removed; independent regeneration reproduced all client file hashes                 |
| Import cycles                  | 168 modules / 654 imports; no cycles                                                                     |
| Isolated Playwright            | 16 passed without browser retries; runner exit 0, managed backend reports 143 during intentional cleanup |
| Diff integrity                 | `git diff --check` passed                                                                                |

Verification uses fresh databases, real file bytes, and a real LanceDB query with
injected query embeddings. External provider calls and live model provisioning
were not run. Initial runs repaired old assignment/schema expectations, realistic
runtime/session doubles, and a sub-agent test that incorrectly expected an edit
trigger when the dialog was already open. An initial import cycle was removed by
injecting file processing rather than importing it in the runtime reader. No
compatibility fallback, data migration, or current database reset was added.
User confirmed completion and authorized commit/merge on 2026-10-16;
the checklist is [archived](../archive/todo-completed-2026-10-16.md).

### US-26.4 — Context provenance and memory isolation

As a user, I want project information to stay within its intended context.

**Estimate:** 2–3 person-days. **Dependencies:** US-26.2 and US-26.3.

- [x] US-26.4-T1: Add project/chat/scope-revision, main/sub-agent configuration, selected target set, and actual model/provider provenance to execution and retrieval traces without logging file bodies or full prompts.
- [x] US-26.4-T2: Audit any existing summary, cache, memory, and resume paths for cross-chat reuse; key derived context by its source scope.
- [x] US-26.4-T3: For any active long-term memory path, scope project-derived writes/reads by project and General-chat-derived writes/reads by chat; do not add a new memory engine.
- [x] US-26.4-T4: If no long-term memory integration exists, define the typed boundary and tests for future integration without building project-wide conversational memory.
- [x] US-26.4-T5: Test reuse of one agent/profile across projects, moves, restart, and removal; document that existing historical messages cannot be unlearned.

**Acceptance:** Project/chat content is not automatically written into a shared profile namespace; traces identify which context was used; moving a chat is an explicit transfer of its history.

**Implementation and verification (2026-10-16):** Typed, content-free provenance
now records execution source identity, project/chat/profile, branch/file scope,
configuration chain, selected targets/model, and actual model/provider. Main turn
snapshots persist provenance atomically; reopened/resumed runs retain their
recorded file and target ceilings, while regeneration captures current scope.
Delegated audit storage now holds digests, roles, metrics, and provenance instead
of task/message/tool/result bodies. Runtime content/argument debug output is
removed. Generated clients reflect the changed trace and execution contracts.

No active long-term memory integration exists. `MemoryNamespace` and
`DerivedContextKey` define future project/General-chat partitions and exact source
identity without adding storage or automatic cross-chat memory. The audited reuse
paths, future authorization requirements, and explicit history-transfer behavior
are documented in [context isolation](../architecture/context-isolation.md).
Tests cover shared agent/profile identities across scopes, delegation provenance,
source changes, persisted resume ceilings, regeneration, moves, project removal,
and historical-message retention. Existing scoped retrieval tests continue to
cover in-flight removal, generations, and owner checks.

| Gate                           | Result                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Backend unit/integration suite | 430 passed, including 9 new provenance/isolation cases                                           |
| Frontend unit tests            | 102 passed                                                                                       |
| Frontend migration tests       | 6 passed                                                                                         |
| Root configuration tests       | 29 passed                                                                                        |
| Backend/frontend lint          | Passed                                                                                           |
| Backend/frontend typecheck     | Passed; compileall plus targeted basedpyright on changed modules, 0 errors/warnings              |
| Formatting                     | `pnpm format` passed                                                                             |
| Frontend production build      | Passed                                                                                           |
| OpenAPI/generated clients      | Independent regeneration from current served schema matched all 18 client file hashes            |
| Import cycles                  | 170 modules / 668 imports; no cycles                                                             |
| Isolated Playwright            | 16 passed without retries; runner exit 0; managed backend reports 143 during intentional cleanup |
| Diff integrity                 | `git diff --check` passed                                                                        |

Initial verification repaired new lifecycle-test HTTP/revision/status assumptions
and a type-only import cycle. Restricted-network dependency setup was canceled;
stale pnpm installation metadata was refreshed and dependencies relinked with
network-enabled execution. A build overlapping E2E cleanup lost a generated type
file; a sequential production build passed. Lint's initial uv-cache restriction
was resolved with the documented temporary cache. No live provider request or
current database reset was performed; tests use fresh databases. The unrelated
`core/config.py` edit is preserved outside this story. No migration or compatibility
fallback was added. User confirmed completion and authorized commit/merge on
2026-10-16; the checklist is [archived](../archive/todo-completed-2026-10-16.md).
EPIC-26 is complete. Next recommended story: US-27.1 — Project navigation and settings.

## Shared definition of done

Complete only one story at a time, on its own feature branch. Run relevant lint, type checks, unit/integration tests, generated-client checks, and E2E for changed workflows. Record unrun gates accurately. Update todo/documentation; obtain user completion confirmation before merge. This plan does not authorize resetting the current database during planning.
