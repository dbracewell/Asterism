# ADR-0073 — Usage ledger and token budgets

Status: accepted and implemented for US-86.3 on 2026-11-18
([EPIC-86](../epics/EPIC-86-MULTI-USER-DEPLOYMENT-READINESS.md)). Builds on
per-run usage ([EPIC-54](../epics/EPIC-54-RUN-INSPECTION-REPLAY-AND-COMPARISON.md),
US-54.1) and groups ([ADR-0058](0058-user-groups.md)).

## Context

An admin running a class needs to see who used how much, and to cap it. Tokens
were recorded in several shapes: on assistant messages, inside delegation
records, in compaction rows, and inside verification and disagreement results.
Study generation, chat titles, reflection drafts, prompt-coach reviews and image
captions kept no usage at all. Summing those per user and per day would be slow
and incomplete. Every check would also miss any new call path someone adds later.

## Decision

**One append-only ledger, `usage_records`.** Each completed model call adds one
row: user, source, model id and name, chat, input and output tokens, images, the
model's prices at call time, and whether it ran on a ChatGPT plan. Image
generation adds a row with an image count and no tokens. Existing per-message
usage stays where it is for run inspection. The ledger only does the
accounting.

**Metered where clients are built.** `create_llm_client` takes a required
`usage` argument: a `UsageMeter` naming who pays and for what (`meter_for`
builds one from the model, with its price, or none on a plan). The returned
client records the provider-reported tokens on each terminal event. Every call
site has to decide, and the type checker lists any that don't. A test also
fails if a call builds a client without `usage=`. Only the shared, cached draft
client passes `None`; each use of it is charged through `DraftModel.charged_to`.
`resolve_usable_model` requires a `source`. A stream abandoned before its
terminal event (a cancelled run) reports no usage, so nothing is recorded.

Sources: `chat`, `delegation` (sub-agents), `verification`, `disagreement`,
`compaction`, `study`, `reflection`, `prompt_coach`, `title`, `caption`, `image`.

**Budgets are tokens per member, per day and per month, on the group.**
`groups.daily_token_budget` and `groups.monthly_token_budget` are nullable, and
`NULL` means no budget. Input and output tokens count equally. The admin group
can't have a budget, so admins are exempt. A user with no group row has no
budget.

**One instance timezone for windows (decided 2026-11-18).** Days start at local
midnight and months on the 1st, in the `usage_timezone` app setting (an IANA
name, UTC by default, set in Admin Settings → Usage). Everyone resets at the
same moment. Nobody can reset early by changing their own timezone. A class
gets the school's midnight rather than UTC's. Windows are computed with
`zoneinfo`, so a DST day is 23 or 25 hours long.

**Enforced when work is admitted; running work finishes.** One check,
`require_within_budget`, runs at every admission point:

- REST sends (`persist_user_send`, which covers new chats and comparisons) and forks.
- Regenerate on the chat WebSocket, before the job starts.
- `resolve_usable_model` for user-started sources: study generation,
  verification and disagreements.
- `resolve_title_model` for reflection drafts and the prompt coach.
- Image generation.

Runs inside an admitted turn are not checked again. This covers comparison
columns after the first, resumed runs and agent steps.

It refuses when used tokens in the window are at or above the budget. Over HTTP
the refusal is 409 with `reason: "usage_limit"` and `resets_at` (Unix seconds),
and a message naming the budget and the reset time. On the WebSocket it is an
`error` packet with `error_code: "usage_limit"` and the same fields. A turn
already running is never stopped, so a user can go over by the size of their
last turn.

**Background work is counted but never refused (decided 2026-11-18).** Chat
titles, image captions and compaction always run, so files keep being processed
and chats keep working.

**Quiz grading is admitted like other work (US-113.1, 2026-11-26).** Grading was
first counted with `admit=False`, as finishing a submitted attempt. But each
submission is new work the person starts and can repeat, so it is now checked
against the budget. Over budget the attempt is still saved: multiple-choice
answers are marked, and short answers are `ungraded` with the budget message as
their feedback.

**No backfill (decided 2026-11-18).** The ledger starts empty at the migration.
Usage before the upgrade stays visible per run but is not in the usage view or
the budgets.

**Reads.** `GET /usage/me` returns today's and this month's windows, with used,
budget, remaining and resets, plus this month by model. `GET /usage/report`
(admin) covers days in the instance timezone, default this month, at most 366
days: per user and model, per group, and totals. Cost counts only priced rows
and is `null` when nothing was priced, so unknown never reads as free. Plan
tokens count toward budgets but have no dollars. `PUT /groups/{id}/budget` and
`PUT /usage/settings` are admin-only.

## Consequences

- Budget checks are one indexed sum per window `(user_id, created_at)`. They add
  two small queries to each admitted send.
- A ledger write that fails is logged and does not fail the call. Usage could
  then undercount, but only when the database is already failing.
- Recording uses its own short transaction. A run that fails later keeps the
  tokens it spent.
- A new call path that builds a client must say who pays. Adding a source needs
  a migration, because the source list is a CHECK constraint.
- Budgets are in tokens, not dollars. Prices differ by model and may be unset,
  so a dollar budget would be unreliable.
