import { TooltipProvider } from "@/components/ui/tooltip";
import { defaultPersonas } from "@/test/personas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import AppPage from "./page";
const mocks = vi.hoisted(() => ({
  models: [
    { id: "model", available: true },
    { id: "other", available: true },
  ],
  createChatSession: vi.fn(),
  coursePolicy: vi.fn(async (): Promise<object | null> => null),
  getProject: vi.fn(async () => ({
    id: "project",
    name: "Research",
    description: "",
    goal: "",
    goal_target_date: null,
    areas: { study: true, reflections: true, goal: true, sub_agents: true },
  })),
  skills: [] as { id: string; name: string; description: string }[],
  search: "project_id=project",
  fill: vi.fn(),
  user: {
    id: "test",
    name: "Ada",
    settings: {
      main_agent: { id: "main", name: "Main agent" },
      default_model_id: "model",
    },
  },
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => mocks.user,
}));
vi.mock("@/features/chat/hooks/use-chat-session-crud", () => ({
  useChatSessionCrud: () => ({ createChatSession: mocks.createChatSession }),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  courseModePolicyGetOptions: () => ({
    queryKey: ["course-policy"],
    queryFn: mocks.coursePolicy,
  }),
  projectGetOneOptions: () => ({
    queryKey: ["project"],
    queryFn: mocks.getProject,
  }),
  userPersonaListOptions: () => ({
    queryKey: ["personas"],
    queryFn: async () => defaultPersonas,
  }),
  skillEligibleGetManyOptions: () => ({
    queryKey: [{ _id: "skills" }],
    queryFn: async () => ({ items: mocks.skills }),
  }),
  chatModelsListOptions: () => ({
    queryKey: ["models"],
    queryFn: async () => mocks.models,
  }),
  learningModeGetManyOptions: () => ({
    queryKey: ["learning-modes"],
    queryFn: async () => ({
      modes: [
        { id: "standard", name: "Standard", description: "", version: 1 },
        { id: "tutor", name: "Tutor", description: "", version: 1 },
      ],
    }),
  }),
}));
vi.mock("@/features/chat/components/chat-model-picker", () => ({
  ChatModelPicker: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label="Chat model"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Choose</option>
      <option value="model">Model A</option>
      <option value="other">Model B</option>
      <option value="only">Only model</option>
    </select>
  ),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/components/logo", () => ({ default: () => null }));
// The first-chat tour has its own tests (first-chat-tour.test.tsx).
vi.mock("@/features/help/components/first-chat-tour", () => ({
  FirstChatTour: () => null,
}));
vi.mock(
  "@/features/chat/components/compare-targets",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/features/chat/components/compare-targets")
    >()),
    CompareModelsPicker: () => null,
  }),
);
vi.mock("@/features/chat/components/chat-input", async () => {
  const React = await import("react");
  return {
    ChatInput: ({
      ref,
      onSubmit,
      disabled,
      modelSelector,
    }: {
      ref: React.Ref<{ fill: (text: string) => void }>;
      onSubmit: (value: unknown) => void;
      disabled: boolean;
      modelSelector: React.ReactNode;
    }) => {
      React.useImperativeHandle(ref, () => ({ fill: mocks.fill }));
      return (
        <>
          {modelSelector}
          <button
            disabled={disabled}
            onClick={() =>
              onSubmit({
                prompt: "Hello",
                files: [],
                requestId: "request",
                draftId: "staged-draft",
              })
            }
          >
            Start chat
          </button>
        </>
      );
    },
    ChatInputContainer: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
  };
});
afterEach(() => {
  mocks.search = "project_id=project";
  mocks.skills = [];
});
function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <AppPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}
it("prefills only the explicit default, permits a different model, and sends it independently of the main configuration", async () => {
  renderPage();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled(),
  );
  await userEvent.selectOptions(screen.getByLabelText("Chat model"), "other");
  await userEvent.click(screen.getByRole("button", { name: "Start chat" }));
  expect(mocks.createChatSession).toHaveBeenCalledWith({
    body: {
      request_id: "request",
      draft_id: "staged-draft",
      model_id: "other",
      persona_id: null,
      learning_mode: "standard",
      project_id: "project",
      user_prompt: "Hello",
      files: [],
    },
  });
});
it("sends the chosen learning mode with a new chat", async () => {
  mocks.createChatSession.mockClear();
  renderPage();
  const picker = await screen.findByRole("combobox", { name: "Learning mode" });
  await waitFor(() => expect(picker).toBeEnabled());
  await userEvent.click(picker);
  await userEvent.click(await screen.findByRole("option", { name: "Tutor" }));
  await userEvent.click(screen.getByRole("button", { name: "Start chat" }));
  expect(mocks.createChatSession).toHaveBeenCalledWith({
    body: expect.objectContaining({ learning_mode: "tutor" }),
  });
});
it("starts a course project chat in a mode its class policy allows", async () => {
  mocks.createChatSession.mockClear();
  mocks.coursePolicy.mockResolvedValueOnce({
    class_name: "Biology 101",
    educator_name: "Dr Teach",
    allowed_modes: ["tutor"],
    answer_reveal: false,
  });
  renderPage();
  expect(
    await screen.findByText(
      "Biology 101: Tutor mode only, answers can't be revealed. Set by Dr Teach.",
    ),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Start chat" }));
  expect(mocks.createChatSession).toHaveBeenCalledWith({
    body: expect.objectContaining({ learning_mode: "tutor" }),
  });
});
it("includes the project's learning goal only when the learner turns it on", async () => {
  mocks.createChatSession.mockClear();
  mocks.getProject.mockResolvedValueOnce({
    id: "project",
    name: "Research",
    description: "",
    goal: "Publish a reef survey",
    goal_target_date: null,
    areas: { study: true, reflections: true, goal: true, sub_agents: true },
  });
  renderPage();
  const toggle = await screen.findByRole("button", {
    name: "Include learning goal",
  });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Start chat" }));
  expect(mocks.createChatSession.mock.calls[0][0].body).not.toHaveProperty(
    "include_goal",
  );
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "Start chat" }));
  expect(mocks.createChatSession.mock.calls[1][0].body).toMatchObject({
    include_goal: true,
  });
});
it("retains an unavailable default without choosing a first-available replacement", async () => {
  mocks.user.settings.default_model_id = "unavailable";
  renderPage();
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Start chat" })).toBeDisabled();
  expect(screen.getByLabelText("Chat model")).not.toHaveValue("model");
  mocks.user.settings.default_model_id = "model";
});

it("blocks new-chat sends when the selected project is unavailable and recovers with retry", async () => {
  mocks.user.settings.default_model_id = "model";
  mocks.createChatSession.mockClear();
  mocks.getProject.mockRejectedValueOnce({ detail: "Project unavailable" });
  renderPage();
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Project unavailable"),
  );
  expect(screen.getByRole("button", { name: "Start chat" })).toBeDisabled();
  expect(mocks.createChatSession).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled(),
  );
  expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute(
    "href",
    "/projects/project",
  );
});

it("preselects the only available model when nothing is chosen", async () => {
  mocks.user.settings.default_model_id = undefined as unknown as string;
  mocks.models = [
    { id: "offline", available: false },
    { id: "only", available: true },
  ];
  mocks.createChatSession.mockClear();
  renderPage();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled(),
  );
  expect(screen.getByLabelText("Chat model")).toHaveValue("only");
  await userEvent.click(screen.getByRole("button", { name: "Start chat" }));
  expect(mocks.createChatSession).toHaveBeenCalledWith({
    body: expect.objectContaining({ model_id: "only" }),
  });
  mocks.models = [
    { id: "model", available: true },
    { id: "other", available: true },
  ];
  mocks.user.settings.default_model_id = "model";
});

it("suggests prompts from the project description and assigned skills and fills the composer without sending", async () => {
  mocks.createChatSession.mockClear();
  mocks.getProject.mockResolvedValueOnce({
    id: "project",
    name: "Research",
    description: "Survey reef health. Publish quarterly.",
    goal: "",
    goal_target_date: null,
    areas: { study: true, reflections: true, goal: true, sub_agents: true },
  });
  mocks.skills = [
    { id: "s1", name: "summarize", description: "Condense long sources" },
    { id: "s2", name: "cite", description: "Add citations" },
    { id: "s3", name: "translate", description: "Translate text" },
  ];
  renderPage();
  const list = await screen.findByRole("list", { name: "Suggested prompts" });
  await waitFor(() =>
    expect(within(list).getAllByRole("button")).toHaveLength(4),
  );
  expect(within(list).getByText("Survey reef health")).toBeVisible();
  expect(within(list).queryByText("Use /translate")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      within(list).getByRole("button", { name: /Use \/summarize/ }),
    ).toBeEnabled(),
  );
  await userEvent.click(
    within(list).getByRole("button", { name: /Use \/summarize/ }),
  );
  expect(mocks.fill).toHaveBeenCalledWith("/summarize ");
  await userEvent.click(
    within(list).getByRole("button", { name: /Plan the next step/ }),
  );
  expect(mocks.fill).toHaveBeenLastCalledWith(
    "Outline the next steps for the Research project. Its goal: Survey reef health.",
  );
  expect(mocks.createChatSession).not.toHaveBeenCalled();
});

it("offers skill suggestions without a project and shows the general context", async () => {
  mocks.search = "";
  mocks.getProject.mockClear();
  mocks.skills = [{ id: "s1", name: "cite", description: "Add citations" }];
  renderPage();
  expect(screen.getByText("New chat in General")).toBeVisible();
  expect(screen.queryByText("Main agent")).not.toBeInTheDocument();
  const list = await screen.findByRole("list", { name: "Suggested prompts" });
  expect(within(list).getAllByRole("button")).toHaveLength(1);
  expect(mocks.getProject).not.toHaveBeenCalled();
});

it("shows no suggestions without a project description or skills", async () => {
  mocks.search = "";
  renderPage();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled(),
  );
  expect(
    screen.queryByRole("list", { name: "Suggested prompts" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "What should we work on?" }),
  ).toBeVisible();
});
