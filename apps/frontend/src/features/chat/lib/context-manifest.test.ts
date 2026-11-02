import type { ContextManifest, Message, ToolResult } from "@/lib/client";
import { record } from "@/test/delegation-records";
import { expect, it } from "vitest";
import { layerLabel, turnContext } from "./context-manifest";

const layer = (kind: "agent" | "profile" | "skills" | "runtime") => ({
  kind,
  source_id: kind,
  revision: 1,
  digest: "d",
  characters: 10,
});

const search = (id: string, chunkId: string, excerpt: string): ToolResult =>
  ({
    tool_call: { id, function: { name: "search_knowledge" } },
    raw_result: { results: [{ chunk_id: chunkId, excerpt }] },
  }) as ToolResult;

const chunk = (toolCallId: string, chunkId: string) => ({
  tool_call_id: toolCallId,
  file_id: "f",
  chunk_id: chunkId,
  artifact_generation: 1,
  score: 0.5,
});

const step = (extra: Partial<Message>): Message =>
  ({
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    status: "completed",
    created_at: 0,
    ...extra,
  }) as Message;

const runtimeCut = {
  kind: "runtime_instructions",
  reason: "Runtime details were cut.",
} as const;

it("combines a turn's steps: shared layers once, every step's chunks with their excerpts", () => {
  const shared: ContextManifest = {
    layers: [layer("agent"), layer("runtime")],
    files: [{ file_id: "a", name: "notes.txt", inclusion: "text" }],
    omissions: [runtimeCut],
  };
  const first = step({
    context: { ...shared, chunks: [chunk("call-1", "c1")] },
    tool_call_results: [search("call-1", "c1", "First excerpt")],
  });
  const second = step({
    context: {
      ...shared,
      chunks: [chunk("call-2", "c2")],
      omissions: [
        runtimeCut,
        { kind: "retrieval", subject: "call-2", reason: "No results." },
      ],
    },
  });
  const context = turnContext([first, second]);
  expect(context?.layerMessageId).toBe(first.id);
  const [main] = context!.agents;
  expect(main.layers.map((item) => item.kind)).toEqual(["agent", "runtime"]);
  expect(main.files.map((file) => file.name)).toEqual(["notes.txt"]);
  expect(main.chunks.map((item) => [item.chunk_id, item.excerpt])).toEqual([
    ["c1", "First excerpt"],
    ["c2", null],
  ]);
  expect(main.omissions.map((item) => item.reason)).toEqual([
    "Runtime details were cut.",
    "No results.",
  ]);
});

it("adds sub-agents that recorded context and is null when nothing was recorded", () => {
  const context = turnContext([
    step({
      delegations: [
        record("child", {
          name: "Researcher",
          depth: 2,
          context: { layers: [layer("agent")], chunks: [chunk("x", "c")] },
          tool_results: [search("x", "c", "Child excerpt")],
        }),
        record("unrecorded"),
      ],
    }),
  ]);
  expect(context?.layerMessageId).toBeNull();
  expect(
    context?.agents.map((agent) => [agent.name, agent.isSubAgent, agent.depth]),
  ).toEqual([["Researcher", true, 2]]);
  expect(context?.agents[0].chunks[0].excerpt).toBe("Child excerpt");
  expect(turnContext([step({ delegations: [record("none")] })])).toBeNull();
});

it("labels layers with the run's recorded persona and skills", () => {
  const execution = {
    persona: { id: "p", name: "Teacher", revision: 1 },
    skills: [
      { id: "s", name: "Proofs", revision: 1, digest: "d" },
      { id: "t", name: "Style", revision: 2, digest: "d" },
    ],
  } as unknown as Message["execution"];
  expect(layerLabel(layer("profile"), execution)).toBe("Persona: Teacher");
  expect(layerLabel(layer("skills"), execution)).toBe("Skills: Proofs, Style");
  expect(layerLabel(layer("agent"), execution)).toBe("Main-agent instructions");
  expect(layerLabel(layer("agent"), execution, true)).toBe(
    "Sub-agent instructions",
  );
});
