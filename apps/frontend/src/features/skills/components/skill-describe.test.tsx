import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SkillEditorDialog } from "./skill-editor-dialog";

type SocketProps = {
  chatId: string | null;
  onStatusChange?: (busy: boolean) => void;
  onStreamStart?: (message: object) => void;
  onStreamUpdate?: (message: object) => void;
  onStreamComplete?: (messages: object[]) => void;
  onStreamError?: (error: string) => void;
  onSubAgentEvent?: (packet: object) => void;
};

const mocks = vi.hoisted(() => ({
  socket: null as SocketProps | null,
  sendJson: vi.fn(),
  policy: true,
  draft: vi.fn(),
  startDraft: vi.fn(),
  send: vi.fn(),
  removeChat: vi.fn(),
  createSkill: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { token: async () => ({ data: { token: "jwt" } }) },
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: "a", settings: {} }),
}));
vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => ({ currentThemeType: "light", fontSize: "16px" }),
}));
vi.mock("@/features/help/components/help-topic", () => ({
  HelpTopic: () => null,
}));
vi.mock("@/features/chat/hooks/use-chat-websocket", () => ({
  useChatWebSocket: (props: SocketProps) => {
    mocks.socket = props;
    return {
      sendJsonMessage: mocks.sendJson,
      readyState: props.chatId ? 1 : 3,
      toolTimings: {},
    };
  },
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => {
  const key = (_id: string, options?: object) => [{ _id, ...options }];
  return {
    skillGetOneOptions: ({ path }: { path: object }) => ({
      queryKey: key("skillGetOne", { path }),
      queryFn: vi.fn(),
    }),
    skillEligibleGetManyOptions: () => ({
      queryKey: key("skillEligibleGetMany"),
      queryFn: async () => ({
        items: [],
        total: 0,
        page: 1,
        page_size: 1,
        policy_enabled: mocks.policy,
        agent_revision: 1,
      }),
    }),
    skillDraftGetOneOptions: ({ path }: { path: object }) => ({
      queryKey: key("skillDraftGetOne", { path }),
      queryFn: () => mocks.draft(path),
    }),
    chatModelsListOptions: () => ({
      queryKey: key("chatModelsList"),
      queryFn: async () => [
        {
          id: "m1",
          name: "Writer",
          provider_name: "Local",
          available: true,
          supports_tools: true,
        },
      ],
    }),
    skillGetManyQueryKey: () => key("skillGetMany"),
    skillGetOneQueryKey: (options: object) => key("skillGetOne", options),
    skillEligibleGetManyQueryKey: () => key("skillEligibleGetMany"),
    mainAgentSkillsGetQueryKey: () => key("mainAgentSkillsGet"),
    mainAgentGetQueryKey: () => key("mainAgentGet"),
    skillCreateMutation: () => ({ mutationFn: mocks.createSkill }),
    skillUpdateMutation: () => ({ mutationFn: vi.fn() }),
    skillDeleteMutation: () => ({ mutationFn: vi.fn() }),
    skillDraftCreateMutation: () => ({ mutationFn: mocks.startDraft }),
    chatMessageSendMutation: () => ({ mutationFn: mocks.send }),
    chatSessionDeleteMutation: () => ({ mutationFn: mocks.removeChat }),
  };
});

const doc = (name: string, body = "# Steps\nComment on the thesis.") =>
  `---\nname: ${name}\ndescription: Essay feedback.\n---\n\n${body}\n`;
const ready = (id: string, content: string) => ({
  chat_id: "c1",
  status: "ready",
  message_id: id,
  content,
  name: "essay-feedback",
  description: "Essay feedback.",
});

function setup() {
  const onClose = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SkillEditorDialog
          owner="a"
          skillId={null}
          onClose={onClose}
          restoreFocus={() => {}}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { onClose, user: userEvent.setup() };
}

/** Fills the form and starts a run; the socket then resumes the turn. */
async function describe(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "Describe it" }));
  await user.type(
    await screen.findByLabelText("What should the skill do?"),
    "Feedback on essays",
  );
  await user.type(screen.getByLabelText("Examples (optional)"), "An essay");
  const write = screen.getByRole("button", { name: "Write draft" });
  await waitFor(() => expect(write).toBeEnabled());
  await user.click(write);
  await waitFor(() =>
    expect(mocks.sendJson).toHaveBeenCalledWith({ type: "resume" }),
  );
}

const finish = () =>
  act(() => {
    mocks.socket?.onStreamComplete?.([]);
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.policy = true;
  mocks.socket = null;
  mocks.startDraft.mockResolvedValue({
    info: { id: "c1", model_revision: 3 },
    messages: [],
  });
  mocks.send.mockResolvedValue({ id: "u2" });
  mocks.removeChat.mockResolvedValue(undefined);
  mocks.createSkill.mockResolvedValue({ id: "s1" });
});

it("streams the writer and its sub-agents, then opens the draft for review", async () => {
  const { user, onClose } = setup();
  await describe(user);
  expect(mocks.startDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        model_id: "m1",
        description: "Feedback on essays",
        examples: "An essay",
      }),
    }),
    expect.anything(),
  );
  expect(mocks.socket?.chatId).toBe("c1");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Your agent is writing the draft…",
  );

  act(() => {
    mocks.socket?.onStreamStart?.({ content: "" });
    mocks.socket?.onStreamUpdate?.({ content: "Researching essay rubrics" });
    mocks.socket?.onSubAgentEvent?.({
      type: "sub_agent",
      execution_id: "e1",
      sub_agent_id: "r",
      sub_agent_name: "Researcher",
      depth: 1,
      event: { type: "start" },
    });
  });
  expect(
    screen.getByRole("region", { name: "Writer output" }),
  ).toHaveTextContent("Researching essay rubrics");
  expect(screen.getByTestId("sub-agent-e1")).toHaveTextContent("Researcher");

  mocks.draft.mockResolvedValue(ready("m1", doc("essay-feedback")));
  finish();
  // The ready draft opens in the editor with its preview.
  expect(await screen.findByRole("heading", { name: "Steps" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Write it" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // The user's edits travel with a change request.
  await user.click(screen.getByRole("tab", { name: "Source" }));
  const edited = doc("essay-feedback", "# Steps\nMy own step.");
  const source = screen.getByLabelText("SKILL.md source");
  await user.clear(source);
  await user.click(source);
  await user.paste(edited);
  await user.type(screen.getByLabelText("Ask for changes"), "Shorter");
  await user.click(screen.getByRole("button", { name: "Send changes" }));
  const body = mocks.send.mock.calls[0][0].body;
  expect(body).toMatchObject({
    parent_message_id: "m1",
    expected_model_revision: 3,
  });
  expect(body.user_prompt).toContain("I edited the draft");
  expect(body.user_prompt).toContain("My own step.");
  expect(body.user_prompt.endsWith("Shorter")).toBe(true);
  expect(screen.getByRole("tab", { name: "Describe it" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const revised = doc("essay-feedback", "# Steps\nShort.");
  mocks.draft.mockResolvedValue(ready("m2", revised));
  finish();
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "Write it" })).toHaveAttribute(
      "aria-selected",
      "true",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Save skill" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(mocks.createSkill.mock.calls[0][0]).toEqual({
    body: { content: revised },
  });
  // Saving deletes the hidden drafting chat.
  expect(mocks.removeChat.mock.calls[0][0]).toEqual({
    path: { chat_id: "c1" },
  });
});

it("asks the writer to fix an invalid draft, or lets the user fix it", async () => {
  const { user } = setup();
  await describe(user);
  const bad = doc("Essay Feedback");
  mocks.draft.mockResolvedValue({
    chat_id: "c1",
    status: "invalid",
    message_id: "m1",
    content: bad,
    error: "Skill name must be lowercase",
  });
  finish();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Skill name must be lowercase",
  );
  await user.click(
    screen.getByRole("button", { name: "Ask the writer to fix it" }),
  );
  expect(mocks.send.mock.calls[0][0].body.user_prompt).toContain(
    "didn't pass validation: Skill name must be lowercase",
  );
  finish();
  await user.click(
    await screen.findByRole("button", { name: "Fix it myself" }),
  );
  expect(screen.getByLabelText("SKILL.md source")).toHaveValue(bad);
});

it("stops a run and discards the draft after confirmation", async () => {
  const { user, onClose } = setup();
  await describe(user);
  await user.click(screen.getByRole("button", { name: "Stop writing" }));
  expect(mocks.sendJson).toHaveBeenCalledWith({ type: "cancel" });
  mocks.draft.mockResolvedValue({ chat_id: "c1", status: "none" });
  finish();
  expect(
    await screen.findByText("The writer stopped before writing a draft."),
  ).toBeVisible();

  await user.click(screen.getByRole("tab", { name: "Write it" }));
  await user.click(screen.getByRole("button", { name: "Discard draft" }));
  const confirm = await screen.findByRole("alertdialog");
  await user.click(
    within(confirm).getByRole("button", { name: "Discard draft" }),
  );
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(mocks.removeChat.mock.calls[0][0]).toEqual({
    path: { chat_id: "c1" },
  });
  expect(mocks.createSkill).not.toHaveBeenCalled();
});

it("explains when skills are turned off", async () => {
  mocks.policy = false;
  const { user } = setup();
  await user.click(screen.getByRole("tab", { name: "Describe it" }));
  expect(
    await screen.findByText("Describing a skill is turned off"),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Write draft" })).toBeNull();
});
