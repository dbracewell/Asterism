import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { studyToolLabel } from "@/features/chat/lib/agent-timeline";
import type { StudyProposal, ToolResult } from "@/lib/client";
import {
  StudyProposalCards,
  savedHref,
  studyProposalIds,
} from "./study-proposal-card";

// EPIC-98: the card for a deck or quiz the assistant drafted in a chat.
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  studyProposalGetOneOptions: (options: { path: { proposal_id: string } }) => ({
    queryKey: [{ _id: "studyProposalGetOne", path: options.path }],
    queryFn: () => mocks.get(options.path.proposal_id),
  }),
  studyProposalSaveMutation: () => ({ mutationFn: mocks.save }),
  studyProposalDismissMutation: () => ({ mutationFn: mocks.dismiss }),
}));

const ID = "11111111-1111-4111-8111-111111111111";
const DECK = {
  title: "Cells",
  description: "",
  cards: [
    { front: "Powerhouse of the cell?", back: "Mitochondria", file_ids: [] },
    { front: "Control centre?", back: "Nucleus", file_ids: [] },
  ],
};

function proposal(over: Partial<StudyProposal> = {}): StudyProposal {
  return {
    id: ID,
    project_id: "p1",
    chat_id: "c1",
    message_id: "m1",
    kind: "deck",
    status: "pending",
    deck: DECK,
    quiz: null,
    saved_id: null,
    created_at: 0,
    decided_at: null,
    ...over,
  };
}

function result(name: string, raw: unknown): ToolResult {
  return {
    tool_call: {
      id: "t1",
      type: "function",
      function: { name, arguments: "{}" },
    },
    content: JSON.stringify(raw),
    raw_result: raw,
  } as ToolResult;
}

function setup() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <StudyProposalCards
        results={[result("propose_deck", { proposal_id: ID })]}
      />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(proposal());
  mocks.save.mockResolvedValue(proposal({ status: "saved", saved_id: "d1" }));
  mocks.dismiss.mockResolvedValue(proposal({ status: "dismissed" }));
});

it("reads drafts only from the study tools' results", () => {
  expect(
    studyProposalIds([
      result("propose_deck", { proposal_id: ID }),
      result("propose_memory", {
        proposal_id: "22222222-2222-4222-8222-222222222222",
      }),
      result("propose_quiz", { error: "Study is off" }),
    ]),
  ).toEqual([ID]);
});

it("previews the draft and saves it as drafted", async () => {
  const user = setup();
  const card = await screen.findByRole("region", {
    name: "Draft flashcard deck: Cells",
  });
  expect(within(card).getByRole("list", { name: "Cards" })).toHaveTextContent(
    "Mitochondria",
  );
  expect(card).toHaveTextContent(
    "Nothing is added to Study until you save it.",
  );
  await user.click(within(card).getByRole("button", { name: "Save to Study" }));
  await waitFor(() =>
    expect(mocks.save.mock.calls[0]?.[0]).toEqual({
      path: { proposal_id: ID },
      body: { deck: DECK },
    }),
  );
});

it("saves an edited draft with a card removed", async () => {
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Edit" }));
  const title = screen.getByLabelText("Title");
  await user.clear(title);
  await user.type(title, "Cell parts");
  await user.click(screen.getByRole("button", { name: "Remove card 2" }));
  await user.click(screen.getByRole("button", { name: "Save to Study" }));
  await waitFor(() =>
    expect(mocks.save.mock.calls[0]?.[0].body).toEqual({
      deck: { ...DECK, title: "Cell parts", cards: [DECK.cards[0]] },
    }),
  );
});

it("dismisses, and shows a saved draft with a link to it", async () => {
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(mocks.dismiss).toHaveBeenCalled());

  expect(savedHref(proposal({ status: "saved", saved_id: "d1" }))).toBe(
    "/projects/p1/study/d1",
  );
  expect(
    savedHref(proposal({ kind: "quiz", status: "saved", saved_id: "q1" })),
  ).toBe("/projects/p1/study/quizzes/q1");
});

it("labels the tools in the agent timeline", () => {
  expect(studyToolLabel("propose_deck", "succeeded")).toBe(
    "Drafted a flashcard deck",
  );
  expect(studyToolLabel("propose_quiz", "failed")).toBe(
    "Couldn't draft a practice quiz",
  );
  expect(studyToolLabel("web_search", "succeeded")).toBeUndefined();
});
