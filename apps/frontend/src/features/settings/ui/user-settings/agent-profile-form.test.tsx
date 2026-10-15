import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { MainAgentForm, AgentProfileForm } from "./agent-profile-form";
const mocks = vi.hoisted(() => ({
  mainSave: vi.fn().mockResolvedValue({}),
  create: vi.fn(),
  update: vi.fn(),
  tools: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({
    settings: {
      models: [{ id: "model", name: "Available", provider_name: "Test" }],
      default_model_id: "model",
    },
  }),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  mainAgentUpdateMutation: () => ({ mutationFn: mocks.mainSave }),
  subAgentCreateMutation: () => ({ mutationFn: mocks.create }),
  subAgentUpdateMutation: () => ({ mutationFn: mocks.update }),
  toolsGetActiveOptions: () => ({
    queryKey: ["tools"],
    queryFn: mocks.tools,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}
it("saves main instructions separately from the model and preserves other generation defaults", async () => {
  render(
    <MainAgentForm
      configuration={{
        id: "main",
        name: "Main",
        description: "",
        system_prompt: "",
        max_steps: 5,
        tools: [],
        chat_parameters: { top_p: 0.8 },
      }}
    />,
    { wrapper: Wrapper },
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Edit main configuration" }),
  );
  expect(screen.queryByLabelText("Fixed model")).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Instructions"), "Be precise");
  await userEvent.click(
    await screen.findByRole("button", { name: "Save configuration" }),
  );
  expect(mocks.mainSave).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        system_prompt: "Be precise",
        chat_parameters: { top_p: 0.8, temperature: null, max_tokens: null },
      }),
    }),
    expect.anything(),
  );
  expect(mocks.mainSave.mock.calls[0][0].body).not.toHaveProperty("model_id");
});
it("requires an explicit model for a new sub-agent instead of using the user's default", async () => {
  render(<AgentProfileForm profile={null} completeEditing={vi.fn()} />, {
    wrapper: Wrapper,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Create sub-agent" }),
  );
  expect(screen.getByLabelText("Fixed model")).toHaveTextContent(
    "Select a model",
  );
  expect(
    screen.getByRole("button", { name: "Save configuration" }),
  ).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("saved binding remains");
});

it("hides context-managed tools while retaining ordinary tool settings", async () => {
  mocks.tools.mockResolvedValue({
    items: [
      {
        name: "sub_agent",
        policy: "context_managed",
        description: "Delegation",
      },
      {
        name: "search_knowledge",
        policy: "context_managed",
        description: "Retrieval",
      },
      { name: "web_fetch", policy: "user_configurable", description: "Fetch" },
    ],
  });
  render(
    <MainAgentForm
      configuration={{
        id: "main",
        name: "Main",
        description: "",
        system_prompt: "",
        max_steps: 5,
        tools: [],
      }}
    />,
    { wrapper: Wrapper },
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Edit main configuration" }),
  );
  await screen.findByText("web_fetch");
  expect(screen.queryByText("sub_agent")).not.toBeInTheDocument();
  expect(screen.queryByText("search_knowledge")).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("web_fetch"));
  await userEvent.click(
    screen.getByRole("button", { name: "Save configuration" }),
  );
  expect(mocks.mainSave.mock.calls.at(-1)?.[0].body.tools).toEqual([
    "web_fetch",
  ]);
});
