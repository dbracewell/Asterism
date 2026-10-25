# ADR-0023: Branch-local pinned skill execution

Status: Implemented in US-40.3; user-confirmed on 2026-10-25.

## Decision

Store ordered private skill snapshots with each accepted user turn. Derive the
active state from the selected branch's latest user turn, using a chat-local
counter to allocate revisions on explicit replacements. Keep skill documents and
eligibility in the skills domain, selection state in chat, and typed prompt inputs
in the agent domain. Acceptance and send acknowledgements commit together.

A replacement includes the expected accepted-state revision. Existing IDs retain
pinned source unless explicitly refreshed. Empty replacements remove all skills.
Branch switching restores recorded state and forks inherit source ancestry.
Retries acknowledge the original request; resume and regeneration preserve source
skill inputs. Neither document edits nor regeneration silently refresh skills.

The composition root injects one bounded ordered skills prompt layer after project
instructions. Immutable execution records retain exact prompts; public metadata
contains identity/revision/digests only. Live ownership, assignment and admin
policy remain mandatory at admission, execution, output and tool boundaries.
Unavailable skills block execution while chat history/removal metadata stay readable.
Delegated agents receive no automatic skill inheritance or new capabilities.

## Consequences

Historical prompts are reproducible after skill edits or deletion, without
cascading deletion of recorded source. Each active skill can add at most 65,536
UTF-8 bytes; the active set is capped at eight and 131,072 bytes total. Source
storage grows per accepted turn; retention remains tied to chat deletion.
Composer draft persistence/discovery and visible controls are delivered separately
in US-40.4. No migrations, compatibility paths, or working database resets apply.
