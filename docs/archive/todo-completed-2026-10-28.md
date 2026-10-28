# Completed checklist — 2026-10-28

The user confirmed US-43.6 completion and authorized a local merge on
2026-10-28. EPIC-43 (US-43.1 through US-43.6) is complete; each story was
confirmed and merged with `--no-ff` before the next began.

## [EPIC-43: Conversation surface polish](../epics/EPIC-43-CONVERSATION-SURFACE-POLISH.md)

- [x] US-43.1: Message anatomy
  - [x] Extract `MessageItem` parts (marker, body, meta, actions) from `chat-session.tsx`.
  - [x] Add a relative-time formatter that respects the user's timezone setting; test it plus touch/keyboard reachability.

- [x] US-43.2: Reasoning and tool timeline
  - [x] Build the `AgentTimeline` component; replace the "Thinking" collapsible and the raw tool lines.
  - [x] Test long arguments, failures, the streaming state and `show_thinking` off.

- [x] US-43.3: Tool approval card
  - [x] Build the approval card; wire up the existing `tool_approval` message; test focus and repeated approvals.

- [x] US-43.4: Code blocks and prose
  - [x] Restyle the `prose` utilities and the `MarkdownViewer` code block; check them against all bundled themes in screenshots.

- [x] US-43.5: Citations as source chips
  - [x] Rebuild `RetrievalCitations`; test the previews, ownership-scoped links and long names.

- [x] US-43.6: Streaming affordances
  - [x] Replace `Loading`; add the scroll-anchor button; test reduced motion and scrolling behavior.
