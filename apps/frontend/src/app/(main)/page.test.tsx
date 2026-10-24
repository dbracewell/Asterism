import { defaultPersonas } from "@/test/personas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import AppPage from "./page";
const mocks = vi.hoisted(() => ({
  models: [
    { id: "model", available: true },
    { id: "other", available: true },
  ],
  createChatSession: vi.fn(),
  getProject: vi.fn(async () => ({ id: "project", name: "Research" })),
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
  projectGetOneOptions: () => ({
    queryKey: ["project"],
    queryFn: mocks.getProject,
  }),
  userPersonaListOptions: () => ({
    queryKey: ["personas"],
    queryFn: async () => defaultPersonas,
  }),
  chatModelsListOptions: () => ({
    queryKey: ["models"],
    queryFn: async () => mocks.models,
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
  useSearchParams: () => new URLSearchParams("project_id=project"),
}));
vi.mock("@/components/logo", () => ({ default: () => null }));
vi.mock("@/features/chat/components/chat-input", () => ({
  ChatInput: ({
    onSubmit,
    disabled,
    modelSelector,
  }: {
    onSubmit: (value: unknown) => void;
    disabled: boolean;
    modelSelector: React.ReactNode;
  }) => (
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
  ),
  ChatInputContainer: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AppPage />
    </QueryClientProvider>,
  );
}
it("prefills only the explicit default, permits a different model, and sends it independently of the main configuration", async () => {
  renderPage();
  expect(screen.getByText("Main agent")).toBeVisible();
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
      project_id: "project",
      user_prompt: "Hello",
      files: [],
    },
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
