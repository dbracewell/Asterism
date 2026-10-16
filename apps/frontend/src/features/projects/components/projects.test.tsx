import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectList } from "./project-list";
import { ProjectWorkspace } from "./project-workspace";
import { ChatWorkspace } from "./chat-workspace";
import { WorkspaceChats } from "./workspace-chats";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  move: vi.fn(),
  chats: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  projectGetManyOptions: ({ query }: { query: object }) => ({
    queryKey: ["projects", query],
    queryFn: () => mocks.list(query),
  }),
  projectGetOneOptions: ({ path }: { path: object }) => ({
    queryKey: ["project", path],
    queryFn: () => mocks.get(path),
  }),
  projectCreateMutation: () => ({ mutationFn: mocks.create }),
  projectUpdateMutation: () => ({ mutationFn: mocks.update }),
  projectDeleteMutation: () => ({ mutationFn: mocks.remove }),
  chatSessionMoveMutation: () => ({ mutationFn: mocks.move }),
  chatSessionGetManyOptions: ({ query }: { query: object }) => ({
    queryKey: ["chats", query],
    queryFn: () => mocks.chats(query),
  }),
}));
const project = {
  id: "p",
  name: "Research",
  description: "Work together",
  system_prompt: "Original",
  context_revision: 3,
  created_at: 0,
  updated_at: 0,
};
function setup(element: React.ReactNode) {
  const queryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: () => {
        queryClient.invalidateQueries();
      },
    }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
    ),
    queryClient,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({
    projects: [project],
    total: 1,
    page: 1,
    page_size: 20,
  });
  mocks.get.mockResolvedValue(project);
  mocks.chats.mockResolvedValue({ chats: [], total: 0 });
});
it("shows loading, retry, empty, and searchable paginated project results", async () => {
  mocks.list.mockRejectedValueOnce({ detail: "Offline" });
  setup(<ProjectList />);
  expect(screen.getByLabelText("Loading projects")).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("link", { name: "Research" })).toHaveAttribute(
    "href",
    "/projects/p",
  );
  mocks.list.mockResolvedValue({ projects: [], total: 0 });
  await userEvent.type(screen.getByLabelText("Search projects"), "missing");
  expect(await screen.findByText("No matching projects")).toBeInTheDocument();
  expect(mocks.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ query: "missing", page: 1 }),
  );
});
it("requests the next project page and resets pagination on search", async () => {
  mocks.list.mockResolvedValue({ projects: [project], total: 21 });
  setup(<ProjectList />);
  await screen.findByText("Research");
  await userEvent.click(screen.getByRole("button", { name: "Next projects" }));
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    ),
  );
  await userEvent.type(screen.getByLabelText("Search projects"), "work");
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, query: "work" }),
    ),
  );
});
it("retains cached project results when refresh fails", async () => {
  const { queryClient } = setup(<ProjectList />);
  await screen.findByText("Research");
  mocks.list.mockRejectedValue({ detail: "Offline" });
  await queryClient.invalidateQueries();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Showing saved results",
  );
  expect(screen.getByRole("link", { name: "Research" })).toBeInTheDocument();
});
it("creates a project with separate instructions and navigates to its overview", async () => {
  mocks.create.mockResolvedValue(project);
  setup(<ProjectList />);
  await userEvent.click(screen.getByRole("button", { name: "New project" }));
  await userEvent.type(screen.getByLabelText("Name"), "  Research  ");
  await userEvent.type(screen.getByLabelText("Description"), "Work together");
  await userEvent.type(
    screen.getByLabelText("Project instructions"),
    "Keep citations",
  );
  await userEvent.click(screen.getByRole("button", { name: "Create project" }));
  await waitFor(() =>
    expect(mocks.create).toHaveBeenCalledWith(
      {
        body: {
          name: "Research",
          description: "Work together",
          system_prompt: "Keep citations",
        },
      },
      expect.anything(),
    ),
  );
  expect(mocks.push).toHaveBeenCalledWith("/projects/p");
});
it("scopes General and project chats in the backend query and new-chat link", async () => {
  const view = setup(<WorkspaceChats projectId={null} />);
  await screen.findByText("No chats yet");
  expect(mocks.chats).toHaveBeenCalledWith(
    expect.objectContaining({ project_id: null }),
  );
  expect(screen.getByRole("link", { name: "New chat" })).toHaveAttribute(
    "href",
    "/",
  );
  view.unmount();
  setup(<WorkspaceChats projectId="p" />);
  await screen.findByText("No chats yet");
  expect(mocks.chats).toHaveBeenLastCalledWith(
    expect.objectContaining({ project_id: "p" }),
  );
  expect(screen.getByRole("link", { name: "New chat" })).toHaveAttribute(
    "href",
    "/?project_id=p",
  );
});
it("keeps the editing revision across refresh, then explicitly reloads after conflict", async () => {
  mocks.update.mockRejectedValueOnce({ detail: "Revision conflict" });
  const { queryClient } = setup(<ProjectWorkspace projectId="p" settings />);
  const instructions = await screen.findByLabelText("Project instructions");
  await userEvent.clear(instructions);
  await userEvent.type(instructions, "My draft");
  mocks.get.mockResolvedValue({
    ...project,
    context_revision: 4,
    system_prompt: "Other editor",
  });
  await queryClient.invalidateQueries();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled(),
  );
  expect(instructions).toHaveValue("My draft");
  await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Revision conflict",
  );
  expect(mocks.update.mock.calls[0][0].body).toEqual(
    expect.objectContaining({
      system_prompt: "My draft",
      expected_context_revision: 3,
    }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Reload current settings" }),
  );
  await waitFor(() => expect(instructions).toHaveValue("Other editor"));
  mocks.update.mockResolvedValue({
    ...project,
    context_revision: 5,
    system_prompt: "Final",
  });
  await userEvent.clear(instructions);
  await userEvent.type(instructions, "Final");
  await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(await screen.findByRole("status")).toHaveTextContent("settings saved");
  expect(mocks.update.mock.calls[1][0].body.expected_context_revision).toBe(4);
});
it("explains detachment, supports cancel, and deletes only after confirmation", async () => {
  mocks.remove.mockResolvedValue(project);
  setup(<ProjectWorkspace projectId="p" settings />);
  await screen.findByLabelText("Name");
  await userEvent.click(screen.getByRole("button", { name: "Delete project" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "Chats will move to General with their history and local attachments",
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.remove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Delete project" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(mocks.remove.mock.calls[0][0]).toEqual({
      path: { project_id: "p" },
      query: { expected_context_revision: 3 },
    }),
  );
  expect(mocks.push).toHaveBeenCalledWith("/general");
});
it("explains history transfer, moves to General, and reports server rejection", async () => {
  mocks.move.mockRejectedValueOnce({ detail: "Run active" });
  setup(
    <ChatWorkspace
      info={{
        id: "c",
        project_id: "p",
        user_id: "a",
        created_at: 0,
        updated_at: 0,
      }}
      disabled={false}
    />,
  );
  expect(await screen.findByRole("link", { name: "Research" })).toHaveAttribute(
    "href",
    "/projects/p",
  );
  await userEvent.click(screen.getByRole("button", { name: "Move chat" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "full history and local attachments",
  );
  await userEvent.click(screen.getByLabelText("Destination workspace"));
  await userEvent.click(screen.getByRole("option", { name: /^General$/ }));
  await userEvent.click(
    screen.getByRole("button", { name: "Move to workspace" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Run active");
  expect(mocks.move.mock.calls[0][0]).toEqual({
    path: { chat_id: "c" },
    body: { project_id: null },
  });
  mocks.move.mockResolvedValue({});
  await userEvent.click(
    screen.getByRole("button", { name: "Move to workspace" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
it("disables moving during an active generation", async () => {
  setup(
    <ChatWorkspace
      info={{
        id: "c",
        project_id: null,
        user_id: "a",
        created_at: 0,
        updated_at: 0,
      }}
      disabled
    />,
  );
  expect(screen.getByRole("button", { name: "Move chat" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "General" })).toHaveAttribute(
    "href",
    "/general",
  );
});
