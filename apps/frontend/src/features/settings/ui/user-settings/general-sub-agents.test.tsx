import { TooltipProvider } from "@/components/ui/tooltip";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { GeneralSubAgents } from "./general-sub-agents";

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  agents: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/features/help/components/help-topic", () => ({
  HelpTopic: () => null,
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  mainAgentGeneralSubAgentsGetOptions: () => ({
    queryKey: ["general"],
    queryFn: () => mocks.set(),
  }),
  subAgentsListOptions: (options: object) => ({
    queryKey: ["workers", options],
    queryFn: () => mocks.agents(options),
  }),
  chatModelsListOptions: () => ({
    queryKey: ["models"],
    queryFn: async () => [
      { id: "model", name: "Fixed", provider_name: "Provider" },
    ],
  }),
  mainAgentGeneralSubAgentsUpdateMutation: () => ({ mutationFn: mocks.save }),
}));

const research = {
  id: "research",
  name: "Research",
  description: "Finds sources",
  model_id: "model",
  model_available: true,
};
const offline = {
  id: "offline",
  name: "Offline",
  model_id: "gone",
  model_available: false,
  model_unavailable_reason: "Provider disabled",
};

function setup() {
  const cache = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: () => {
        void cache.invalidateQueries();
      },
    }),
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <TooltipProvider>
        <GeneralSubAgents />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agents.mockResolvedValue({
    items: [research, offline],
    total: 2,
    page: 1,
    page_size: 10,
  });
});

it("starts empty and saves a chosen sub-agent with the expected revision", async () => {
  let saved = { revision: 1, agents: [] as object[], delegation_allowed: true };
  mocks.set.mockImplementation(async () => saved);
  mocks.save.mockImplementation(async () => {
    saved = { ...saved, revision: 2, agents: [research] };
    return saved;
  });
  setup();
  expect(
    await screen.findByText(
      "None chosen. In General chats the main agent works alone.",
    ),
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Choose General chat sub-agents" }),
  );
  const dialog = await screen.findByRole("dialog");
  // An unavailable fixed model can't be newly chosen.
  expect(
    await within(dialog).findByRole("checkbox", { name: /Offline/ }),
  ).toBeDisabled();
  expect(within(dialog).getByText("Provider disabled")).toBeInTheDocument();
  expect(
    within(dialog).getByText("Fixed model: Fixed (Provider)"),
  ).toBeInTheDocument();
  await userEvent.click(
    within(dialog).getByRole("checkbox", { name: /Research/ }),
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Save choices" }),
  );
  expect(mocks.save.mock.calls[0][0]).toMatchObject({
    body: { agent_ids: ["research"], expected_revision: 1 },
  });
  const section = screen.getByRole("region", {
    name: "General chat sub-agents",
  });
  expect(await within(section).findByText("Research")).toBeInTheDocument();
  expect(within(section).getByText("Available")).toBeInTheDocument();
});

it("keeps an unavailable chosen sub-agent removable and reports policy", async () => {
  mocks.set.mockResolvedValue({
    revision: 4,
    agents: [offline],
    delegation_allowed: false,
  });
  setup();
  expect(
    await screen.findByText(/An administrator has turned sub-agents off/),
  ).toBeInTheDocument();
  expect(screen.getByText("Model unavailable")).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Choose General chat sub-agents" }),
  );
  const dialog = await screen.findByRole("dialog");
  const box = await within(dialog).findByRole("checkbox", { name: /Offline/ });
  expect(box).toBeChecked();
  expect(box).toBeEnabled();
});

it("keeps pending choices on a conflict until the user reloads", async () => {
  mocks.set.mockResolvedValue({
    revision: 1,
    agents: [],
    delegation_allowed: true,
  });
  mocks.save.mockRejectedValue({
    detail: "General chat sub-agents changed; reload and try again",
  });
  setup();
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Choose General chat sub-agents",
    }),
  );
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(
    await within(dialog).findByRole("checkbox", { name: /Research/ }),
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Save choices" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "General chat sub-agents changed; reload and try again",
  );
  expect(
    within(dialog).getByRole("checkbox", { name: /Research/ }),
  ).toBeChecked();
});
