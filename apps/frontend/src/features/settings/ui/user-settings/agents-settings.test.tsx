import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ReactNode, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { turnOff } from "@/test/availability";
import { AgentsSettings } from "./agents-settings";
const workers = vi.hoisted(() => ({ none: false }));
vi.mock("@/features/availability/queries", () => import("@/test/availability"));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: "tester" }),
}));
vi.mock("./agent-profile-form", () => ({
  AgentProfileForm: () => <button>Create sub-agent</button>,
  MainAgentForm: () => <button>Edit main configuration</button>,
}));
vi.mock("./general-sub-agents", () => ({
  GeneralSubAgents: () => <section aria-label="General chat sub-agents" />,
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  mainAgentGetOptions: () => ({
    queryKey: ["main"],
    queryFn: async () => ({ id: "main" }),
  }),
  chatModelsListOptions: () => ({
    queryKey: ["models"],
    queryFn: async () => [],
  }),
  subAgentsListOptions: () => ({
    queryKey: ["workers"],
    queryFn: async () => ({
      items: workers.none
        ? []
        : [
            {
              id: "worker",
              name: "Research",
              description: "Facts",
              model_id: "fixed",
              model_available: false,
            },
            {
              id: "tutor",
              name: "Tutor",
              description: "Hints",
              model_id: "fixed",
              model_available: true,
              managed_by_class: "Biology 101",
            },
          ],
      total: workers.none ? 0 : 2,
      page: 1,
      page_size: 10,
    }),
  }),
  subAgentDeleteMutation: () => ({ mutationFn: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  turnOff();
  workers.none = false;
});
it("shows one main editor and unavailable fixed-model workers without default/delete-main controls", async () => {
  render(<AgentsSettings />, { wrapper: Wrapper });
  expect(
    await screen.findAllByRole("button", { name: "Edit main configuration" }),
  ).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: /default|Delete main/i }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Sub-agents" })).toHaveTextContent(
    "Research",
  );
  expect((await screen.findAllByRole("status"))[0]).toHaveTextContent(
    "Fixed model unavailable",
  );
});
it("marks course sub-agents and offers no edit or delete for them", async () => {
  render(<AgentsSettings />, { wrapper: Wrapper });
  expect(await screen.findByText("Managed by Biology 101")).toBeInTheDocument();
  expect(
    screen.getByText("Part of a course, so only course updates can change it."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit Research" })).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "Edit Tutor" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete Tutor" }),
  ).not.toBeInTheDocument();
});
it("keeps the full model name readable when the card truncates it (US-75.1)", async () => {
  render(<AgentsSettings />, { wrapper: Wrapper });
  const [label] = await screen.findAllByTitle("fixed");
  // Visually clipped with an ellipsis, but the whole name stays in the text.
  expect(label).toHaveTextContent("fixed");
  expect(label).toHaveClass("truncate", "min-w-0");
});

it("keeps your sub-agents reachable while the admin has sub-agents off (EPIC-97)", async () => {
  turnOff("delegation");
  render(<AgentsSettings />, { wrapper: Wrapper });
  const section = await screen.findByRole("region", { name: "Sub-agents" });
  expect(section).toHaveTextContent(
    "An administrator has turned sub-agents off",
  );
  expect(await screen.findByText("Research")).toBeInTheDocument();
});
it("leaves Sub-agents out while they are off and you have none (EPIC-97)", async () => {
  turnOff("delegation");
  workers.none = true;
  render(<AgentsSettings />, { wrapper: Wrapper });
  await screen.findByRole("button", { name: "Edit main configuration" });
  expect(screen.queryByRole("region", { name: "Sub-agents" })).toBeNull();
});
