import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { FolderPage } from "./folder-page";

const mocks = vi.hoisted(() => ({
  createChatSession: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({
    settings: {
      default_agent_id: "agent-1",
      agents: {
        "agent-1": {
          id: "agent-1",
          name: "Folder assistant",
          sub_agent: false,
        },
      },
    },
  }),
}));
vi.mock("@/features/chat/hooks/use-chat-session-crud", () => ({
  useChatSessionCrud: () => ({
    createChatSession: mocks.createChatSession,
    isCreating: false,
  }),
}));
vi.mock("@/features/chat/components/chat-input", () => ({
  default: ({
    onSubmit,
  }: {
    onSubmit: (value: { prompt: string; files: string[] }) => void;
  }) => (
    <button onClick={() => onSubmit({ prompt: "Hello folder", files: [] })}>
      Start folder chat
    </button>
  ),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  folderGetOneOptions: () => ({}),
  folderChatGetManyOptions: () => ({}),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));

beforeEach(() => {
  mocks.createChatSession.mockReset();
  mocks.useQuery.mockReset();
  mocks.useQuery
    .mockReturnValueOnce({ data: { title: "Research" } })
    .mockReturnValueOnce({
      data: {
        total: 1,
        chats: [
          {
            id: "chat-1",
            title: "Ocean notes",
            preview: "Ocean currents summary",
            message_count: 3,
            agent_id: "agent-1",
            updated_at: 1,
          },
        ],
      },
      isFetching: false,
    });
});

it("renders folder chat details and creates chats in the folder", async () => {
  render(<FolderPage folderId="folder-1" />);
  const user = userEvent.setup();

  expect(screen.getByRole("heading", { name: "Research" })).toBeInTheDocument();
  expect(screen.getByText("Ocean currents summary")).toBeInTheDocument();
  expect(screen.getByText(/3 messages.*Folder assistant/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /ocean notes/i })).toHaveAttribute(
    "href",
    "/c/chat-1",
  );

  await user.click(screen.getByRole("button", { name: "Start folder chat" }));
  expect(mocks.createChatSession).toHaveBeenCalledWith({
    body: {
      agent_id: "agent-1",
      folder_id: "folder-1",
      user_prompt: "Hello folder",
      files: [],
    },
  });
});

it("renders an empty folder state", () => {
  mocks.useQuery.mockReset();
  mocks.useQuery
    .mockReturnValueOnce({ data: { title: "Empty" } })
    .mockReturnValueOnce({ data: { total: 0, chats: [] }, isFetching: false });

  render(<FolderPage folderId="folder-1" />);

  expect(screen.getByText("No chats in this folder yet.")).toBeInTheDocument();
});
