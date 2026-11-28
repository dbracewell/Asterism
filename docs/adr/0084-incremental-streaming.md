# ADR-0084 — Incremental streaming

Status: accepted (2026-11-28). The server side is US-120.2 and the browser side
US-120.3 ([EPIC-120](../epics/EPIC-120-INCREMENTAL-STREAMING.md)).

## Context

A reply streams to the browser as `delta` packets on the chat's socket
([chat and WebSocket](../architecture/chat-and-websocket.md)). Each packet
carries the whole reply so far, `content` and `thinking`. The LLM client
accumulates the text, the agent forwards it as `DELTA` events, and the
orchestrator queues one packet per event for every open tab. Sub-agent deltas,
wrapped in `sub_agent` packets, carry their child's whole text the same way.

So the bytes sent grow with the square of the reply's length. A reply of a few
thousand words sends tens of megabytes to produce about 15 KB of text: slow on
mobile connections, and expensive for the server once tens of long replies
stream at once.

Whole-text packets have one useful property: any packet repairs everything
before it. Three things rely on that today:

- **Dropped packets.** Each tab's queue holds 256 packets and drops the oldest
  when the tab falls behind. A dropped delta is harmless, because the next one
  has the whole text.
- **A tab that joins mid-reply.** Only the first controller to attach gets the
  buffered packets; a second tab gets nothing replayed and catches up on the
  next delta.
- **Text that shrinks.** For an exercise run (ADR-0043), `streamed_text` hides
  everything from the record marker on and holds back a trailing partial
  marker. When the marker completes, the shown text is cut back to before it
  and trailing space is trimmed, so it can be shorter than what was shown
  before.

Sending only new text loses that property, so the new format has to replace it.

## Decision

### Packets

A `delta` packet carries:

| Field      | Meaning                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| `stream`   | Which text this is: a new ID for each step of a run that streams text            |
| `seq`      | The packet's number within the stream, from 1, with no gaps                      |
| `mode`     | `append`: the text added since the last packet; `replace`: the whole text so far |
| `content`  | Answer text, as `mode` says                                                      |
| `thinking` | Reasoning text, as `mode` says                                                   |

A sub-agent's `delta` inside a `sub_agent` packet has the same fields, and its
streams are separate from the parent's.

### The server

- The LLM client and the agent stay as they are: they accumulate the text and
  emit the whole text in each `DELTA` event. The orchestrator, where agent
  events become packets, turns them into increments. The server-side text that
  is saved when a run is cancelled or fails (`_streaming_content`) is still the
  whole text.
- For each stream, the orchestrator keeps the text it last sent and the last
  number. For each `DELTA`, it works out the text to show (for exercise runs,
  after `streamed_text`). If that text starts with the text last sent, the
  packet is `append` with only the rest. Otherwise it is `replace` with the
  whole text. That covers a shrinking exercise text and any future change that
  isn't a pure extension. An event that adds nothing sends no packet.
- A step that ends (the step's `complete` packet, carrying the saved messages)
  closes its stream. The next step that streams text starts a new stream ID. So do
  each comparison column and a regeneration.
- Each sub-agent stream is keyed by its delegation's `execution_id`, with its
  own numbers, and closes with that child's `complete` or `error` event.
- **Joining.** When a controller subscribes while a stream is open, the first
  packets in its queue are a `replace` packet for each open stream that has
  sent text (the main reply and any running sub-agents), numbered with that
  stream's current number. They are queued right after subscribing, with
  nothing awaited in between, so no packet can come before them.
- **Catching up.** A new browser command, `resync`, asks for the same `replace`
  packets, sent to that tab only. It is answered only while a stream is open.

### The browser

- For each stream, the browser keeps the stream ID, the last number, and the
  text.
- A packet for a stream it doesn't have starts it: `replace` applies, and so
  does `append` with `seq` 1. Any other packet means the start was missed.
- `replace` applies when its number is at least the last one. `append` applies
  when its number is exactly one more than the last. A number at or below the
  last is a duplicate and is ignored.
- A gap (a number more than one ahead, or a missed start) means packets were
  dropped. The browser stops applying that stream's appends and sends one
  `resync`. The next `replace` repairs the stream; until it arrives, the text on
  screen stays as it was. If no `replace` comes (the stream closed meanwhile),
  the step's `complete` packet brings the saved text.
- As today, the saved messages in each step's `complete` packet replace the
  streamed text, so the saved reply is always what remains on screen.

### What stays the same

- Exercise runs never send the record (ADR-0043): appends and replacements are
  both made from `streamed_text`.
- The 256-packet queues and their drop-oldest rule stay. Increments make drops
  rarer, since each packet is small, and a drop now costs one `resync`.
- The frontend and backend ship together, so there is no compatibility mode for
  whole-text packets.

## Consequences

- Bytes sent for a reply grow with its length, plus one whole-text packet per
  tab that joins or falls behind.
- A tab that joins mid-reply shows the text so far at once, instead of waiting
  for the next delta.
- Rendering in the browser still re-parses the reply's Markdown on each flush;
  that cost is separate, and the existing flush timer bounds it.
- Tests for US-120.2 measure the bytes sent for a long reply, check that the
  appends rebuild the whole text, and cover joining, `resync`, exercise
  hold-back and sub-agent streams. US-120.3 covers dropped packets and
  reconnecting mid-reply in the browser.

## Alternatives considered

- **Keep whole-text packets and send fewer of them.** Sending at most a few a
  second cuts the bytes by a constant factor, but the total is still quadratic
  in the reply's length.
- **Character offsets instead of numbers.** An `append` would say where its text
  starts. That needs one offset each for `content` and `thinking`, and still
  needs `replace` for shrinking text. One number per stream is simpler.
- **Detecting drops on the server.** The queue knows when it drops a packet and
  could send a `replace` instead. But only the browser knows what it has
  applied, and it needs the gap check for reconnects anyway, so one mechanism in
  the browser covers both.
- **Changing the LLM client to emit increments.** The agent, delegation
  tracking and cancellation saves all use the whole text, so the change would
  spread through every layer. Converting where packets are made keeps it in one
  place.
