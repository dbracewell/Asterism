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
import { WorkspaceChats } from "./workspace-chats";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  chats: vi.fn(),
  push: vi.fn(),
  search: "",
  selectedAgents: 0,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/projects/p",
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
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
  projectSubAgentGetManyOptions: () => ({
    queryKey: ["selected-agents"],
    queryFn: async () => ({
      agents: [],
      total: mocks.selectedAgents,
      page: 1,
      page_size: 10,
      context_revision: 3,
    }),
  }),
  projectSubAgentCandidatesOptions: () => ({
    queryKey: ["candidate-agents"],
    queryFn: async () => ({
      agents: [],
      total: 0,
      page: 1,
      page_size: 10,
      context_revision: 3,
    }),
  }),
  chatModelsListOptions: () => ({
    queryKey: ["agent-models"],
    queryFn: async () => [],
  }),
  projectSubAgentSelectManyMutation: () => ({ mutationFn: vi.fn() }),
  projectSubAgentDeselectManyMutation: () => ({ mutationFn: vi.fn() }),
  projectCreateMutation: () => ({ mutationFn: mocks.create }),
  projectUpdateMutation: () => ({ mutationFn: mocks.update }),
  projectDeleteMutation: () => ({ mutationFn: mocks.remove }),
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
  accent: "teal" as const,
  goal: "",
  goal_target_date: null,
  areas: { study: true, reflections: true, goal: true, sub_agents: true },
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
  mocks.search = "";
  mocks.selectedAgents = 0;
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
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
  await userEvent.click(
    screen.getByRole("combobox", { name: "Sidebar color" }),
  );
  await userEvent.click(await screen.findByRole("option", { name: "Violet" }));
  await userEvent.click(screen.getByRole("button", { name: "Create project" }));
  await waitFor(() =>
    expect(mocks.create).toHaveBeenCalledWith(
      {
        body: {
          name: "Research",
          description: "Work together",
          system_prompt: "Keep citations",
          accent: "violet",
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
it("opens the tab named in the URL and pushes tab changes into the history", async () => {
  mocks.search = "tab=chats&keep=1";
  setup(<ProjectWorkspace projectId="p" />);
  const chats = await screen.findByRole("tab", { name: "Chats" });
  expect(chats).toHaveAttribute("aria-selected", "true");
  expect(
    screen.getByRole("tablist", { name: "Project sections" }),
  ).toBeVisible();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "Overview",
    "Chats",
    "Files",
    "Study",
    "Reflections",
    "Sub-agents",
    "Settings",
  ]);
  await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
  expect(window.history.pushState).toHaveBeenLastCalledWith(
    null,
    "",
    "/projects/p?tab=settings&keep=1",
  );
  await userEvent.click(screen.getByRole("tab", { name: "Overview" }));
  expect(window.history.pushState).toHaveBeenLastCalledWith(
    null,
    "",
    "/projects/p?keep=1",
  );
});
it("falls back to Overview, which shows the latest chats and links to all", async () => {
  mocks.search = "tab=unknown";
  mocks.chats.mockResolvedValue({
    chats: [{ id: "c1", title: "Latest" }],
    total: 9,
  });
  setup(<ProjectWorkspace projectId="p" />);
  expect(await screen.findByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    await screen.findByRole("heading", { name: "Recent chats" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Latest" })).toHaveAttribute(
    "href",
    "/c/c1",
  );
  expect(mocks.chats).toHaveBeenCalledWith(
    expect.objectContaining({ project_id: "p", page: 1, page_size: 5 }),
  );
  expect(
    screen.queryByRole("button", { name: "Next chats" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "All 9 chats" }));
  expect(window.history.pushState).toHaveBeenLastCalledWith(
    null,
    "",
    "/projects/p?tab=chats",
  );
});
it("hides the tabs and Overview goal of areas that are off", async () => {
  mocks.search = "tab=study";
  mocks.get.mockResolvedValue({
    ...project,
    goal: "Pass the exam",
    areas: { study: false, reflections: false, goal: false, sub_agents: true },
  });
  setup(<ProjectWorkspace projectId="p" />);
  // A link to a hidden tab opens Overview.
  expect(await screen.findByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "Overview",
    "Chats",
    "Files",
    "Sub-agents",
    "Settings",
  ]);
  await screen.findByRole("heading", { name: "Recent chats" });
  expect(screen.queryByText("Pass the exam")).not.toBeInTheDocument();
});
it("saves feature areas from Settings and says selected sub-agents stay in use", async () => {
  mocks.search = "tab=settings";
  mocks.selectedAgents = 2;
  mocks.update.mockImplementation(async ({ body }) => {
    const updated = { ...project, areas: body.areas };
    mocks.get.mockResolvedValue(updated);
    return updated;
  });
  setup(<ProjectWorkspace projectId="p" />);
  const goal = await screen.findByRole("switch", { name: "Goal" });
  expect(goal).toBeChecked();
  expect(screen.getByLabelText("Learning goal")).toBeVisible();
  expect(
    await screen.findByText(/2 sub-agents are selected\. Hiding this tab/),
  ).toBeVisible();
  await userEvent.click(goal);
  // A hidden goal keeps its text but is no longer edited here.
  expect(screen.queryByLabelText("Learning goal")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("switch", { name: "Sub-agents" }));
  await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(await screen.findByRole("status")).toHaveTextContent("settings saved");
  expect(mocks.update.mock.calls[0][0].body).toEqual(
    expect.objectContaining({
      goal: "",
      areas: { study: true, reflections: true, goal: false, sub_agents: false },
      expected_context_revision: 3,
    }),
  );
  await waitFor(() =>
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Chats",
      "Files",
      "Study",
      "Reflections",
      "Settings",
    ]),
  );
});
it("keeps unsaved settings when switching away and back", async () => {
  mocks.search = "tab=settings";
  const view = setup(<ProjectWorkspace projectId="p" />);
  const instructions = await screen.findByLabelText("Project instructions");
  await userEvent.clear(instructions);
  await userEvent.type(instructions, "Unsaved");
  mocks.search = "tab=overview";
  view.rerender(
    <QueryClientProvider client={view.queryClient}>
      <ProjectWorkspace projectId="p" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(instructions).not.toBeVisible());
  mocks.search = "tab=settings";
  view.rerender(
    <QueryClientProvider client={view.queryClient}>
      <ProjectWorkspace projectId="p" />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText("Project instructions")).toHaveValue("Unsaved");
});
it("keeps the editing revision across refresh, then explicitly reloads after conflict", async () => {
  mocks.search = "tab=settings";
  mocks.update.mockRejectedValueOnce({ detail: "Revision conflict" });
  const { queryClient } = setup(<ProjectWorkspace projectId="p" />);
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
it("clears a project's sidebar color with an explicit null", async () => {
  mocks.search = "tab=settings";
  mocks.update.mockResolvedValue({ ...project, accent: null });
  setup(<ProjectWorkspace projectId="p" />);
  const color = await screen.findByRole("combobox", { name: "Sidebar color" });
  expect(color).toHaveTextContent("Teal");
  await userEvent.click(color);
  await userEvent.click(
    await screen.findByRole("option", { name: "No color" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() =>
    expect(mocks.update.mock.calls[0][0].body).toEqual(
      expect.objectContaining({ accent: null, expected_context_revision: 3 }),
    ),
  );
});
it("explains detachment, supports cancel, and deletes only after confirmation", async () => {
  mocks.search = "tab=settings";
  mocks.remove.mockResolvedValue(project);
  setup(<ProjectWorkspace projectId="p" />);
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
