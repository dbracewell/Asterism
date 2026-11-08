import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { GeneralDelegationStatus } from "./general-delegation-status";

const mocks = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  mainAgentGeneralSubAgentsGetOptions: () => ({
    queryKey: ["general"],
    queryFn: () => mocks.set(),
  }),
  chatModelsListOptions: () => ({
    queryKey: ["models"],
    queryFn: async () => [
      { id: "tools", name: "Tools", supports_tools: true },
      { id: "plain", name: "Plain", supports_tools: false },
    ],
  }),
}));

function setup(modelId: string) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TooltipProvider>
        <GeneralDelegationStatus modelId={modelId} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const research = {
  id: "r",
  name: "Research",
  model_id: "m",
  model_available: true,
};

beforeEach(() => vi.clearAllMocks());

it("links to agent settings when delegation is available", async () => {
  mocks.set.mockResolvedValue({
    revision: 2,
    agents: [research],
    delegation_allowed: true,
  });
  setup("tools");
  const link = await screen.findByRole("link", {
    name: "Sub-agents available: Research",
  });
  expect(link).toHaveAttribute("href", "/settings?t=user&setting=agents");
});

it("explains why a chosen set can't be used with this model", async () => {
  mocks.set.mockResolvedValue({
    revision: 2,
    agents: [research],
    delegation_allowed: true,
  });
  setup("plain");
  expect(
    await screen.findByRole("link", { name: /^Sub-agents unavailable\./ }),
  ).toHaveAccessibleName(/doesn't support tools/);
});

it("renders nothing without a set or when it can't be read", async () => {
  mocks.set.mockResolvedValue({
    revision: 1,
    agents: [],
    delegation_allowed: true,
  });
  const empty = setup("tools");
  await waitFor(() => expect(mocks.set).toHaveBeenCalled());
  expect(empty.container).toBeEmptyDOMElement();
  empty.unmount();
  mocks.set.mockRejectedValue(new Error("offline"));
  const failed = setup("tools");
  await waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(2));
  expect(failed.container).toBeEmptyDOMElement();
});
