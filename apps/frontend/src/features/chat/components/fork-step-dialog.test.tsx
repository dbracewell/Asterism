import { ApiClient } from "@/lib/client";
import { record } from "@/test/delegation-records";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ForkStepDialog, type ForkSource } from "./fork-step-dialog";

const { api } = vi.hoisted(() => ({
  api: {
    chatForkInstructionsGet: vi.fn(),
    chatMessageFork: vi.fn(),
    subAgentInstructionsUpdate: vi.fn(),
  },
}));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
}));

const instructions = (extra = {}) => ({
  data: {
    sub_agent_id: "writer",
    sub_agent_name: "Writer",
    instructions: "Write plainly",
    source: "definition",
    definition_revision: 3,
    rerun_execution_id: "nested",
    rerun_sub_agent_name: "Writer",
    ...extra,
  },
});

function setup(source: ForkSource, onForked = vi.fn()) {
  const onOpenChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ForkStepDialog
        chatId="chat"
        source={source}
        onOpenChange={onOpenChange}
        onForked={onForked}
      />
    </QueryClientProvider>,
  );
  return { onForked, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  ApiClient.__registry.set(api as never);
  api.chatForkInstructionsGet.mockResolvedValue(instructions());
  api.chatMessageFork.mockResolvedValue({ data: { id: "fork-step" } });
  api.subAgentInstructionsUpdate.mockResolvedValue({
    data: { config_revision: 4 },
  });
});

const nested: ForkSource = {
  messageId: "step-1",
  record: record("nested", { name: "Writer" }),
};

it("runs a fork with edited instructions without saving the sub-agent", async () => {
  const { onForked, onOpenChange } = setup(nested);
  const field = await screen.findByLabelText(
    "Writer instructions for this run",
  );
  expect(field).toHaveValue("Write plainly");
  expect(api.chatForkInstructionsGet).toHaveBeenCalledWith(
    expect.objectContaining({
      path: { chat_id: "chat", message_id: "step-1" },
      query: { delegation_execution_id: "nested" },
    }),
  );
  expect(screen.getByText("Sub-agent's current instructions")).toBeVisible();

  await userEvent.clear(field);
  await userEvent.type(field, "Write formally");
  await userEvent.click(screen.getByRole("button", { name: "Run fork" }));
  await waitFor(() => expect(onForked).toHaveBeenCalled());
  expect(api.chatMessageFork).toHaveBeenCalledWith(
    expect.objectContaining({
      path: { chat_id: "chat", message_id: "step-1" },
      body: expect.objectContaining({
        delegation_execution_id: "nested",
        instructions: "Write formally",
      }),
    }),
  );
  expect(api.subAgentInstructionsUpdate).not.toHaveBeenCalled();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("saves to the sub-agent only when asked, against the revision it read", async () => {
  setup(nested);
  const field = await screen.findByLabelText(
    "Writer instructions for this run",
  );
  await userEvent.type(field, " and briefly");
  await userEvent.click(
    screen.getByRole("button", { name: "Save to sub-agent" }),
  );
  await waitFor(() =>
    expect(api.subAgentInstructionsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { agent_id: "writer" },
        body: {
          system_prompt: "Write plainly and briefly",
          expected_revision: 3,
        },
      }),
    ),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Saved to Writer",
  );
  expect(api.chatMessageFork).not.toHaveBeenCalled();
});

it("explains when a nested agent's parent delegation runs again", async () => {
  api.chatForkInstructionsGet.mockResolvedValue(
    instructions({
      rerun_execution_id: "lead",
      rerun_sub_agent_name: "Researcher",
      source: "fork",
      instructions: "Be brief",
    }),
  );
  setup(nested);
  expect(await screen.findByText(/Writer ran inside Researcher/)).toBeVisible();
  expect(screen.getByText("From this fork")).toBeVisible();
});

it("shows a refused fork in the dialog", async () => {
  api.chatMessageFork.mockRejectedValueOnce({
    detail: "Chat branch changed; reload before forking",
  });
  const { onForked } = setup(nested);
  await screen.findByLabelText("Writer instructions for this run");
  await userEvent.click(screen.getByRole("button", { name: "Run fork" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Chat branch changed",
  );
  expect(onForked).not.toHaveBeenCalled();
});
