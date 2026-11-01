import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectStudyDecks } from "./project-study-decks";
import { StudyDeckPage } from "./study-deck-page";

const mocks = vi.hoisted(() => ({
  decks: vi.fn(),
  deck: vi.fn(),
  cards: vi.fn(),
  createDeck: vi.fn(),
  updateDeck: vi.fn(),
  deleteDeck: vi.fn(),
  createCard: vi.fn(),
  updateCard: vi.fn(),
  deleteCard: vi.fn(),
  push: vi.fn(),
  summary: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/api", () => ({ client: {} }));
// Card text is untrusted; it must reach the screen only through MarkdownViewer.
vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  studyDeckGetManyOptions: ({ query }: { query: object }) => ({
    queryKey: ["decks", query],
    queryFn: () => mocks.decks(query),
  }),
  studyProjectSummaryGetOptions: () => ({
    queryKey: ["summary"],
    queryFn: () => mocks.summary(),
  }),
  studyDeckGetOneOptions: ({ path }: { path: object }) => ({
    queryKey: ["deck", path],
    queryFn: () => mocks.deck(path),
  }),
  studyCardGetManyOptions: ({ query }: { query: object }) => ({
    queryKey: ["cards", query],
    queryFn: () => mocks.cards(query),
  }),
  studyDeckCreateMutation: () => ({ mutationFn: mocks.createDeck }),
  studyDeckUpdateMutation: () => ({ mutationFn: mocks.updateDeck }),
  studyDeckDeleteMutation: () => ({ mutationFn: mocks.deleteDeck }),
  studyCardCreateMutation: () => ({ mutationFn: mocks.createCard }),
  studyCardUpdateMutation: () => ({ mutationFn: mocks.updateCard }),
  studyCardDeleteMutation: () => ({ mutationFn: mocks.deleteCard }),
}));

const deck = {
  id: "d",
  project_id: "p",
  name: "Biology",
  description: "",
  card_count: 1,
  due_count: 0,
  created_at: 0,
  updated_at: 0,
};
const card = {
  id: "c",
  deck_id: "d",
  front: "What is **ATP**?",
  back: "Energy currency",
  citations: [
    {
      file_id: "f1",
      chunk_id: "k",
      artifact_generation: 1,
      excerpt: "ATP stores energy",
      available: true,
      file_name: "lecture.pdf",
    },
    {
      file_id: "f2",
      chunk_id: null,
      artifact_generation: null,
      excerpt: null,
      available: false,
      file_name: null,
    },
  ],
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
  return render(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decks.mockResolvedValue({
    items: [deck],
    total: 1,
    page: 1,
    page_size: 20,
  });
  mocks.deck.mockResolvedValue(deck);
  mocks.summary.mockResolvedValue({
    deck_count: 1,
    card_count: 1,
    due_count: 0,
  });
  mocks.cards.mockResolvedValue({
    items: [card],
    total: 1,
    page: 1,
    page_size: 25,
  });
});

it("creates the first deck from the empty state and opens it", async () => {
  mocks.decks.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
  });
  mocks.createDeck.mockResolvedValue({ ...deck, id: "new" });
  setup(<ProjectStudyDecks projectId="p" />);
  expect(await screen.findByText("No decks yet")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "New deck" }));
  const dialog = await screen.findByRole("dialog");
  const submit = within(dialog).getByRole("button", { name: "Create deck" });
  expect(submit).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText("Name"), "  Biology  ");
  await userEvent.click(submit);
  await waitFor(() =>
    expect(mocks.createDeck).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { project_id: "p" },
        body: { name: "Biology", description: "" },
      }),
      expect.anything(),
    ),
  );
  expect(mocks.push).toHaveBeenCalledWith("/projects/p/study/new");
});

it("lists decks with card counts and links", async () => {
  mocks.decks.mockResolvedValue({
    items: [deck, { ...deck, id: "e", name: "Chemistry", card_count: 3 }],
    total: 2,
    page: 1,
    page_size: 20,
  });
  setup(<ProjectStudyDecks projectId="p" />);
  expect(await screen.findByRole("link", { name: "Biology" })).toHaveAttribute(
    "href",
    "/projects/p/study/d",
  );
  expect(screen.getByText("1 card")).toBeInTheDocument();
  expect(screen.getByText("3 cards")).toBeInTheDocument();
});

it("renders cards through MarkdownViewer with live citation state", async () => {
  setup(<StudyDeckPage projectId="p" deckId="d" />);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Biology" }),
  ).toBeInTheDocument();
  const rendered = await screen.findAllByTestId("markdown");
  expect(rendered.map((node) => node.textContent)).toEqual([
    "What is **ATP**?",
    "Energy currency",
  ]);
  expect(screen.getByText("lecture.pdf")).toHaveAttribute(
    "title",
    "ATP stores energy",
  );
  expect(
    screen.getByText("Source no longer in this project"),
  ).toBeInTheDocument();
});

it("edits a card without sending citations", async () => {
  mocks.updateCard.mockResolvedValue(card);
  setup(<StudyDeckPage projectId="p" deckId="d" />);
  await userEvent.click(
    await screen.findByRole("button", { name: /^Edit card:/ }),
  );
  const dialog = await screen.findByRole("dialog");
  const back = within(dialog).getByLabelText("Back");
  expect(back).toHaveValue("Energy currency");
  await userEvent.clear(back);
  await userEvent.type(back, "Adenosine triphosphate");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Save card" }),
  );
  await waitFor(() =>
    expect(mocks.updateCard).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { project_id: "p", deck_id: "d", card_id: "c" },
        body: { front: "What is **ATP**?", back: "Adenosine triphosphate" },
      }),
      expect.anything(),
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("adds a card and shows server errors", async () => {
  mocks.createCard.mockRejectedValueOnce({
    detail: "Citations must reference files in this project",
  });
  setup(<StudyDeckPage projectId="p" deckId="d" />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Add card" }),
  );
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Front"), "Q");
  await userEvent.type(within(dialog).getByLabelText("Back"), "A");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Add card" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Citations must reference files in this project",
  );
});

it("confirms before deleting a card or the deck", async () => {
  mocks.deleteCard.mockResolvedValue(undefined);
  mocks.deleteDeck.mockResolvedValue(undefined);
  setup(<StudyDeckPage projectId="p" deckId="d" />);
  await userEvent.click(
    await screen.findByRole("button", { name: /^Delete card:/ }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Delete card" }),
  );
  await waitFor(() =>
    expect(mocks.deleteCard).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { project_id: "p", deck_id: "d", card_id: "c" },
      }),
      expect.anything(),
    ),
  );

  await userEvent.click(screen.getByRole("button", { name: "Delete deck" }));
  const confirm = await screen.findByRole("alertdialog");
  await userEvent.click(
    within(confirm).getByRole("button", { name: "Delete deck" }),
  );
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/projects/p"));
  expect(mocks.deleteDeck).toHaveBeenCalledWith(
    expect.objectContaining({ path: { project_id: "p", deck_id: "d" } }),
    expect.anything(),
  );
});

it("shows a load error for a missing or foreign deck", async () => {
  mocks.deck.mockRejectedValue({ detail: "Deck not found" });
  setup(<StudyDeckPage projectId="p" deckId="missing" />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load this deck.",
  );
  expect(mocks.cards).not.toHaveBeenCalled();
});

it("shows due counts and review links", async () => {
  mocks.summary.mockResolvedValue({
    deck_count: 2,
    card_count: 4,
    due_count: 3,
  });
  mocks.decks.mockResolvedValue({
    items: [
      { ...deck, card_count: 3, due_count: 3 },
      { ...deck, id: "e", name: "Chemistry", card_count: 1, due_count: 0 },
    ],
    total: 2,
    page: 1,
    page_size: 20,
  });
  setup(<ProjectStudyDecks projectId="p" />);
  expect(await screen.findByText("3 cards due for review")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Review Biology, 3 cards due" }),
  ).toHaveAttribute("href", "/projects/p/study/d/review");
  expect(screen.getAllByRole("link", { name: /^Review / })).toHaveLength(1);

  mocks.deck.mockResolvedValue({ ...deck, due_count: 2 });
  setup(<StudyDeckPage projectId="p" deckId="d" />);
  expect(
    await screen.findByRole("link", { name: "Review (2 due)" }),
  ).toHaveAttribute("href", "/projects/p/study/d/review");
});
