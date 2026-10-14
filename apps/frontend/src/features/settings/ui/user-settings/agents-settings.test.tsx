import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { AgentsSettings } from "./agents-settings";
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({
    settings: {
      main_agent: { id: "main" },
      sub_agents: {
        worker: {
          id: "worker",
          name: "Research",
          description: "Facts",
          model_id: "fixed",
          model_available: false,
        },
      },
    },
  }),
}));
vi.mock("./agent-profile-form", () => ({
  AgentProfileForm: () => <button>Create sub-agent</button>,
  MainAgentForm: () => <button>Edit main configuration</button>,
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  subAgentDeleteMutation: () => ({ mutationFn: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}
it("shows one main editor and unavailable fixed-model workers without default/delete-main controls", () => {
  render(<AgentsSettings />, { wrapper: Wrapper });
  expect(
    screen.getAllByRole("button", { name: "Edit main configuration" }),
  ).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: /default|Delete main/i }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Sub-agents" })).toHaveTextContent(
    "Research",
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Fixed model unavailable",
  );
});
