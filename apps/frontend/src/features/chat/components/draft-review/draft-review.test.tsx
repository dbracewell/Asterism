import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import type { DraftReview } from "@/lib/client";
import { DraftReviewButton } from "./draft-review";

const mocks = vi.hoisted(() => ({ review: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => {
  const key = (_id: string, options?: object) => [{ _id, ...options }];
  return {
    chatDraftReviewGetOneOptions: ({ path }: { path: object }) => ({
      queryKey: key("chatDraftReviewGetOne", { path }),
      queryFn: () => mocks.review(path),
    }),
    chatDraftReviewGetOneQueryKey: (options: object) =>
      key("chatDraftReviewGetOne", options),
    chatSessionGetOneQueryKey: (options: object) =>
      key("chatSessionGetOne", options),
    chatDraftReviewCommentUpdateMutation: () => ({ mutationFn: mocks.update }),
  };
});

const text = "Uniforms should be required. A study said bullying drops.";
const review: DraftReview = {
  documents: [
    {
      id: "message",
      kind: "message",
      name: "Your message",
      available: true,
      text,
    },
    {
      id: "f1",
      kind: "file",
      name: "photo.png",
      available: false,
      reason: "Comments can't be shown on images.",
    },
  ],
  comments: [
    {
      id: "c1",
      criterion: "Thesis",
      level: "Developing",
      quote: "Uniforms should be required.",
      note: "Clear but broad.",
      resolved: false,
      anchor: { document_id: "message", start: 0, end: 28 },
    },
    {
      id: "c2",
      criterion: "Evidence",
      level: "Beginning",
      quote: "A study said",
      note: "Name the study.",
      resolved: true,
      anchor: { document_id: "message", start: 29, end: 41 },
    },
    {
      id: "c3",
      criterion: "Evidence",
      level: "Beginning",
      quote: "Uniforms cure everything.",
      note: "Not in the draft.",
      resolved: false,
      anchor: null,
    },
  ],
};

let cache: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.review.mockResolvedValue(review);
  mocks.update.mockResolvedValue({ total: 3, resolved: 2 });
  cache = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_d, _v, _c, mutation) =>
        handleMutationSuccess(cache, mutation),
    }),
    defaultOptions: { queries: { retry: false } },
  });
});

async function open() {
  const user = userEvent.setup();
  render(
    <DraftReviewButton
      chatId="chat"
      messageId="reply"
      summary={{ total: 3, resolved: 1 }}
    />,
    { wrapper: Wrapper },
  );
  const button = screen.getByRole("button", {
    name: /Review draft with comments/,
  });
  expect(button).toHaveTextContent("· 3 comments, 1 resolved");
  await user.click(button);
  const dialog = await screen.findByRole("dialog", {
    name: "Your draft with comments",
  });
  await within(dialog).findByRole("region", { name: "Your draft" });
  return { user, dialog };
}

it("pins comments to their passages and lists unplaced ones separately", async () => {
  const { dialog } = await open();
  expect(mocks.review).toHaveBeenCalledWith({
    chat_id: "chat",
    message_id: "reply",
  });
  const draft = within(dialog).getByRole("region", { name: "Your draft" });
  const marks = draft.querySelectorAll("mark");
  expect([...marks].map((mark) => mark.textContent)).toEqual([
    "Uniforms should be required.",
    "A study said",
  ]);
  expect(marks[1]).toHaveClass("bg-muted");
  expect(
    within(draft).getByText("Comments can't be shown on images."),
  ).toBeVisible();
  const unplaced = within(dialog).getByRole("region", {
    name: "Not found in your draft",
  });
  expect(unplaced).toHaveTextContent("Uniforms cure everything.");
  expect(unplaced).toHaveTextContent("Not in the draft.");
});

it("links comments and passages in both directions", async () => {
  const { user, dialog } = await open();
  const draft = within(dialog).getByRole("region", { name: "Your draft" });
  const comment = within(dialog).getByRole("button", { name: /^Thesis/ });
  await user.click(comment);
  expect(comment).toHaveAttribute("aria-pressed", "true");
  expect(draft.querySelector("mark[data-selected]")).toHaveTextContent(
    "Uniforms should be required.",
  );
  await user.click(within(draft).getByText("A study said"));
  expect(
    within(dialog).getByRole("button", { name: /^Evidence.*A study said/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(comment).toHaveAttribute("aria-pressed", "false");
});

it("marks a comment resolved and refreshes the review", async () => {
  const { user, dialog } = await open();
  const item = within(dialog)
    .getByRole("button", { name: /^Thesis/ })
    .closest("li")!;
  await user.click(within(item).getByRole("checkbox", { name: "Resolved" }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalled());
  expect(mocks.update.mock.calls[0][0]).toEqual({
    path: { chat_id: "chat", message_id: "reply", comment_id: "c1" },
    body: { resolved: true },
  });
  await waitFor(() => expect(mocks.review).toHaveBeenCalledTimes(2));
});
