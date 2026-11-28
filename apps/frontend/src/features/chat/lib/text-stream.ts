/**
 * Rebuilds streamed text from numbered `delta` packets (ADR-0084).
 *
 * The server sends only new text (`append`) or the whole text so far
 * (`replace`), numbered per stream. A missing number means a packet was
 * dropped: the stream waits for a `replace` and asks for one once.
 */

export type DeltaPacket = {
  stream: string;
  seq: number;
  mode: "append" | "replace";
  content: string;
  thinking: string;
};

export type TextStreamState = {
  stream: string;
  seq: number;
  content: string;
  thinking: string;
  /** A gap was found; appends wait for a `replace`. */
  awaitingReplace: boolean;
};

export type DeltaResult = {
  state: TextStreamState;
  /** The text changed and should be shown. */
  changed: boolean;
  /** Ask the server for the text so far (send `resync`). */
  resync: boolean;
};

function replaced(packet: DeltaPacket): DeltaResult {
  return {
    state: {
      stream: packet.stream,
      seq: packet.seq,
      content: packet.content,
      thinking: packet.thinking,
      awaitingReplace: false,
    },
    changed: true,
    resync: false,
  };
}

function gap(state: TextStreamState, alreadyWaiting: boolean): DeltaResult {
  return {
    state: { ...state, awaitingReplace: true },
    changed: false,
    resync: !alreadyWaiting,
  };
}

export function applyDelta(
  state: TextStreamState | null,
  packet: DeltaPacket,
): DeltaResult {
  if (state == null || state.stream !== packet.stream) {
    if (packet.mode === "replace") return replaced(packet);
    if (packet.seq === 1) return replaced({ ...packet, mode: "replace" });
    // The stream's start was missed: nothing to append to yet.
    return gap(
      {
        stream: packet.stream,
        seq: 0,
        content: "",
        thinking: "",
        awaitingReplace: false,
      },
      false,
    );
  }
  if (packet.mode === "replace") {
    if (packet.seq < state.seq) return { state, changed: false, resync: false };
    return replaced(packet);
  }
  if (packet.seq <= state.seq) return { state, changed: false, resync: false };
  if (state.awaitingReplace || packet.seq !== state.seq + 1)
    return gap(state, state.awaitingReplace);
  return {
    state: {
      ...state,
      seq: packet.seq,
      content: state.content + packet.content,
      thinking: state.thinking + packet.thinking,
    },
    changed: true,
    resync: false,
  };
}
