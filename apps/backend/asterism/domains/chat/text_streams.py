"""Turn whole-text deltas into numbered increments for the chat socket (ADR-0084).

The agent emits the whole text so far in every ``DELTA`` event. A
:class:`TextStream` remembers what it last sent and produces packets with only
the new text (``append``), or with the whole text (``replace``) when the new
text doesn't extend what was sent. :class:`TextStreams` keeps a run's open
streams: the main reply and one per running sub-agent.
"""

import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TextStream:
    """One streamed text: its ID, the last number sent and the text sent so far."""

    stream: str = field(default_factory=lambda: uuid.uuid4().hex)
    seq: int = 0
    content: str = ""
    thinking: str = ""

    def delta(self, content: str, thinking: str) -> dict[str, Any] | None:
        """The packet fields that bring a reader from the sent text to this text, or ``None`` if nothing changed."""
        if content == self.content and thinking == self.thinking:
            return None
        if content.startswith(self.content) and thinking.startswith(self.thinking):
            mode, sent_content, sent_thinking = "append", content[len(self.content) :], thinking[len(self.thinking) :]
        else:
            mode, sent_content, sent_thinking = "replace", content, thinking
        self.seq += 1
        self.content, self.thinking = content, thinking
        return {
            "stream": self.stream,
            "seq": self.seq,
            "mode": mode,
            "content": sent_content,
            "thinking": sent_thinking,
        }

    def snapshot(self) -> dict[str, Any]:
        """The whole text sent so far, numbered with the last number, for a joining or lagging tab."""
        return {
            "stream": self.stream,
            "seq": self.seq,
            "mode": "replace",
            "content": self.content,
            "thinking": self.thinking,
        }


@dataclass
class _ChildStream:
    text: TextStream
    # The ``sub_agent`` packet fields other than ``event``, from its latest packet.
    envelope: dict[str, Any]


@dataclass
class TextStreams:
    """A run's open text streams: the main reply's step and each running sub-agent."""

    main: TextStream | None = None
    children: dict[str, _ChildStream] = field(default_factory=dict[str, _ChildStream])

    def main_delta(self, content: str, thinking: str) -> dict[str, Any] | None:
        """A ``delta`` packet for the main reply, starting a stream if none is open."""
        if self.main is None:
            self.main = TextStream()
        fields = self.main.delta(content, thinking)
        return None if fields is None else {"type": "delta", **fields}

    def end_main(self) -> None:
        """The step ended: the next text starts a new stream."""
        self.main = None

    def child_delta(self, envelope: dict[str, Any], content: str, thinking: str) -> dict[str, Any] | None:
        """A ``sub_agent`` packet carrying the child's ``delta``, keyed by its execution ID."""
        key = str(envelope["execution_id"])
        child = self.children.get(key)
        if child is None:
            child = self.children[key] = _ChildStream(text=TextStream(), envelope=envelope)
        child.envelope = envelope
        fields = child.text.delta(content, thinking)
        return None if fields is None else {**envelope, "event": {"type": "delta", **fields}}

    def end_child(self, execution_id: object) -> None:
        """The child's step or run ended."""
        self.children.pop(str(execution_id), None)

    def snapshots(self) -> list[dict[str, Any]]:
        """``replace`` packets for every open stream that has sent text."""
        packets: list[dict[str, Any]] = []
        if self.main is not None and self.main.seq:
            packets.append({"type": "delta", **self.main.snapshot()})
        for child in self.children.values():
            if child.text.seq:
                packets.append({**child.envelope, "event": {"type": "delta", **child.text.snapshot()}})
        return packets
