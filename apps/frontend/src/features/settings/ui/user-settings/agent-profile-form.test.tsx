import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentProfileForm, MainAgentForm } from "./agent-profile-form";
const mocks = vi.hoisted(() => ({
  mainSave: vi.fn().mockResolvedValue({}),
  create: vi.fn(),
  update: vi.fn(),
  models: vi.fn().mockResolvedValue([
    {
      id: "model",
      name: "Available",
      provider_name: "Test",
      available: true,
    },
  ]),
  tools: vi.fn().mockResolvedValue({ items: [] }),
  skills: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
  }),
  assigned: vi.fn().mockResolvedValue({ skill_ids: [], revision: 1 }),
  saveSkills: vi.fn(),
  policy: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 1,
    policy_enabled: true,
    agent_revision: 1,
  }),
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({
    id: "owner",
    settings: {
      models: [{ id: "model", name: "Available", provider_name: "Test" }],
      default_model_id: "model",
    },
  }),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatModelsListOptions: () => ({
    queryKey: ["models"],
    queryFn: mocks.models,
  }),
  mainAgentUpdateMutation: () => ({ mutationFn: mocks.mainSave }),
  subAgentCreateMutation: () => ({ mutationFn: mocks.create }),
  subAgentUpdateMutation: () => ({ mutationFn: mocks.update }),
  toolsGetActiveOptions: () => ({
    queryKey: ["tools"],
    queryFn: mocks.tools,
  }),
  // US-75.4: the sub-agent skills picker.
  skillGetManyOptions: ({ query }: { query: object }) => ({
    queryKey: [{ _id: "skills", query }],
    queryFn: () => mocks.skills(query),
  }),
  skillEligibleGetManyOptions: () => ({
    queryKey: [{ _id: "policy" }],
    queryFn: mocks.policy,
  }),
  subAgentSkillsGetOptions: ({ path }: { path: object }) => ({
    queryKey: [{ _id: "assigned", path }],
    queryFn: mocks.assigned,
  }),
  subAgentSkillsUpdateMutation: () => ({ mutationFn: mocks.saveSkills }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
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
  expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
  expect(screen.queryByText(/knowledge bases/i)).not.toBeInTheDocument();
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
  expect(screen.getByLabelText("Model")).toHaveTextContent("Select a model");
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

it("edits a sub-agent without offering obsolete knowledge-base assignments", async () => {
  render(
    <AgentProfileForm
      profile={{
        id: "worker",
        name: "Worker",
        description: "",
        model_id: "model",
        model_available: true,
        system_prompt: "Research",
        max_steps: 5,
        tools: [],
      }}
      completeEditing={vi.fn()}
    />,
    { wrapper: Wrapper },
  );
  await screen.findByRole("dialog", { name: "Edit sub-agent" });
  await waitFor(() =>
    expect(screen.getByLabelText("Model")).toHaveTextContent("Available"),
  );
  expect(screen.queryByText(/knowledge bases/i)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /save.*assignment/i }),
  ).not.toBeInTheDocument();
});

it("retains edits after a failed save and permits retry", async () => {
  mocks.mainSave.mockRejectedValueOnce(new Error("Denied"));
  render(
    <MainAgentForm
      configuration={{ id: "main", name: "Main", description: "" }}
    />,
    { wrapper: Wrapper },
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Edit main configuration" }),
  );
  await userEvent.type(screen.getByLabelText("Instructions"), "Keep my edits");
  await userEvent.click(
    await screen.findByRole("button", { name: "Save configuration" }),
  );
  expect(await screen.findByText(/Your edits are kept/)).toBeInTheDocument();
  expect(screen.getByLabelText("Instructions")).toHaveValue("Keep my edits");
  await userEvent.click(
    screen.getByRole("button", { name: "Save configuration" }),
  );
  expect(mocks.mainSave.mock.calls.at(-1)?.[0].body.system_prompt).toBe(
    "Keep my edits",
  );
});

it("blocks saving when models cannot refresh, without replacing the saved binding", async () => {
  mocks.models.mockRejectedValueOnce(new Error("Offline"));
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <TooltipProvider>
        <AgentProfileForm
          profile={{
            id: "worker",
            name: "Worker",
            model_id: "missing",
            model_available: false,
          }}
          completeEditing={vi.fn()}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText(/model list couldn't load/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Model")).toHaveTextContent(
    "missing (unavailable)",
  );
  expect(
    screen.getByRole("button", { name: "Save configuration" }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Retry models" }));
  expect(await screen.findByText(/saved binding remains/)).toBeInTheDocument();
});

beforeEach(() => {
  mocks.mainSave.mockReset().mockResolvedValue({});
  mocks.models.mockReset().mockResolvedValue([
    {
      id: "model",
      name: "Available",
      provider_name: "Test",
      available: true,
    },
  ]);
  mocks.tools.mockReset().mockResolvedValue({ items: [] });
});

it("preserves ordinary tool selections through a catalog failure and retry", async () => {
  mocks.tools.mockRejectedValueOnce(new Error("Offline"));
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <TooltipProvider>
        <MainAgentForm
          configuration={{
            id: "main",
            name: "Main",
            description: "",
            tools: ["web_fetch"],
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Edit main configuration" }),
  );
  expect(await screen.findByText(/Could not load tools/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Save configuration" }),
  ).toBeDisabled();
  expect(screen.queryByText(/unavailable; remove/)).not.toBeInTheDocument();
  mocks.tools.mockResolvedValue({
    items: [{ name: "web_fetch", policy: "user_configurable" }],
  });
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByLabelText("web_fetch")).toBeChecked();
});

it("saves edited fixed-model workers and validates numeric limits", async () => {
  mocks.update.mockResolvedValue({});
  render(
    <AgentProfileForm
      profile={{
        id: "worker",
        name: "Worker",
        model_id: "model",
        model_available: true,
      }}
      completeEditing={vi.fn()}
    />,
    { wrapper: Wrapper },
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Model")).toHaveTextContent("Available"),
  );
  const steps = screen.getByLabelText(/^Maximum steps/);
  await userEvent.clear(steps);
  await userEvent.type(steps, "0");
  expect(steps).toBeInvalid();
  await userEvent.click(
    screen.getByRole("button", { name: "Save configuration" }),
  );
  expect(mocks.update).not.toHaveBeenCalled();
  await userEvent.clear(steps);
  await userEvent.type(steps, "9");
  await userEvent.type(screen.getByLabelText("Seed"), "42");
  await userEvent.click(
    screen.getByRole("button", { name: "Save configuration" }),
  );
  expect(mocks.update).toHaveBeenCalledWith(
    expect.objectContaining({
      path: { agent_id: "worker" },
      body: expect.objectContaining({
        model_id: "model",
        max_steps: 9,
        chat_parameters: expect.objectContaining({ seed: 42 }),
      }),
    }),
    expect.anything(),
  );
});

it("saves a sub-agent's skills after its definition, against the new revision (US-75.4)", async () => {
  const skill = (id: string, name: string) => ({
    id,
    name,
    description: `${name} description`,
    revision: 1,
    created_at: 1,
    updated_at: 1,
  });
  mocks.skills.mockResolvedValue({
    items: [skill("s1", "review-code"), skill("s2", "write-tests")],
    total: 2,
    page: 1,
    page_size: 10,
  });
  mocks.assigned.mockResolvedValue({ skill_ids: ["s1"], revision: 3 });
  mocks.update.mockResolvedValue({ id: "worker", config_revision: 4 });
  mocks.saveSkills.mockResolvedValue({ skill_ids: ["s1", "s2"], revision: 5 });
  mocks.models.mockResolvedValueOnce([
    {
      id: "model",
      name: "Available",
      provider_name: "Test",
      available: true,
      supports_tools: false,
    },
  ]);
  render(
    <AgentProfileForm
      profile={{
        id: "worker",
        name: "Worker",
        model_id: "model",
        model_available: true,
        config_revision: 3,
      }}
      completeEditing={vi.fn()}
    />,
    { wrapper: Wrapper },
  );
  const reviewCode = await screen.findByRole("checkbox", {
    name: /review-code/,
  });
  await waitFor(() => expect(reviewCode).toBeChecked());
  expect(screen.getByText(/1 selected/)).toBeVisible();
  await userEvent.click(screen.getByRole("checkbox", { name: /write-tests/ }));
  expect(screen.getByText(/2 selected/)).toBeVisible();
  // The chosen model has no tool support, so the picker warns.
  expect(screen.getByRole("alert")).toHaveTextContent("can't load its skills");
  await userEvent.click(
    screen.getByRole("button", { name: "Save configuration" }),
  );
  await waitFor(() =>
    expect(mocks.saveSkills).toHaveBeenCalledWith(
      {
        path: { agent_id: "worker" },
        body: { skill_ids: ["s1", "s2"], expected_revision: 4 },
      },
      expect.anything(),
    ),
  );
  expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.saveSkills.mock.invocationCallOrder[0],
  );
});

it("leaves a sub-agent's skills alone when they were not changed (US-75.4)", async () => {
  mocks.assigned.mockResolvedValue({ skill_ids: [], revision: 1 });
  mocks.saveSkills.mockClear();
  mocks.update.mockResolvedValue({ id: "worker", config_revision: 2 });
  render(
    <AgentProfileForm
      profile={{
        id: "worker",
        name: "Worker",
        model_id: "model",
        model_available: true,
      }}
      completeEditing={vi.fn()}
    />,
    { wrapper: Wrapper },
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Model")).toHaveTextContent("Available"),
  );
  await screen.findByText("0 selected");
  await userEvent.click(
    screen.getByRole("button", { name: "Save configuration" }),
  );
  await waitFor(() => expect(mocks.update).toHaveBeenCalled());
  expect(mocks.saveSkills).not.toHaveBeenCalled();
});
