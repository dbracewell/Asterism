import { defaultPersonaProvenance } from "@/test/personas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  ChatModelPicker,
  ExistingChatModelPicker,
  ExecutionLabel,
} from "./chat-model-picker";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageExecution } from "@/lib/client";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatModelsListOptions: () => ({ queryKey: ["models"], queryFn: mocks.list }),
  chatSessionGetOneOptions: () => ({ queryKey: ["chat"], queryFn: mocks.get }),
  chatModelUpdateMutation: () => ({ mutationFn: mocks.update }),
}));
const choices = [
  {
    id: "a",
    name: "Alpha",
    provider_name: "Provider",
    provider_type: "generic_openai",
    available: true,
  },
  {
    id: "b",
    name: "Beta",
    provider_name: "Provider",
    provider_type: "generic_openai",
    available: true,
  },
];
function wrapper(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    );
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue(choices);
});
it("changes a chat using the observed revision and never edits main settings", async () => {
  const onSelected = vi.fn();
  mocks.update.mockResolvedValue({
    id: "chat",
    selected_model_id: "b",
    model_revision: 4,
  });
  render(
    <ExistingChatModelPicker
      info={{
        id: "chat",
        user_id: "owner",
        created_at: 0,
        updated_at: 0,
        selected_model_id: "a",
        model_revision: 3,
      }}
      disabled={false}
      onSelected={onSelected}
    />,
    { wrapper: wrapper() },
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Chat model")).toBeEnabled(),
  );
  await userEvent.click(screen.getByLabelText("Chat model"));
  await userEvent.click(
    await screen.findByRole("option", { name: "Beta (Provider)" }),
  );
  expect(mocks.update.mock.calls[0][0]).toEqual({
    path: { chat_id: "chat" },
    body: { model_id: "b", expected_model_revision: 3 },
  });
  expect(onSelected.mock.calls[0][0]).toEqual(
    expect.objectContaining({ model_revision: 4 }),
  );
});
it("keeps the picker disabled during generation", async () => {
  render(<ChatModelPicker value="a" onChange={vi.fn()} disabled />, {
    wrapper: wrapper(),
  });
  await waitFor(() => expect(mocks.list).toHaveBeenCalled());
  expect(screen.getByLabelText("Chat model")).toBeDisabled();
});
it("preserves unavailable identity and reports no available models", async () => {
  mocks.list.mockResolvedValue([{ ...choices[0], available: false }]);
  render(
    <ChatModelPicker
      value="deleted"
      savedLabel="Deleted model"
      onChange={vi.fn()}
    />,
    { wrapper: wrapper() },
  );
  expect(await screen.findByText(/No available models/)).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Selected model is unavailable",
  );
  expect(screen.getByLabelText("Chat model")).toHaveTextContent(
    "Deleted model (unavailable)",
  );
});
it("keeps cached choices visible on refresh failure and offers retry", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["models"], choices);
  mocks.list
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(choices);
  render(<ChatModelPicker value="a" onChange={vi.fn()} />, {
    wrapper: wrapper(queryClient),
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Showing cached choices",
  );
  expect(screen.getByLabelText("Chat model")).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
});
it("labels historical output from its recorded snapshot", () => {
  const execution: MessageExecution = {
    persona: defaultPersonaProvenance,
    id: "run",
    request_message_id: "message",
    model_revision: 1,
    model: {
      id: "a",
      name: "Original model",
      provider_id: "provider",
      provider_name: "Original provider",
      provider_type: "generic_openai",
      available: true,
    },
    configuration: {
      id: "main",
      name: "Main",
      description: "",
      config_revision: 2,
    },
  };
  render(<ExecutionLabel execution={execution} />);
  expect(screen.getByLabelText("Executed model")).toHaveTextContent(
    "Original model · Original provider · configuration 2",
  );
});

it("shows explicit capabilities without inferring support from the model name", async () => {
  mocks.list.mockResolvedValue([
    {
      ...choices[0],
      supports_vision: true,
      supports_tools: false,
      context_window: 8192,
    },
  ]);
  render(<ChatModelPicker value="a" onChange={vi.fn()} />, {
    wrapper: wrapper(),
  });
  expect(await screen.findByText("Images supported")).toBeVisible();
  expect(screen.getByText("Tools unsupported")).toBeVisible();
});

it("shows provider and capability identity on each listed model", async () => {
  mocks.list.mockResolvedValue([
    { ...choices[0], provider_type: "openai", supports_tools: true },
    { ...choices[1], supports_vision: true, supports_tools: false },
  ]);
  render(<ChatModelPicker value="a" onChange={vi.fn()} />, {
    wrapper: wrapper(),
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Chat model")).toBeEnabled(),
  );
  await userEvent.click(screen.getByLabelText("Chat model"));
  expect(
    await screen.findByRole("option", { name: "Alpha (Provider)" }),
  ).toHaveAccessibleDescription(
    "OpenAI provider. Tools supported. Image support unknown",
  );
  const beta = screen.getByRole("option", { name: "Beta (Provider)" });
  expect(beta).toHaveAccessibleDescription(
    "OpenAI-compatible provider. Tools unsupported. Images supported",
  );
  expect(beta.querySelector('[title="Vision input"]')).not.toBeNull();
  expect(beta.querySelector('[title="Tool calling"]')).toBeNull();
});

it("requires a successful reload after a model revision conflict", async () => {
  mocks.update.mockRejectedValueOnce({ detail: "Selection changed" });
  mocks.get.mockResolvedValue({
    info: { id: "chat", selected_model_id: "b", model_revision: 8 },
    messages: [],
  });
  const onSelected = vi.fn();
  const onPendingChange = vi.fn();
  render(
    <ExistingChatModelPicker
      info={{
        id: "chat",
        user_id: "owner",
        created_at: 0,
        updated_at: 0,
        selected_model_id: "a",
        model_revision: 1,
      }}
      disabled={false}
      onSelected={onSelected}
      onPendingChange={onPendingChange}
    />,
    { wrapper: wrapper() },
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Chat model")).toBeEnabled(),
  );
  await userEvent.click(screen.getByLabelText("Chat model"));
  await userEvent.click(
    await screen.findByRole("option", { name: "Beta (Provider)" }),
  );
  expect(await screen.findByText(/Selection changed/)).toBeVisible();
  expect(screen.getByLabelText("Chat model")).toBeDisabled();
  expect(onPendingChange.mock.calls.map((call) => call[0])).toEqual([
    true,
    false,
  ]);
  await userEvent.click(
    screen.getByRole("button", { name: "Reload chat model" }),
  );
  await waitFor(() =>
    expect(onSelected).toHaveBeenCalledWith(
      expect.objectContaining({ model_revision: 8 }),
    ),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
