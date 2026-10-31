# EPIC-50: ChatGPT plan chat titles

Status: complete (2026-10-31); archived in docs/archive/todo-completed-2026-10-31.md. Source: user request (2026-10-31).

## Objective

Chat titles come from the admin-configured draft model. When no draft model is
usable (unset, or its model is inactive or removed), generate the title on the
chat owner's own ChatGPT plan instead of falling straight back to the first
words of the message.

## US-50.1: Plan fallback for chat titles

As a user with a connected ChatGPT plan, I want my chats titled by my plan
when the administrator has no draft model, so chat lists stay readable.

Estimate: 0.5 day. Dependencies: EPIC-49.

Acceptance: title generation uses the draft model whenever one is usable. Only
when none is, it uses the chat owner's own available plan model: the chat's
selected model if it is one, otherwise the owner's first available plan model.
It never uses another user's plan, and follows the same availability rules as
chats (admin policy, connection, usage pause). Plan errors during titling are
handled by the plan client (a usage limit pauses the plan). When no plan model
is available either, the existing text fallback is kept. A draft model that is
configured but fails at runtime does not switch to the plan.

- [x] Resolve the title model (draft first, then the owner's plan) in the chat domain.
- [x] Test draft precedence, plan fallback and selection, other-user isolation, unavailable plans and the text fallback.
- [x] Document the fallback in ADR-0025 and the provider docs.
