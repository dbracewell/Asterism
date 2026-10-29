import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";
import UserProvider from "@/features/auth/components/user-context";
import type { User } from "@/features/auth/types";
import { AppHeader, headerRoute } from "./app-header";

const route = vi.hoisted(() => ({
  pathname: "/projects",
  search: "",
  mobile: true,
}));
const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  rename: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: mocks.push }),
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => route.mobile }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatSessionGetOneOptions: ({ path }: { path: { chat_id: string } }) => ({
    queryKey: ["chat", path.chat_id],
    queryFn: () => mocks.chat(path.chat_id),
  }),
  projectGetOneOptions: ({ path }: { path: { project_id: string } }) => ({
    queryKey: ["project", path.project_id],
    queryFn: async () => ({ id: path.project_id, name: "Research" }),
  }),
  projectGetManyOptions: () => ({
    queryKey: ["projects"],
    queryFn: async () => ({
      projects: [{ id: "p", name: "Research" }],
      total: 1,
      page: 1,
      page_size: 10,
    }),
  }),
  userPersonaListOptions: () => ({
    queryKey: [{ _id: "userPersonaList" }],
    queryFn: async () => ({
      profiles: [
        { id: "persona-default", name: "Everyday" },
        { id: "persona-writer", name: "Editor" },
      ],
      default_persona_id: "persona-default",
      default_revision: 1,
    }),
  }),
  chatSessionUpdateMutation: () => ({ mutationFn: mocks.rename }),
  chatSessionMoveMutation: () => ({ mutationFn: mocks.move }),
  chatSessionDeleteMutation: () => ({ mutationFn: mocks.remove }),
  chatSessionCreateMutation: () => ({ mutationFn: vi.fn() }),
  chatSessionGetManyQueryKey: () => ["chats"],
}));

const user = {
  id: "u",
  name: "Header tester",
  email: "header@example.test",
  role: "user",
  timezone: "UTC",
  settings: {},
} as unknown as User;

function chatInfo(overrides: object = {}) {
  return {
    info: {
      id: "c",
      user_id: "u",
      created_at: 0,
      updated_at: 0,
      title: "Quarterly plan",
      project_id: "p",
      persona_id: null,
      selected_model: {
        id: "m",
        name: "Opus",
        provider_id: "prov",
        provider_name: "Anthropic",
        available: true,
      },
      ...overrides,
    },
    messages: [],
  };
}

function createQueryClient() {
  const queryClient: QueryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: () => queryClient.invalidateQueries(),
    }),
    defaultOptions: { queries: { retry: false } },
  });
  return queryClient;
}

function Shell() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider user={user}>
        <SidebarProvider>
          <Sidebar>
            <Link href="/files">Files</Link>
          </Sidebar>
          <AppHeader />
        </SidebarProvider>
      </UserProvider>
    </QueryClientProvider>
  );
}

const crumbs = () =>
  within(screen.getByRole("navigation", { name: "breadcrumb" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);

beforeEach(() => {
  route.pathname = "/projects";
  route.search = "";
  route.mobile = true;
  mocks.chat.mockResolvedValue(chatInfo());
  mocks.rename.mockReset();
  mocks.move.mockReset();
});

describe("headerRoute", () => {
  it.each([
    ["/c/c", null, { kind: "chat", chatId: "c", file: false }],
    ["/c/c/files/f", null, { kind: "chat", chatId: "c", file: true }],
    ["/", null, { kind: "new-chat", projectId: null }],
    ["/", "p", { kind: "new-chat", projectId: "p" }],
    ["/projects/p", null, { kind: "project", projectId: "p", settings: false }],
    [
      "/projects/p/settings",
      null,
      { kind: "project", projectId: "p", settings: true },
    ],
    ["/general", null, { kind: "page", trail: [{ label: "General" }] }],
    [
      "/files/report%20v2.pdf",
      null,
      {
        kind: "page",
        trail: [{ label: "Files", href: "/files" }, { label: "report v2.pdf" }],
      },
    ],
    ["/unknown", null, { kind: "page", trail: [] }],
  ])("maps %s", (pathname, project, expected) => {
    expect(headerRoute(pathname, project)).toEqual(expected);
  });
});

describe("app header breadcrumbs", () => {
  it.each([
    ["/general", "", ["General"]],
    ["/projects", "", ["Projects"]],
    ["/search", "", ["Search"]],
    ["/settings", "", ["Settings"]],
    ["/", "", ["General", "New chat"]],
    ["/", "project_id=p", ["Research", "New chat"]],
    ["/projects/p", "", ["Projects", "Research"]],
    ["/projects/p/settings", "", ["Projects", "Research", "Settings"]],
  ])("shows %s?%s", async (pathname, search, expected) => {
    route.pathname = pathname;
    route.search = search;
    render(<Shell />);
    await waitFor(() => expect(crumbs()).toEqual(expected));
    expect(screen.getByRole("link", { current: "page" })).toHaveTextContent(
      expected.at(-1)!,
    );
  });

  it("shows the workspace, chat title, chips and actions for a chat", async () => {
    route.pathname = "/c/c";
    render(<Shell />);
    expect(
      await screen.findByRole("link", { name: "Research" }),
    ).toHaveAttribute("href", "/projects/p");
    expect(screen.getByRole("link", { current: "page" })).toHaveTextContent(
      "Quarterly plan",
    );
    const chips = screen.getByRole("list", { name: "Chat configuration" });
    expect(chips).toHaveTextContent("Model: Opus");
    expect(await within(chips).findByText("Everyday")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Chat actions" }),
    ).toBeInTheDocument();
  });

  it("links General chats and file views back to their parents", async () => {
    route.pathname = "/c/c/files/f";
    mocks.chat.mockResolvedValue(
      chatInfo({ project_id: null, persona_id: "persona-writer" }),
    );
    render(<Shell />);
    expect(
      await screen.findByRole("link", { name: "General" }),
    ).toHaveAttribute("href", "/general");
    expect(
      screen.getByRole("link", { name: "Quarterly plan" }),
    ).toHaveAttribute("href", "/c/c");
    expect(screen.getByRole("link", { current: "page" })).toHaveTextContent(
      "File",
    );
    expect(await screen.findByText("Editor")).toBeInTheDocument();
  });

  it("marks an unavailable model chip", async () => {
    route.pathname = "/c/c";
    mocks.chat.mockResolvedValue(
      chatInfo({
        selected_model: {
          id: "m",
          name: "Opus",
          provider_id: "prov",
          provider_name: "Anthropic",
          available: false,
          unavailable_reason: "Model disabled",
        },
      }),
    );
    render(<Shell />);
    const chip = (await screen.findByText("Opus")).closest("[data-slot=badge]");
    expect(chip).toHaveAttribute("data-variant", "destructive");
    expect(chip).toHaveAttribute("title", "Model disabled");
    expect(chip).toHaveTextContent("(unavailable)");
  });

  it("keeps ancestors out of the narrow layout but leaves the current page", async () => {
    route.pathname = "/c/c";
    render(<Shell />);
    const workspace = await screen.findByRole("link", { name: "Research" });
    expect(workspace.closest("li")).toHaveClass("hidden", "sm:inline-flex");
    expect(
      screen.getByRole("link", { current: "page" }).closest("li"),
    ).not.toHaveClass("hidden");
    expect(
      screen.getByRole("list", { name: "Chat configuration" }),
    ).toHaveClass("hidden", "md:flex");
  });

  it("orders keyboard focus from the sidebar toggle to the chat actions", async () => {
    route.pathname = "/c/c";
    render(<Shell />);
    await screen.findByRole("link", { name: "Research" });
    await userEvent.tab();
    expect(
      screen.getByRole("button", { name: "Toggle Sidebar" }),
    ).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("link", { name: "Research" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Chat actions" })).toHaveFocus();
  });
});

describe("header chat actions", () => {
  it("renames the chat", async () => {
    route.pathname = "/c/c";
    route.mobile = false;
    mocks.rename.mockResolvedValue({});
    render(<Shell />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Chat actions" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const title = screen.getByLabelText("Chat title");
    expect(title).toHaveValue("Quarterly plan");
    expect(screen.getByRole("button", { name: "Save title" })).toBeDisabled();
    await userEvent.clear(title);
    await userEvent.type(title, "  Q3 plan ");
    await userEvent.click(screen.getByRole("button", { name: "Save title" }));
    await waitFor(() =>
      expect(mocks.rename.mock.calls[0][0]).toEqual({
        path: { chat_id: "c" },
        body: { title: "Q3 plan" },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("explains history transfer, moves to General, and reports server rejection", async () => {
    route.pathname = "/c/c";
    route.mobile = false;
    mocks.move.mockRejectedValueOnce({ detail: "Run active" });
    render(<Shell />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Chat actions" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Move" }));
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
});

describe("mobile sidebar interactions", () => {
  it("toggles once when a touch is followed by the synthesized click", async () => {
    render(<Shell />);
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    fireEvent.touchEnd(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Sidebar" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });
  it("opens with the keyboard and closes after navigation", async () => {
    const view = render(<Shell />);
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Sidebar" })).toBeVisible();
    route.pathname = "/files";
    view.rerender(<Shell />);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
