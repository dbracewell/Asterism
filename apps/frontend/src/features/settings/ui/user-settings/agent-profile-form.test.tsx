import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { expect, it, vi } from "vitest";

import { AgentProfileForm } from "./agent-profile-form";

const { replaceAssignments, user } = vi.hoisted(() => ({
  replaceAssignments: vi.fn(),
  user: { settings: { default_model_id: "10000000-0000-4000-8000-000000000001", models: [] } },
}));

vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => user,
}));
vi.mock("@/lib/api", () => ({
  client: {},
  api: { agentKnowledgeBaseAssignmentsReplace: replaceAssignments },
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  agentsUpsertAgentProfileMutation: () => ({ mutationFn: vi.fn() }),
  toolsGetActiveOptions: () => ({ queryKey: ["tools"], queryFn: () => ({ items: [] }) }),
  knowledgeBaseGetManyOptions: () => ({
    queryKey: ["knowledge"],
    queryFn: () => ({ knowledge_bases: [{ id: "20000000-0000-4000-8000-000000000001", name: "Research" }] }),
  }),
}));
vi.mock("@/components/settings/model-selector", () => ({
  ModelSelector: () => <span>Model selector</span>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserver);

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}><TooltipProvider>{children}</TooltipProvider></QueryClientProvider>;
}

it("shows existing assignments and explains automatic knowledge search", async () => {
  render(<AgentProfileForm profile={{
    id: "30000000-0000-4000-8000-000000000001",
    name: "Researcher",
    description: "Searches notes",
    sub_agent: false,
    model_id: "10000000-0000-4000-8000-000000000001",
    system_prompt: null,
    max_steps: 5,
    knowledge_bases: [{ id: "20000000-0000-4000-8000-000000000001", name: "Research" }],
  }} completeEditing={vi.fn()} />, { wrapper: Wrapper });

  const knowledgeCheckbox = await screen.findByLabelText("Research");
  expect(screen.getByText(/Assigned knowledge bases enable automatic/)).toBeInTheDocument();
  expect(knowledgeCheckbox).toBeChecked();
  await userEvent.setup().click(knowledgeCheckbox);
  expect(knowledgeCheckbox).not.toBeChecked();
});
