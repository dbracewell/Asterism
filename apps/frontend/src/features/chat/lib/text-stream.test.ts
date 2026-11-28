import { describe, expect, it } from "vitest";
import { applyDelta, DeltaPacket, TextStreamState } from "./text-stream";

const packet = (
  seq: number,
  mode: DeltaPacket["mode"],
  content: string,
  stream = "s",
): DeltaPacket => ({ stream, seq, mode, content, thinking: "" });

function run(packets: DeltaPacket[]) {
  let state: TextStreamState | null = null;
  const resyncs: number[] = [];
  for (const next of packets) {
    const result = applyDelta(state, next);
    state = result.state;
    if (result.resync) resyncs.push(next.seq);
  }
  return { state, resyncs };
}

describe("applyDelta", () => {
  it("appends in order and ignores duplicates", () => {
    const { state, resyncs } = run([
      packet(1, "append", "a"),
      packet(2, "append", "b"),
      packet(2, "append", "b"),
      packet(1, "append", "a"),
      packet(3, "append", "c"),
    ]);
    expect(state?.content).toBe("abc");
    expect(resyncs).toEqual([]);
  });

  it("takes a replacement at or after its number, never an older one", () => {
    const { state } = run([
      packet(1, "append", "Answer: x"),
      packet(2, "replace", "Answer:"),
      packet(1, "replace", "stale"),
      packet(3, "append", " y"),
    ]);
    expect(state?.content).toBe("Answer: y");
  });

  it("waits for a replacement after a gap and asks only once", () => {
    const { state, resyncs } = run([
      packet(1, "append", "a"),
      packet(3, "append", "c"),
      packet(4, "append", "d"),
    ]);
    expect(state).toMatchObject({ content: "a", awaitingReplace: true });
    expect(resyncs).toEqual([3]);

    const repaired = applyDelta(state, packet(4, "replace", "abcd"));
    expect(repaired.state).toMatchObject({
      content: "abcd",
      seq: 4,
      awaitingReplace: false,
    });
  });

  it("starts a new stream from its first packet or a replacement", () => {
    const first = run([
      packet(1, "append", "old"),
      packet(1, "append", "new", "t"),
    ]);
    expect(first.state).toMatchObject({ stream: "t", content: "new" });

    const joined = run([packet(5, "replace", "so far", "t")]);
    expect(joined.state).toMatchObject({ seq: 5, content: "so far" });

    const missed = run([packet(3, "append", "lost", "t")]);
    expect(missed.state).toMatchObject({ content: "", awaitingReplace: true });
    expect(missed.resyncs).toEqual([3]);
  });
});
