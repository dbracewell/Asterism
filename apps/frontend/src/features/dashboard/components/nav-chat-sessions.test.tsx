import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { NavChatSessions } from "./nav-chat-sessions";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  event: undefined as undefined | (() => Promise<void>),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/features/sse/hooks/use-subscribe-event", () => ({
  useSubscribeEvent: ({ handler }: { handler: () => Promise<void> }) => {
    mocks.event = handler;
  },
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatSessionGetManyQueryKey: () => ["chats"],
  chatSessionGetManyOptions: ({ query }: { query: { page: number } }) => ({
    queryKey: ["chats", query],
    queryFn: () => mocks.list(query),
  }),
  chatSessionBulkDeleteMutation: () => ({ mutationFn: vi.fn() }),
}));
vi.mock("@/components/confirmation-dialog", () => ({
  useConfirmationDialog: () => ({ confirm: vi.fn(), Dialog: () => null }),
}));
vi.mock("./chat-session-action-menu", () => ({
  ChatSessionActionMenu: () => null,
}));
vi.mock("./collapsible-sidebar-group", () => ({
  CollapsibleSidebarGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

beforeEach(() => {
  mocks.list.mockReset();
  mocks.event = undefined;
});

it("keeps older chats reachable and refreshes paged membership after title events", async () => {
  mocks.list.mockImplementation(({ page }) =>
    Promise.resolve({
      chats: [
        {
          id: `chat-${page}`,
          title: page === 1 ? "Recent chat" : "Older chat",
        },
      ],
      total: 51,
      page,
      page_size: 50,
    }),
  );
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <NavChatSessions defaultIsOpen />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByRole("link", { name: "Recent chat" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous chats" })).toBeDisabled();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Next chats" }));
  expect(
    await screen.findByRole("link", { name: "Older chat" }),
  ).toBeInTheDocument();
  expect(mocks.list).toHaveBeenCalledWith({ page: 2, page_size: 50 });
  expect(screen.getByRole("button", { name: "Next chats" })).toBeDisabled();
  mocks.list.mockResolvedValue({
    chats: [],
    total: 50,
    page: 2,
    page_size: 50,
  });
  await act(async () => {
    await mocks.event?.();
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "Older chat" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "Previous chats" })).toBeEnabled();
});
