# ADR-0038 — Fork a run from a delegation step

Status: accepted for US-54.5 on 2026-11-02.

## Context

US-54.5 lets a user pick a delegation node in a finished run, change that
sub-agent's instructions for this run only, and re-run from there. The result
must be an ordinary chat branch with its own provenance. The original branch
must not change, and the sub-agent definition changes only if the user saves it.

How a run is recorded:

- A run is a user turn followed by a chain of assistant **steps**. Each step is
  one main-agent model call, stored as a message with its `tool_calls`,
  `tool_call_results` and the `DelegationRecord`s its calls ran.
- Each step points at the immutable `chat_executions` record of its run: the
  main configuration, model, prompt snapshot, persona, skills, mode and
  source ceilings.
- Sub-agent internals are not stored. A delegation record keeps the child's
  tool calls, results and final output, but not its prompts, forwarded
  context or intermediate text. A child's run can't be replayed partway.
- Delegation records did not record which parent tool call started them.

## Decision

**The fork point is a top-level delegation call.** A delegation the main agent
ran is re-executed from its own `sub_agent` call. A nested delegation (depth ≥ 1)
can't be resumed inside its parent child, because those internals aren't stored.
Forking it re-executes the depth-0 delegation that contains it, and the dialog
says so. Delegation records and envelopes now carry `tool_call_id`, the call that
started them, so the depth-0 ancestor's call can be found in its step.

**What is reused and what runs fresh.** Take a fork at call _T_ in step _k_:

| Part of the run                                 | On the fork branch                                             |
| ----------------------------------------------- | -------------------------------------------------------------- |
| User turn and steps 1…k−1                       | Shared, not copied. The fork branches after step k−1.          |
| Step k's model output (text and tool calls)     | Reused from the record; the main model is not called again.    |
| Step k's other tool calls and their delegations | Reused from the record: same results, records marked `reused`. |
| Call _T_ and every delegation beneath it        | Re-executed fresh with the changed instructions.               |
| Steps k+1 onward                                | Run fresh by the main agent, within its remaining step budget. |

Reusing the step's other results changes only one thing. Re-running them could
change the answer for reasons unrelated to the edit.

**The fork is a new sibling step.** Accepting a fork creates a pending
assistant step _k′_ under step k−1 (or under the user turn when k = 1). It holds
step k's text and tool calls. Its parent's `active_child_id` moves to _k′_, the
same pointer model regeneration and comparisons use. The original step k and
everything after it stay as an alternate branch the user can switch back to. No
earlier message is modified.

**A fork replays the recorded run, with one change.** Fork acceptance copies the
source step's execution into a new `chat_executions` record with a new id and
_k′_ as its request message. Configuration, model, prompt snapshot, persona,
skills, mode and recorded source ceilings are carried over unchanged. It adds
`fork` provenance: source step, source execution, forked delegation, sub-agent,
the step to resume at, and one override per changed sub-agent (sub-agent id, base
definition revision, instruction digest). Running the fork takes the existing
**resume** path: recorded inputs plus live rechecks of ownership, persona, skills,
model identity, capabilities and project. Anything revoked or changed fails with 409. Regeneration, by contrast, captures current settings. A fork does not, so
the only difference between the two branches is the edit.

**Scope is inherited, never widened.** The fork has the source run's recorded
file ceiling and selected sub-agents, intersected with live scope, as on resume.
The forked sub-agent must still be selected, owned and model-available. The
changed instructions replace only that definition's `agent` prompt layer. They
grant no tools, files, delegation or model access. The definition's live tools
and fixed model apply as they do in any delegation.

**The override covers the whole forked run.** Each time that sub-agent runs in
the fork (at call _T_, beneath it, or in a later step), it uses the changed
instructions. Each delegation also checks that the definition's revision still
matches the override's base revision. If the definition changed, the delegation
fails, so changed instructions are never applied to a different definition.
Forking a fork keeps the source's other overrides and replaces only the one for
the forked sub-agent.

**The instructions are private; the provenance is public.** The text is stored
only on the private execution record. `MessageExecution.fork` has digests only.
The fork dialog loads its starting text from an owner-only endpoint: the
override if the source run had one, otherwise the definition's current
instructions. Delegation records run with an override have
`instructions_overridden`, and their context manifest shows the overridden
`agent` layer digest.

**Saving is a separate, explicit action.** Forking never writes to the sub-agent
definition. The dialog's "Save to sub-agent" button calls
`PUT /agents/sub-agents/{agent_id}/instructions`, which replaces only the
instructions and refuses (409) if the definition's revision is no longer the one
the dialog read. Nothing is saved unless the user chooses it.

**Usage counts only the fork's own work.** Step _k′_ records zero main-model
tokens because the model was not called. Reused delegation records keep their
data for the graph and inspectors, but usage totals leave them out. Run diff
(US-54.6) compares them like any other record.

**Admission and lifecycle.** `POST /chat/{chat_id}/messages/{message_id}/fork`
accepts the source step, the delegation's execution id, the instructions and a
`request_id` (an idempotency receipt, as for comparisons). It runs under the
idle-change guard. The source step must be a completed step on the active branch
with no pending work. The client then sends `resume` on the socket and the job
runs in the chat's single work slot. Resume after a restart re-runs step _k′_
while it is pending. Cancelling during step _k′_ records the delegations that
finished on _k′_ and marks it cancelled.

## Consequences

- No new execution path: the fork reuses resume, the agent loop, delegation
  authorization and branch pointers. The agent loop gains one feature: it can
  start from a recorded step instead of calling the model.
- Forking a nested delegation re-runs its whole top-level delegation, so other
  work beneath that call may change too. The dialog makes this clear.
- A fork stops working if its recorded inputs are revoked. The user can still
  regenerate, which captures current settings.
- Each delegation's revision check means saving the definition while a fork is
  running fails that fork's later delegations of the same sub-agent.
