import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import { ReflectDialog } from "./reflect-dialog";

const mocks = vi.hoisted(() => ({
  draft: vi.fn(),
  create: vi.fn(),
  closed: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  reflectionDraftCreateMutation: () => ({ mutationFn: mocks.draft }),
  reflectionCreateMutation: () => ({ mutationFn: mocks.create }),
  reflectionGetManyQueryKey: () => [{ _id: "reflectionGetMany" }],
}));

let cache: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  vi.mocked(toast.success).mockReset();
  mocks.draft.mockResolvedValue({
    learned: "I learned osmosis.",
    unclear: "Tonicity terms",
  });
  mocks.create.mockResolvedValue({ id: "r1" });
  cache = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_d, _v, _c, mutation) =>
        handleMutationSuccess(cache, mutation),
    }),
  });
});

function open(projectId: string | null = "p") {
  render(
    <ReflectDialog
      chatId="chat"
      projectId={projectId}
      open
      onOpenChange={mocks.closed}
    />,
    { wrapper: Wrapper },
  );
  return screen.getByRole("dialog", { name: "Reflect on this session" });
}

it("saves the learner's answers to the two prompts", async () => {
  const user = userEvent.setup();
  const dialog = open();
  const save = within(dialog).getByRole("button", { name: "Save reflection" });
  expect(
    within(dialog).getByRole("button", { name: "Help: Reflection" }),
  ).toBeInTheDocument();
  expect(save).toBeDisabled();
  await user.type(
    within(dialog).getByLabelText("What's still unclear?"),
    "Why cells burst",
  );
  await user.click(save);
  await waitFor(() => expect(mocks.create).toHaveBeenCalled());
  expect(mocks.create.mock.calls[0][0]).toEqual({
    body: { chat_id: "chat", learned: "", unclear: "Why cells burst" },
  });
  await waitFor(() => expect(mocks.closed).toHaveBeenCalledWith(false));
});

it("fills an editable suggestion, confirming before replacing typed text", async () => {
  const user = userEvent.setup();
  const dialog = open();
  await user.click(
    within(dialog).getByRole("button", { name: "Suggest a draft" }),
  );
  const learned = within(dialog).getByLabelText("What did I learn?");
  await waitFor(() => expect(learned).toHaveValue("I learned osmosis."));
  expect(mocks.draft.mock.calls[0][0]).toEqual({ body: { chat_id: "chat" } });
  expect(dialog).toHaveTextContent("Suggested from this chat. Edit it");
  await user.type(learned, " Also diffusion.");
  await user.click(
    within(dialog).getByRole("button", { name: "Suggest a draft" }),
  );
  const confirm = await screen.findByRole("alertdialog", {
    name: "Replace what you wrote?",
  });
  await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(mocks.draft).toHaveBeenCalledTimes(1);
  expect(learned).toHaveValue("I learned osmosis. Also diffusion.");
});

it("explains when no model can suggest a draft", async () => {
  mocks.draft.mockRejectedValueOnce({
    detail: "Suggestions need a draft model or a connected ChatGPT plan",
  });
  const user = userEvent.setup();
  const dialog = open();
  await user.click(
    within(dialog).getByRole("button", { name: "Suggest a draft" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Suggestions need a draft model",
  );
});

it.each([
  [
    "p",
    "It's in this project's Reflections tab.",
    "/projects/p?tab=reflections",
  ],
  [null, "It's on the General page, under Reflections.", "/general"],
])(
  "says where a reflection in %s was kept, with a link there",
  async (projectId, description, href) => {
    const user = userEvent.setup();
    const dialog = open(projectId);
    await user.type(
      within(dialog).getByLabelText("What did I learn?"),
      "Osmosis",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save reflection" }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [title, options] = vi.mocked(toast.success).mock.calls[0];
    expect(title).toBe("Reflection saved");
    expect(options?.description).toBe(description);
    const action = options?.action as { label: string; onClick: () => void };
    expect(action.label).toBe("View reflections");
    action.onClick();
    expect(mocks.push).toHaveBeenCalledWith(href);
  },
);
