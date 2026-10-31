import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatInput } from "./chat-input";

const { status, review } = vi.hoisted(() => ({
  status: { current: { enabled: true, available: true } },
  review: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  skillEligibleGetManyOptions: () => ({
    queryKey: [{ _id: "eligible" }],
    queryFn: async () => ({
      items: [],
      total: 0,
      page: 1,
      page_size: 100,
      policy_enabled: true,
      agent_revision: 1,
    }),
  }),
  promptFrameworkGetManyOptions: () => ({
    queryKey: [{ _id: "promptFrameworkGetMany" }],
    queryFn: async () => ({ version: 1, items: [] }),
  }),
  promptTemplateGetManyOptions: () => ({
    queryKey: [{ _id: "promptTemplateGetMany" }],
    queryFn: async () => ({ items: [], total: 0, page: 1, page_size: 100 }),
  }),
  promptTemplateGetOneOptions: () => ({
    queryKey: [{ _id: "promptTemplateGetOne" }],
    queryFn: async () => null,
  }),
  promptCoachStatusGetOptions: () => ({
    queryKey: [{ _id: "promptCoachStatusGet" }],
    queryFn: async () => status.current,
  }),
  promptCoachReviewMutation: () => ({
    mutationFn: (options: { body: unknown }) => review(options.body),
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

const MODEL = "00000000-0000-4000-8000-000000000001";
const SUGGESTIONS = {
  suggestions: [
    {
      id: "goal",
      criterion: "goal",
      message: "Say exactly what you want.",
      find: "about dogs",
      text: "a care guide for a new puppy",
    },
    {
      id: "audience",
      criterion: "audience",
      message: "Say who it is for.",
      find: null,
      text: "The audience is first-time owners.",
    },
  ],
};

beforeEach(() => {
  sessionStorage.clear();
  status.current = { enabled: true, available: true };
  review.mockReset();
  review.mockResolvedValue(SUGGESTIONS);
});

function setup(coach = true) {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TooltipProvider>
        <ChatInput
          skillOwner="alice"
          skillScope="new:general"
          promptCoach={coach ? { modelId: MODEL } : undefined}
          onSubmit={submit}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { submit, input: screen.getByLabelText("Message") };
}

it("is absent unless the owner turned the coach on", () => {
  setup(false);
  expect(
    screen.queryByRole("button", { name: "Review prompt" }),
  ).not.toBeInTheDocument();
});

it("reviews the draft and applies suggestions without sending", async () => {
  const user = userEvent.setup();
  const { input, submit } = setup();
  const button = await screen.findByRole("button", { name: "Review prompt" });
  expect(button).toBeDisabled();
  await user.type(input, "Write about dogs.");
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);

  expect(review).toHaveBeenCalledWith({
    prompt: "Write about dogs.",
    model_id: MODEL,
  });
  const panel = await screen.findByRole("region", { name: "Prompt review" });
  const items = within(panel).getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("GoalSay exactly what you want.");
  expect(items[1]).toHaveTextContent("Add The audience is first-time owners.");

  await user.click(
    within(panel).getByRole("button", { name: "Apply goal suggestion" }),
  );
  expect(input).toHaveValue("Write a care guide for a new puppy.");
  expect(within(items[0]).getByText("Applied")).toBeInTheDocument();
  await user.click(
    within(panel).getByRole("button", { name: "Apply audience suggestion" }),
  );
  expect(input).toHaveValue(
    "Write a care guide for a new puppy.\n\nThe audience is first-time owners.",
  );
  expect(input).toHaveFocus();
  expect(submit).not.toHaveBeenCalled();

  // Sending is a separate, explicit action and clears the ephemeral review.
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(submit.mock.calls[0][0].prompt).toBe(
    "Write a care guide for a new puppy.\n\nThe audience is first-time owners.",
  );
  expect(
    screen.queryByRole("region", { name: "Prompt review" }),
  ).not.toBeInTheDocument();
  expect(review).toHaveBeenCalledTimes(1);
});

it("disables a rewrite once its text is edited away, and can be dismissed", async () => {
  const user = userEvent.setup();
  const { input } = setup();
  await user.type(input, "Write about dogs.");
  await user.click(
    await screen.findByRole("button", { name: "Review prompt" }),
  );
  const panel = await screen.findByRole("region", { name: "Prompt review" });
  await user.clear(input);
  await user.type(input, "Write about cats.");
  expect(
    within(panel).getByRole("button", { name: "Apply goal suggestion" }),
  ).toBeDisabled();
  await user.click(
    within(panel).getByRole("button", { name: "Dismiss prompt review" }),
  );
  expect(
    screen.queryByRole("region", { name: "Prompt review" }),
  ).not.toBeInTheDocument();
  expect(input).toHaveValue("Write about cats.");
});

it("shows that the coach is unavailable without a usable model", async () => {
  status.current = { enabled: true, available: false };
  const user = userEvent.setup();
  const { input } = setup();
  await user.type(input, "Write about dogs.");
  const button = screen.getByRole("button", { name: "Review prompt" });
  await waitFor(() =>
    expect(button).toHaveAccessibleDescription(
      "Prompt review needs a draft model or a connected ChatGPT plan",
    ),
  );
  expect(button).toBeDisabled();
  expect(review).not.toHaveBeenCalled();
});

it("reports a failed review and retries the reviewed draft", async () => {
  review.mockRejectedValueOnce({
    detail: "The prompt coach could not review this prompt; try again",
  });
  const user = userEvent.setup();
  const { input } = setup();
  await user.type(input, "Write about dogs.");
  await user.click(
    await screen.findByRole("button", { name: "Review prompt" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not review this prompt",
  );
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findAllByRole("listitem")).toHaveLength(2);
  expect(review).toHaveBeenCalledTimes(2);
});

it("shows a clear message when nothing needs to change", async () => {
  review.mockResolvedValue({ suggestions: [] });
  const user = userEvent.setup();
  const { input } = setup();
  await user.type(input, "Write about dogs.");
  await user.click(
    await screen.findByRole("button", { name: "Review prompt" }),
  );
  expect(await screen.findByText(/Nothing to add/)).toBeInTheDocument();
});
