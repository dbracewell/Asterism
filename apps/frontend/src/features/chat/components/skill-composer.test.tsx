import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatInput } from "./chat-input";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ActiveSkillState } from "@/lib/client";

const { eligible } = vi.hoisted(() => ({ eligible: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  skillEligibleGetManyOptions: ({ query }: { query: { query: string } }) => ({
    queryKey: [{ _id: "eligible", query }],
    queryFn: () => eligible(query.query),
  }),
}));
vi.mock("../hooks/use-attachment-draft", () => ({
  useAttachmentDraft: () => ({
    id: { current: undefined },
    verify: async () => {},
    consumed: () => {},
    discard: async () => {},
  }),
}));
vi.mock("./chat-file-context", () => ({ ChatFileContext: () => null }));
vi.mock("@/components/file-manager/library-file-picker", () => ({
  LibraryFilePickerDialog: () => null,
}));
vi.mock("./attach-menu", () => ({ AttachMenu: () => null }));
const items = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "review",
    description: "Review carefully",
    revision: 1,
    created_at: 1,
    updated_at: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "write",
    description: "Write clearly",
    revision: 2,
    created_at: 1,
    updated_at: 1,
  },
];
const state: ActiveSkillState = {
  revision: 3,
  skills: [
    {
      ...items[0],
      digest: "accepted",
      available: true,
      update_available: true,
    },
  ],
};
function setup(props: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const submit = vi.fn().mockResolvedValue(undefined);
  const element = (
    next: Partial<React.ComponentProps<typeof ChatInput>> = {},
  ) => (
    <QueryClientProvider client={cache}>
      <TooltipProvider>
        <ChatInput
          skillOwner="alice"
          skillScope="new:general"
          onSubmit={submit}
          {...props}
          {...next}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
  const view = render(element());
  return {
    ...view,
    submit,
    cache,
    rerenderProps: (next: Partial<React.ComponentProps<typeof ChatInput>>) =>
      view.rerender(element(next)),
  };
}
beforeEach(() => {
  sessionStorage.clear();
  eligible.mockReset();
  eligible.mockImplementation(async (query: string) => ({
    items: items.filter((s) => s.name.includes(query)),
    total: 2,
    page: 1,
    page_size: 100,
    policy_enabled: true,
    agent_revision: 1,
  }));
});

it("resolves ordered typed names, strips only leading commands, and sends skill-only messages", async () => {
  const { submit } = setup();
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("Message"),
    "/review /write /review Check /later",
  );
  await user.click(screen.getByLabelText("Send message"));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Check /later",
        skills: {
          expected_revision: 0,
          skill_ids: items.map((s) => s.id),
          refresh_ids: [],
        },
      }),
    ),
  );
  expect(screen.getByLabelText("Message")).toHaveValue("");
});
it("selects with keyboard, deduplicates and retains text through failure/reload", async () => {
  const submit = vi.fn().mockRejectedValue(new Error("Rejected by server"));
  const view = setup({ onSubmit: submit });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message"), "/");
  await screen.findByRole("option", { name: /review/ });
  await user.keyboard("{ArrowDown}{Enter}");
  await screen.findByLabelText("Remove write");
  expect(screen.getByLabelText("Message")).toHaveValue("");
  await user.click(screen.getByLabelText("Send message"));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "",
        skills: expect.objectContaining({ skill_ids: [items[1].id] }),
      }),
    ),
  );
  await screen.findByText("Rejected by server");
  await user.type(screen.getByLabelText("Message"), "Keep this");
  view.unmount();
  setup();
  await waitFor(() =>
    expect(screen.getByLabelText("Message")).toHaveValue("Keep this"),
  );
  expect(screen.getByLabelText("Remove write")).toBeVisible();
});
it("unknown commands and failed lookup require explicit literal opt-in", async () => {
  const { submit } = setup();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message"), "/unknown Keep draft");
  await user.click(screen.getByLabelText("Send message"));
  expect(submit).not.toHaveBeenCalled();
  await user.click(
    await screen.findByRole("button", { name: "Send as literal text" }),
  );
  await user.click(screen.getByLabelText("Send message"));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "/unknown Keep draft" }),
    ),
  );
  expect(submit.mock.calls[0][0]).not.toHaveProperty("skills");
});
it("stages refresh and explicit last-skill removal, without mutating accepted state", async () => {
  const { submit } = setup({ activeSkills: state });
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText("Refresh review"));
  await user.type(screen.getByLabelText("Message"), "Continue");
  await user.click(screen.getByLabelText("Send message"));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: {
          expected_revision: 3,
          skill_ids: [items[0].id],
          refresh_ids: [items[0].id],
        },
      }),
    ),
  );
  expect(state.skills).toHaveLength(1);
});
it("unavailable state permits explicit removal and blocks inherited execution", async () => {
  const { submit } = setup({
    activeSkills: {
      revision: 3,
      skills: [{ ...state.skills![0], available: false }],
    },
  });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message"), "Continue");
  await user.click(screen.getByLabelText("Send message"));
  await screen.findByText("Remove unavailable skills before sending.");
  expect(submit).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText("Remove review"));
  await user.click(screen.getByLabelText("Send message"));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: { expected_revision: 3, skill_ids: [], refresh_ids: [] },
      }),
    ),
  );
});
it("escape and IME/Shift+Enter retain normal entry without selecting or submitting", async () => {
  const { submit } = setup();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message"), "/");
  await screen.findByRole("option", { name: /review/ });
  fireEvent.keyDown(screen.getByLabelText("Message"), {
    key: "Enter",
    isComposing: true,
  });
  expect(submit).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByLabelText("Message"), {
    key: "Enter",
    shiftKey: true,
  });
  expect(submit).not.toHaveBeenCalled();
});
it("picker resolves preceding typed commands before the clicked skill", async () => {
  const { submit } = setup();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message"), "/review /wr");
  await user.click(await screen.findByRole("option", { name: /write/ }));
  await screen.findByLabelText("Remove review");
  await screen.findByLabelText("Remove write");
  await user.click(screen.getByLabelText("Send message"));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: expect.objectContaining({ skill_ids: items.map((s) => s.id) }),
      }),
    ),
  );
});

it("preserves pending drafts across branches and keeps them private to the owner", async () => {
  const view = setup();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message"), "/review");
  await user.click(await screen.findByRole("option", { name: /review/ }));
  await user.type(screen.getByLabelText("Message"), "Branch draft");
  view.rerenderProps({ skillScope: "other-branch" });
  await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(""));
  expect(screen.queryByLabelText("Remove review")).not.toBeInTheDocument();
  view.rerenderProps({ skillScope: "new:general" });
  await waitFor(() =>
    expect(screen.getByLabelText("Message")).toHaveValue("Branch draft"),
  );
  expect(screen.getByLabelText("Remove review")).toBeVisible();
  view.rerenderProps({ skillOwner: "bob" });
  await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(""));
  expect(screen.queryByLabelText("Remove review")).not.toBeInTheDocument();
});
it("stale accepted revisions preserve pending text until explicit reload", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const view = setup({ activeSkills: state });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message"), "Keep my text");
  await user.click(screen.getByLabelText("Remove review"));
  view.rerenderProps({ activeSkills: { ...state, revision: 4 } });
  await user.click(screen.getByLabelText("Send message"));
  expect(view.submit).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Reload current skills" }),
  );
  expect(confirm).toHaveBeenCalled();
  expect(screen.getByLabelText("Message")).toHaveValue("Keep my text");
  expect(screen.getByLabelText("Remove review")).toBeVisible();
  confirm.mockRestore();
});
it("lookup failures preserve the original text and never silently activate cached data", async () => {
  eligible.mockRejectedValue(new Error("Lookup failed"));
  const { submit } = setup();
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("Message"),
    "/review Keep files and text",
  );
  await user.click(screen.getByLabelText("Send message"));
  expect(submit).not.toHaveBeenCalled();
  await screen.findByRole("button", { name: "Send as literal text" });
  expect(screen.getByLabelText("Message")).toHaveValue(
    "/review Keep files and text",
  );
});
it("reorders selected skills and submits only ordered IDs", async () => {
  const second = { ...items[1], digest: "accepted", available: true };
  const { submit } = setup({
    activeSkills: { revision: 3, skills: [state.skills![0], second] },
  });
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText("Move write earlier"));
  await user.type(screen.getByLabelText("Message"), "Use this order");
  await user.click(screen.getByLabelText("Send message"));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: {
          expected_revision: 3,
          skill_ids: [items[1].id, items[0].id],
          refresh_ids: [],
        },
      }),
    ),
  );
});

it("explicit reactivation adopts an available new revision through refresh IDs", async () => {
  eligible.mockResolvedValue({
    items: [{ ...items[0], revision: 2 }],
    total: 1,
    page: 1,
    page_size: 100,
    policy_enabled: true,
    agent_revision: 1,
  });
  const { submit } = setup({ activeSkills: state });
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("Message"),
    "/review Refresh by command",
  );
  await user.click(screen.getByLabelText("Send message"));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Refresh by command",
        skills: {
          expected_revision: 3,
          skill_ids: [items[0].id],
          refresh_ids: [items[0].id],
        },
      }),
    ),
  );
});
