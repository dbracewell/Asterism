import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { AgentsSettings } from "./agents-settings";
vi.mock("./agent-profile-form", () => ({
  AgentProfileForm: () => <button>Create sub-agent</button>,
  MainAgentForm: () => <button>Edit main configuration</button>,
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
      items: [
        {
          id: "worker",
          name: "Research",
          description: "Facts",
          model_id: "fixed",
          model_available: false,
        },
      ],
      total: 1,
      page: 1,
      page_size: 10,
    }),
  }),
  subAgentDeleteMutation: () => ({ mutationFn: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
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
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Fixed model unavailable",
  );
});
