import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ReactNode } from "react";
import { expect, it, vi } from "vitest";

import { AgentsSettings } from "./agents-settings";

const user = {
  settings: {
    default_agent_id: "main-agent",
    agents: {
      "main-agent": {
        id: "main-agent",
        name: "Chat assistant",
        description: "Answers directly",
        sub_agent: false,
        model_id: "model-1",
        system_prompt: null,
        max_steps: 5,
        tools: [],
        chat_parameters: {},
      },
      "sub-agent": {
        id: "sub-agent",
        name: "Research worker",
        description: "Delegated research",
        sub_agent: true,
        model_id: "model-1",
        system_prompt: null,
        max_steps: 5,
        tools: [],
        chat_parameters: {},
      },
    },
  },
};

vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => user,
}));
vi.mock("./agent-profile-form", () => ({
  AgentProfileForm: () => <button>Create agent</button>,
}));
vi.mock("@/features/settings/hooks/use-update-user-settings", () => ({
  useUpdateUserSettings: () => ({
    updateSetting: vi.fn(),
    isUpdatingUserSetting: false,
  }),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  agentsDeleteAgentMutation: () => ({ mutationFn: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

it("separates main agents from delegated sub-agents and limits default controls", () => {
  render(<AgentsSettings />, { wrapper: Wrapper });

  const mainAgents = screen.getByRole("region", { name: "Main agents" });
  const subAgents = screen.getByRole("region", { name: "Sub-agents" });
  expect(mainAgents).toHaveTextContent("Chat assistant");
  expect(mainAgents).not.toHaveTextContent("Research worker");
  expect(subAgents).toHaveTextContent("Research worker");
  expect(subAgents).not.toHaveTextContent("Set as global default for new chats");
});
