# Usage and budgets

This guide explains how Asterism counts every model call each user makes, how
admins cap usage per group, where a request over budget is refused, and which
work is never refused. Read it before adding anything that calls a model or
generates an image.

## Concepts

- **The usage ledger** (`usage_records`) is an append-only table with one row for
  each completed model call or image request. It is the single source for usage
  views and budgets.
- **A source** says what a call was for: `chat`, `delegation` (a sub-agent),
  `verification`, `disagreement`, `compaction`, `study`, `reflection`,
  `prompt_coach`, `title`, `caption` or `image`.
- **A budget** is an optional number of tokens per group member, per day and per
  month, set on the group. Input and output tokens count the same.
- **Admission** is the moment new work is accepted. Budgets are checked there, and
  only there.

## How it works

### Recording every call

Usage is recorded where model clients are built, so no call can be missed.
`create_llm_client` takes a required `usage` argument, a `UsageMeter` that says who
pays and for which source; `meter_for` builds one from a model, with its price. The
client it returns records the tokens the provider reports on each call's final
event. The type checker lists any call site that doesn't pass a meter, and a test
fails on one too.

Each row records the user, source, model ID and name, chat, input and output
tokens, image count, the model's prices at that moment, and whether it ran on the
user's ChatGPT plan. Image generation adds a row with an image count and no tokens.

A few details:

- The shared client for background work (the draft model that writes titles) is
  built without a meter, and each use of it is charged with `DraftModel.charged_to`.
- A stream abandoned before it finishes, such as a cancelled reply, reports no
  usage, so nothing is recorded for it.
- Each row is written in its own short transaction. A run that fails later keeps
  the tokens it spent, and a failed write is logged without failing the call.
- Rows have no foreign key to models or chats, so deleting either never changes past
  usage. Deleting the user deletes their rows.

Per-message token counts on chat messages are separate. They drive the run summary
in the chat footer ([agent runtime](agent-runtime.md#run-usage-and-cost)); the
ledger only does the accounting.

### Budgets and windows

Admin Settings → Groups sets `daily_token_budget` and `monthly_token_budget` on a
group (`PUT /groups/{id}/budget`). Empty means no limit. The admin group can't have
a budget, so admins are never limited.

Days start at local midnight and months on the 1st, in one instance-wide time zone:
the `usage_timezone` setting, set in Admin Settings → Usage and UTC by default.
Everyone resets at the same moment, nobody can reset early by changing their own
time zone, and a school gets its own midnight. A day that changes for daylight
saving is 23 or 25 hours long.

### Where requests are refused

One check, `require_within_budget`
([`usage/service.py`](../../apps/backend/asterism/domains/usage/service.py)), runs
wherever new work a user asked for is admitted:

| Where                                            | What it covers                              |
| ------------------------------------------------ | ------------------------------------------- |
| Sending a message                                | New chats, follow-ups and comparisons       |
| Forking from a step                              | A re-run from a delegation                  |
| Regenerating, on the chat socket                 | Before the job starts                       |
| Choosing a model for a user-started task         | Study tools, verification and disagreements |
| Choosing the draft model for a user-started task | Reflection drafts and the prompt coach      |
| Image generation                                 | Each request                                |

It refuses when the tokens already used in the day or month are at or above the
budget. Over HTTP the refusal is a 409 with `reason: "usage_limit"`, `resets_at`
(Unix seconds) and a message naming the budget and when it resets. On the chat
socket it is an `error` packet with `error_code: "usage_limit"` and the same fields.

**Running work is never stopped.** The check doesn't run again inside an admitted
turn: not for agent steps, sub-agents, later comparison columns or resumes. So a user
can go over their budget by the size of their last turn.

**Background work is counted but never refused.** Chat titles, image captions and
compaction always run, so files keep being processed and long chats keep working.
These are `BACKGROUND_SOURCES` in
[`usage/schemas.py`](../../apps/backend/asterism/domains/usage/schemas.py). Grading a
submitted quiz attempt is also counted without being refused, so the attempt is
never left half-graded.

### Reading usage

| Route                        | Who      | Returns                                                                                                                                                                                                                                                                  |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /usage/me`              | Any user | Today's and this month's usage, budget, what's left and when each resets, plus this month by model. Shown in Settings → Your Asterism.                                                                                                                                   |
| `GET /usage/report`          | Admins   | Tokens and estimated cost per group and in total over a range of days (this month by default, at most 366 days), and one page of users (at most 100, most tokens first) with their models, optionally one group's or matching a search. Shown in Admin Settings → Usage. |
| `GET`, `PUT /usage/settings` | Admins   | The usage time zone                                                                                                                                                                                                                                                      |

**Cost counts only priced calls.** A model with no price contributes tokens but no
dollars, and a total with nothing priced is `null`, so "unknown" never reads as
"free". Calls on a ChatGPT plan count toward budgets but have no dollar cost.

Each check reads the user's group budget and the usage time zone once, then runs
one indexed sum per window over `(user_id, created_at)`, so it adds a few small
queries to each admitted send.

**The report is aggregated and paged in the database.** Group and overall totals
are one grouped query; users are filtered, counted, ordered and paged in SQL, and
per-model rows load only for the page's users. A report takes four ledger queries
however many people used Asterism, and no query lists more than one page of ids.

## Rules

- Every model call and image request builds its client with a meter, naming who pays
  and for what.
- Budgets are checked when work is admitted, never in the middle of it.
- Background work is counted and never refused.
- Admins have no budget.
- Budgets are in tokens, not dollars, because prices differ by model and may be
  unset.
- Usage rows are never rewritten.

## Adding a model call

1. Build the client with `usage=meter_for(...)` and the right source.
2. If the user started the work, call `require_within_budget` before it starts, or
   resolve the model through `resolve_usable_model` with a source that isn't in the
   background set.
3. A new source needs a migration, because the source list is a `CHECK` constraint
   on the table.

## Where the code lives

1. [`usage/service.py`](../../apps/backend/asterism/domains/usage/service.py):
   recording, windows and `require_within_budget`.
2. [`usage/schemas.py`](../../apps/backend/asterism/domains/usage/schemas.py):
   sources, meters and the read models.
3. [`usage/models.py`](../../apps/backend/asterism/domains/usage/models.py): the
   ledger table.
4. [`llm/metering.py`](../../apps/backend/asterism/domains/llm/metering.py) and
   [`llm/factory.py`](../../apps/backend/asterism/domains/llm/factory.py): meters, and
   the client factory that requires one.
5. [`llm/selection.py`](../../apps/backend/asterism/domains/llm/selection.py): admitting
   a model for user-started work.

## Related

- [ADR-0073](../adr/0073-usage-ledger-and-budgets.md): the ledger and budgets
- [ADR-0058](../adr/0058-user-groups.md): groups
- [LLM providers](llm-providers.md#model-pricing): model prices
