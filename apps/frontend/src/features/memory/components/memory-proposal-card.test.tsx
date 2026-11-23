import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { memoryToolLabel } from "@/features/chat/lib/agent-timeline";
import type { MemoryProposal, ToolResult } from "@/lib/client";
import { MemoryProposalCards, proposalIds } from "./memory-proposal-card";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  memoryProposalGetOneOptions: (options: {
    path: { proposal_id: string };
  }) => ({
    queryKey: [{ _id: "memoryProposalGetOne", path: options.path }],
    queryFn: () => mocks.get(options.path.proposal_id),
  }),
  memoryProposalGetOneQueryKey: (options: {
    path: { proposal_id: string };
  }) => [{ _id: "memoryProposalGetOne", path: options.path }],
  memoryProposalSaveMutation: () => ({ mutationFn: mocks.save }),
  memoryProposalDismissMutation: () => ({ mutationFn: mocks.dismiss }),
  memoryGetManyQueryKey: () => [{ _id: "memoryGetMany" }],
  memoryAvailabilityQueryKey: () => [{ _id: "memoryAvailability" }],
}));

const ID = "11111111-1111-4111-8111-111111111111";

function proposal(over: Partial<MemoryProposal> = {}): MemoryProposal {
  return {
    id: ID,
    chat_id: "c1",
    message_id: "m1",
    execution_id: "e1",
    kind: "user",
    project_id: null,
    text: "Learns best from worked examples",
    category: "learning",
    sensitive: false,
    status: "pending",
    memory_id: null,
    created_at: 0,
    decided_at: null,
    ...over,
  };
}

function result(name: string, raw: unknown): ToolResult {
  return {
    tool_call: {
      id: "t1",
      type: "function",
      function: { name, arguments: "{}" },
    },
    content: JSON.stringify(raw),
    raw_result: raw,
  } as ToolResult;
}

const offered = [result("propose_memory", { proposal_id: ID })];

function setup() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <MemoryProposalCards results={offered} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(proposal());
  mocks.save.mockResolvedValue({});
  mocks.dismiss.mockResolvedValue({});
});

it("reads proposal ids only from propose_memory results", () => {
  expect(
    proposalIds([
      result("canvas_create", { proposal_id: ID }),
      result("propose_memory", { error: "Memory is off" }),
      ...offered,
    ]),
  ).toEqual([ID]);
});

it("shows the text and where it will be saved, and saves only on a click", async () => {
  const user = setup();
  const card = await screen.findByRole("region", { name: "Remember this?" });
  expect(card).toHaveTextContent("Learns best from worked examples");
  expect(card).toHaveTextContent("Saves to: You, in every chat");
  expect(mocks.save).not.toHaveBeenCalled();
  await user.click(within(card).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mocks.save.mock.calls[0]?.[0]).toEqual({
      path: { proposal_id: ID },
      body: {
        text: "Learns best from worked examples",
        category: "learning",
        sensitive: false,
      },
    }),
  );
});

it("saves an edited proposal", async () => {
  const user = setup();
  const card = await screen.findByRole("region", { name: "Remember this?" });
  await user.click(within(card).getByRole("button", { name: "Edit" }));
  const text = within(card).getByLabelText("Memory");
  await user.clear(text);
  await user.type(text, " Learns from diagrams ");
  await user.click(within(card).getByLabelText("Sensitive"));
  await user.click(within(card).getByRole("button", { name: "Save memory" }));
  await waitFor(() =>
    expect(mocks.save.mock.calls[0]?.[0]).toEqual({
      path: { proposal_id: ID },
      body: {
        text: "Learns from diagrams",
        category: "learning",
        sensitive: true,
      },
    }),
  );
});

it("dismisses, and a project proposal names the project", async () => {
  mocks.get.mockResolvedValue(
    proposal({ kind: "project", project_id: "p1", category: null }),
  );
  const user = setup();
  const card = await screen.findByRole("region", { name: "Remember this?" });
  expect(card).toHaveTextContent("Saves to: This project");
  await user.click(within(card).getByRole("button", { name: "Dismiss" }));
  await waitFor(() =>
    expect(mocks.dismiss.mock.calls[0]?.[0]).toEqual({
      path: { proposal_id: ID },
    }),
  );
});

it("shows a refusal, such as memory turned off since", async () => {
  mocks.save.mockRejectedValueOnce({
    detail: "You've turned memory off in Your Asterism",
  });
  const user = setup();
  const card = await screen.findByRole("region", { name: "Remember this?" });
  await user.click(within(card).getByRole("button", { name: "Save" }));
  expect(await within(card).findByRole("alert")).toHaveTextContent(
    "You've turned memory off in Your Asterism",
  );
});

it("links a saved proposal to its memory", async () => {
  mocks.get.mockResolvedValue(
    proposal({ status: "saved", memory_id: "mem1", decided_at: 1 }),
  );
  setup();
  expect(
    await screen.findByRole("link", { name: "View memory" }),
  ).toHaveAttribute(
    "href",
    "/settings?t=user&setting=your-asterism&memory=mem1",
  );
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

it("labels the tool step in the timeline", () => {
  expect(memoryToolLabel("propose_memory", "succeeded")).toBe(
    "Offered to remember something",
  );
  expect(memoryToolLabel("web_search", "succeeded")).toBeUndefined();
});
