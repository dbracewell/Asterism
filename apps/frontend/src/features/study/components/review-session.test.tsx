import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ReviewSession } from "./review-session";

const NOW = 1_900_000_000;
const mocks = vi.hoisted(() => ({
  deck: vi.fn(),
  queue: vi.fn(),
  review: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("sonner", () => ({
  toast: { info: mocks.toastInfo, error: mocks.toastError },
}));
vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  studyDeckGetOneOptions: () => ({
    queryKey: ["deck"],
    queryFn: () => mocks.deck(),
  }),
  studyReviewQueueGetOptions: () => ({
    queryKey: ["queue"],
    queryFn: () => mocks.queue(),
  }),
  studyCardReviewMutation: () => ({ mutationFn: mocks.review }),
  studyDeckGetOneQueryKey: () => ["deck"],
  studyDeckGetManyQueryKey: () => ["decks"],
  studyProjectSummaryGetQueryKey: () => ["summary"],
  studyCardGetManyQueryKey: () => ["cards"],
}));

function card(id: string, overrides: object = {}) {
  return {
    id,
    deck_id: "d",
    front: `Front ${id}`,
    back: `Back ${id}`,
    citations: [],
    state: "learning",
    due_at: NOW - 10,
    reps: 0,
    lapses: 0,
    created_at: 0,
    updated_at: 0,
    previews: {
      again: NOW + 60,
      hard: NOW + 330,
      good: NOW + 600,
      easy: NOW + 8 * 86400,
    },
    ...overrides,
  };
}

function setup() {
  const queryClient = new QueryClient({
    mutationCache: new MutationCache({}),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReviewSession projectId="p" deckId="d" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  mocks.deck.mockResolvedValue({ id: "d", name: "Biology", due_count: 2 });
  mocks.queue.mockResolvedValue({
    items: [card("a"), card("b")],
    due_count: 2,
    now: NOW,
  });
});

it("reviews with the keyboard alone and moves focus with the flow", async () => {
  mocks.review.mockImplementation(async ({ path }) =>
    card(path.card_id, { reps: 1, state: "review", due_at: NOW + 2 * 86400 }),
  );
  setup();
  const show = await screen.findByRole("button", { name: "Show answer" });
  await waitFor(() => expect(show).toHaveFocus());
  expect(screen.getByText("Front a")).toBeInTheDocument();
  expect(screen.queryByText("Back a")).not.toBeInTheDocument();
  // Ratings do nothing until the answer is shown.
  await userEvent.keyboard("3");
  expect(mocks.review).not.toHaveBeenCalled();

  // Space activates the focused Show answer button.
  await userEvent.keyboard(" ");
  expect(screen.getByText("Back a")).toBeInTheDocument();
  const good = screen.getByRole("button", { name: /^Good/ });
  expect(good).toHaveFocus();
  expect(good).toHaveAttribute("aria-keyshortcuts", "3");
  expect(good).toHaveAccessibleName(
    /^Good ?10m · key 3 ?, next review in 10 minutes$/,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Answer shown.");

  await userEvent.keyboard("4");
  await waitFor(() =>
    expect(mocks.review).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { project_id: "p", deck_id: "d", card_id: "a" },
        body: { rating: "easy", expected_reps: 0 },
      }),
      expect.anything(),
    ),
  );
  expect(await screen.findByText("Front b")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show answer" })).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Rated easy. Next review in 2 days.",
  );

  // Enter also reveals when focus is not on a button.
  (document.activeElement as HTMLElement).blur();
  await userEvent.keyboard("{Enter}");
  expect(screen.getByText("Back b")).toBeInTheDocument();
  await userEvent.keyboard("1");
  const summary = await screen.findByRole("region", { name: "Review summary" });
  expect(summary).toHaveFocus();
  expect(summary).toHaveTextContent("Session complete");
  expect(summary).toHaveTextContent("You reviewed 2 cards.");
  expect(screen.getByRole("status")).toHaveTextContent("Session complete.");
});

it("brings cards in a short learning step back in the same session", async () => {
  mocks.queue.mockResolvedValue({ items: [card("a")], due_count: 1, now: NOW });
  mocks.review
    .mockResolvedValueOnce(card("a", { reps: 1, due_at: NOW + 60 }))
    .mockResolvedValueOnce(
      card("a", { reps: 2, state: "review", due_at: NOW + 86400 }),
    );
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Show answer" }),
  );
  await userEvent.keyboard("1");
  expect(
    await screen.findByRole("button", { name: "Show answer" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Front a")).toBeInTheDocument();
  await userEvent.keyboard(" ");
  await userEvent.keyboard("3");
  await waitFor(() => expect(mocks.review).toHaveBeenCalledTimes(2));
  expect(mocks.review.mock.calls[1][0].body).toEqual({
    rating: "good",
    expected_reps: 1,
  });
  expect(await screen.findByText("Session complete")).toBeInTheDocument();
});

it("ignores held keys and modified keys", async () => {
  mocks.review.mockResolvedValue(card("a", { reps: 1, due_at: NOW + 86400 }));
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Show answer" }),
  );
  await userEvent.keyboard("{Control>}3{/Control}");
  await userEvent.keyboard("{3>3/}");
  await waitFor(() => expect(mocks.review).toHaveBeenCalledTimes(1));
});

it("skips a card someone already reviewed", async () => {
  mocks.review.mockRejectedValueOnce({ code: 409, detail: "already reviewed" });
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Show answer" }),
  );
  await userEvent.keyboard("3");
  expect(await screen.findByText("Front b")).toBeInTheDocument();
  expect(mocks.toastInfo).toHaveBeenCalled();
});

it("keeps the card on other errors so the rating can be retried", async () => {
  mocks.review.mockRejectedValueOnce({ detail: "Offline" });
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Show answer" }),
  );
  await userEvent.keyboard("3");
  await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Offline"));
  expect(screen.getByText("Back a")).toBeInTheDocument();
});

it("explains when nothing is due and offers more when the queue was capped", async () => {
  mocks.queue.mockResolvedValueOnce({ items: [], due_count: 0, now: NOW });
  const { unmount } = setup();
  expect(await screen.findByText("No cards are due")).toBeInTheDocument();
  unmount();

  mocks.queue.mockResolvedValue({
    items: [card("a")],
    due_count: 150,
    now: NOW,
  });
  mocks.review.mockResolvedValue(card("a", { reps: 1, due_at: NOW + 86400 }));
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Show answer" }),
  );
  await userEvent.keyboard("3");
  await userEvent.click(
    await screen.findByRole("button", { name: "Review more due cards" }),
  );
  await waitFor(() => expect(mocks.queue).toHaveBeenCalledTimes(3));
  // The new session starts from the reloaded queue.
  expect(
    await screen.findByRole("button", { name: "Show answer" }),
  ).toBeInTheDocument();
});
