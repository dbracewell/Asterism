# EPIC-113: Agent and budget limits

Status: proposed (2026-11-26). Source: repository review (2026-11-26),
verified against the code at `40101ac7`.

## Objective

Token budgets cover all new work a person starts, the agent runs only tool
calls it was offered, and tool and stream errors end cleanly instead of being
retried or reported twice.

## Stories

### US-113.1: Quiz grading within the token budget

As an admin, I want quiz grading to count against a person's budget like
other work they start.

- [ ] Submitting an attempt checks the budget before grading short answers.
- [ ] Over budget, the attempt is still saved, with short answers marked
      ungraded and a message saying why.
- [ ] ADR-0073 note, tests and release note.

### US-113.2: Text tool calls only when tools were offered

As a person using a model without native tool calls, I want text tool calls
read only where they are meant to be.

- [ ] Tool calls written as text are read only when that request offered tools.
- [ ] Tool-call tags inside fenced or inline code are left as text.
- [ ] The final loop step, which offers no tools, never runs a tool call.
- [ ] Tests and release note.

### US-113.3: Tool and stream errors end cleanly

As a person chatting, I want a failed tool or answer to fail once, clearly.

- [ ] Tool errors that would repeat (bad input, coded errors) are not retried.
- [ ] A structured-output error ends the stream without a completion event.
- [ ] Duplicate tool call ids are made unique before approval.
- [ ] Regenerate is refused while a reply is running and reaches every open tab.
- [ ] Tool approvals accept only true or false; unexpected tool errors return a
      generic message.
- [ ] Tests and release note.
