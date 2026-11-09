import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ComposerStatus } from "./composer-status";

const mocks = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/features/help/components/help-topic", () => ({
  HelpTopic: () => null,
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  mainAgentGeneralSubAgentsGetOptions: () => ({
    queryKey: ["general"],
    queryFn: () => mocks.set(),
  }),
  chatModelsListOptions: () => ({
    queryKey: ["models"],
    queryFn: async () => [
      { id: "tools", name: "Tools", supports_tools: true, available: true },
      { id: "plain", name: "Plain", supports_tools: false, available: true },
      {
        id: "plan",
        name: "GPT Plan",
        provider_type: "chatgpt",
        available: true,
      },
    ],
  }),
  chatgptPlanUsageResumeMutation: () => ({ mutationFn: vi.fn() }),
}));

function setup(props: React.ComponentProps<typeof ComposerStatus>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const ui = (next: React.ComponentProps<typeof ComposerStatus>) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ComposerStatus {...next} />
      </TooltipProvider>
    </QueryClientProvider>
  );
  const result = render(ui(props));
  return {
    ...result,
    rerender: (next: React.ComponentProps<typeof ComposerStatus>) =>
      result.rerender(ui(next)),
  };
}

const usage = { input_tokens: 700, total_tokens: 800, estimated: true };
const research = {
  id: "r",
  name: "Research",
  model_id: "m",
  model_available: true,
};

beforeEach(() => vi.clearAllMocks());

it("opens from the ring and compacts on request", async () => {
  const user = userEvent.setup();
  const onCompact = vi.fn();
  setup({ usage, contextWindow: 1000, onCompact, canCompact: true });
  await user.click(
    screen.getByRole("button", {
      name: "Context usage: about 80% of the model's context window",
    }),
  );
  expect(screen.getByText(/about 800 of 1,000 tokens \(80%\)/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Compact now" }));
  expect(onCompact).toHaveBeenCalledTimes(1);
});

it("disables Compact now while busy and shows progress", async () => {
  const user = userEvent.setup();
  const { rerender } = setup({
    usage,
    contextWindow: 1000,
    onCompact: vi.fn(),
    canCompact: false,
  });
  await user.click(screen.getByRole("button", { name: /Context usage/ }));
  expect(screen.getByRole("button", { name: "Compact now" })).toBeDisabled();
  rerender({
    usage,
    contextWindow: 1000,
    onCompact: vi.fn(),
    canCompact: true,
    compacting: true,
  });
  expect(screen.getByRole("button", { name: "Compacting…" })).toBeDisabled();
});

it("announces the connection and shows its text only when not connected", async () => {
  const { rerender } = setup({ connection: "Connected" });
  expect(screen.getByRole("status")).toHaveTextContent("Connected");
  expect(screen.getByRole("status")).toHaveClass("sr-only");
  expect(screen.getByRole("button", { name: "Chat status" })).toBeVisible();
  rerender({ connection: "Reconnecting" });
  expect(screen.getByRole("status")).toHaveTextContent("Reconnecting");
  expect(screen.getByRole("status")).not.toHaveClass("sr-only");
});

it("links to agent settings when General delegation is available", async () => {
  mocks.set.mockResolvedValue({
    revision: 2,
    agents: [research],
    delegation_allowed: true,
  });
  const user = userEvent.setup();
  setup({ general: true, modelId: "tools" });
  await user.click(await screen.findByRole("button", { name: "Chat status" }));
  const link = await screen.findByRole("link", {
    name: /^Sub-agents available: Research/,
  });
  expect(link).toHaveAttribute("href", "/settings?t=user&setting=agents");
});

it("explains why a chosen set can't be used with this model", async () => {
  mocks.set.mockResolvedValue({
    revision: 2,
    agents: [research],
    delegation_allowed: true,
  });
  const user = userEvent.setup();
  setup({ general: true, modelId: "plain" });
  await user.click(await screen.findByRole("button", { name: "Chat status" }));
  expect(
    await screen.findByRole("link", { name: /^Sub-agents unavailable\./ }),
  ).toHaveAccessibleName(/doesn't support tools/);
});

it("does not read the General set in a project chat", async () => {
  setup({ modelId: "tools", connection: "Connected" });
  await screen.findByRole("button", { name: "Chat status" });
  expect(mocks.set).not.toHaveBeenCalled();
});

it("shows ChatGPT plan usage for a plan model", async () => {
  const user = userEvent.setup();
  setup({ modelId: "plan" });
  await user.click(await screen.findByRole("button", { name: "Chat status" }));
  expect(screen.getByText("Using ChatGPT plan")).toBeVisible();
  expect(screen.getByRole("link", { name: /Manage usage/ })).toHaveAttribute(
    "href",
    "https://chatgpt.com/settings/usage",
  );
});

it("renders nothing when there is nothing to report", async () => {
  mocks.set.mockResolvedValue({
    revision: 1,
    agents: [],
    delegation_allowed: true,
  });
  const { container } = setup({
    general: true,
    modelId: "tools",
    usage,
    contextWindow: null,
  });
  await waitFor(() => expect(mocks.set).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
