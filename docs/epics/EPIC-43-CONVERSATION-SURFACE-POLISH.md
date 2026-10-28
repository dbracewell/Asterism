# EPIC-43: Conversation surface polish

Status: in progress. Source: the approved visual design audit (2026-10-26).

## Objective

Make the chat transcript, where users spend most of their time, clear and
polished. Today assistant messages have no identity marker, every message shows a
full timestamp and tok/s, tool calls render as raw `• name {json}`, tool approval
is plain text next to a bare button, citations are underlined filenames, prose
tables use heavy primary-filled header rows, and streaming uses generic bouncing
dots.

## Ownership and delivery

Frontend presentation only. Message, tool-call, approval and citation data shapes
are unchanged. Untrusted content stays subject to the EPIC-31 Markdown
constraints: tool arguments and retrieved text render as text, never HTML.
Builds on the EPIC-41 tokens.

## US-43.1: Message anatomy

As a user, I want to tell who said what and see details only when I need them.

Estimate: 1 day. Dependencies: EPIC-41.

Acceptance: assistant messages carry a small constellation marker and user
bubbles use the refined surface style. Metadata (relative time, tok/s, stopped
state) appears on hover or focus, the full timestamp is in a tooltip, and
metadata is always reachable on touch devices and by keyboard.

- [x] Extract `MessageItem` parts (marker, body, meta, actions) from `chat-session.tsx`.
- [x] Add a relative-time formatter that respects the user's timezone setting; test it plus touch/keyboard reachability.

## US-43.2: Reasoning and tool timeline

As a user, I want to see what the agent did, step by step.

Estimate: 1.5 days. Dependencies: US-43.1.

Acceptance: thinking and tool calls render as a collapsible step list showing
each tool's name, a truncated summary of its arguments, its status and its
duration, with full arguments and results expandable. The component is reusable
by EPIC-44.

- [x] Build the `AgentTimeline` component; replace the "Thinking" collapsible and the raw tool lines.
- [x] Test long arguments, failures, the streaming state and `show_thinking` off.

## US-43.3: Tool approval card

As a user, I want to approve or deny tool use deliberately.

Estimate: 0.5 day. Dependencies: US-43.2.

Acceptance: a pending approval renders as a card with the tool, its arguments and
a risk hint, plus Approve and Deny actions, and it is focus-managed. The approval
protocol is unchanged, with Deny added only if the backend already supports it.

- [x] Build the approval card; wire up the existing `tool_approval` message; test focus and repeated approvals.

## US-43.4: Code blocks and prose

As a user, I want code and tables that are easy to read.

Estimate: 1 day. Dependencies: EPIC-41.

Acceptance: code blocks have a header with language, copy and wrap toggle. Tables
use neutral header rows and subtle zebra striping that works in every bundled
theme (including Flowers). Blockquotes and links follow the theme.

- [x] Restyle the `prose` utilities and the `MarkdownViewer` code block; check them against all bundled themes in screenshots.

## US-43.5: Citations as source chips

As a user, I want to see where an answer came from.

Estimate: 1 day. Dependencies: US-43.1.

Acceptance: retrieved sources render as numbered chips with hover or focus
previews of the snippet and file name, link to the scoped file view, and are
keyboard accessible.

- [x] Rebuild `RetrievalCitations`; test the previews, ownership-scoped links and long names.

## US-43.6: Streaming affordances

As a user, I want to know the agent is working and to keep up with long replies.

Estimate: 0.5 day. Dependencies: US-43.1.

Acceptance: a branded pending indicator (static under reduced motion) and a "jump
to latest" button that appears when the user scrolls up during streaming.

- [x] Replace `Loading`; add the scroll-anchor button; test reduced motion and scrolling behavior.
