import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type {
  StudyProgress,
  StudyTopicMastery,
  StudyWeakSpot,
} from "@/lib/client";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import { ProjectProgress } from "./project-progress";
import { quizDescription } from "./quiz-page";

const mocks = vi.hoisted(() => ({
  progress: vi.fn(),
  practice: vi.fn(),
  decks: vi.fn(),
  create: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => <span>{content}</span>,
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  studyProgressGetOptions: () => ({
    queryKey: [{ _id: "studyProgressGet" }],
    queryFn: () => mocks.progress(),
  }),
  studyPracticeCreateMutation: () => ({ mutationFn: mocks.practice }),
  studyDeckGetManyOptions: () => ({
    queryKey: [{ _id: "studyDeckGetMany" }],
    queryFn: () => mocks.decks(),
  }),
  studyUnclearCardCreateMutation: () => ({ mutationFn: mocks.create }),
}));

const spot = (overrides: Partial<StudyWeakSpot>): StudyWeakSpot => ({
  root_kind: "question",
  root_id: "r1",
  source_kind: "question",
  source_id: "r1",
  kind: "multiple_choice",
  prompt: "Powerhouse?",
  outcome: "incorrect",
  missed_at: 1,
  container_id: "q1",
  container_title: "Cells quiz",
  citations: [],
  topics: [],
  ...overrides,
});

const topic = (overrides: Partial<StudyTopicMastery>): StudyTopicMastery => ({
  key: "cells",
  label: "Cells",
  level: "developing",
  score: 0.7,
  practiced: 4,
  total: 6,
  deck_count: 1,
  quiz_count: 1,
  trend: [
    { at: 1, score: null },
    { at: 2, score: 0.4 },
    { at: 3, score: 0.7 },
  ],
  ...overrides,
});

const progress = (overrides: Partial<StudyProgress>): StudyProgress => ({
  topics: [],
  weak_spots: { items: [], total: 0 },
  unclear: { items: [], total: 0 },
  computed_at: 3,
  ...overrides,
});

const unclear = (text: string) => ({
  reflection_id: "ref1",
  chat_id: "c1",
  reflected_at: 1,
  text,
});

let cache: QueryClient;
beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.decks.mockResolvedValue({
    items: [
      { id: "d1", name: "Biology" },
      { id: "d2", name: "Unclear items" },
    ],
    total: 2,
    page: 1,
    page_size: 100,
  });
  cache = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_d, _v, _c, mutation) =>
        handleMutationSuccess(cache, mutation),
    }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

function setup() {
  render(
    <QueryClientProvider client={cache}>
      <ProjectProgress projectId="p" />
    </QueryClientProvider>,
  );
  return screen.findByRole("region", { name: "Progress" });
}

it("shows an empty state for each part before any practice", async () => {
  mocks.progress.mockResolvedValue(progress({}));
  const panel = await setup();
  expect(await within(panel).findByText(/No topics yet/)).toBeInTheDocument();
  expect(within(panel).getByText(/No practice yet/)).toBeInTheDocument();
  expect(within(panel).getByText(/No unclear items/)).toBeInTheDocument();
  expect(
    within(panel).getByRole("button", { name: "Practice weak spots" }),
  ).toBeDisabled();
  expect(within(panel).queryByLabelText("Topic")).toBeNull();
});

it("says nothing is weak once topics were practiced", async () => {
  mocks.progress.mockResolvedValue(progress({ topics: [topic({})] }));
  const panel = await setup();
  expect(
    await within(panel).findByText("Nothing needs practice right now."),
  ).toBeInTheDocument();
});

it("shows each topic's level, score, coverage and trend", async () => {
  mocks.progress.mockResolvedValue(
    progress({
      topics: [
        topic({}),
        topic({
          key: "energy",
          label: "Energy",
          level: "not_started",
          score: null,
          practiced: 0,
          total: 2,
          trend: [{ at: 1, score: null }],
        }),
      ],
    }),
  );
  await setup();
  const cells = await screen.findByRole("listitem", { name: "Cells" });
  expect(cells).toHaveTextContent("Developing");
  expect(cells).toHaveTextContent("70% · 4 of 6 practiced");
  expect(cells).toHaveTextContent("Up from 40% to 70% over the last 3 weeks.");
  const energy = screen.getByRole("listitem", { name: "Energy" });
  expect(energy).toHaveTextContent("Not started");
  expect(energy).toHaveTextContent("0 of 2 practiced");
  expect(energy).not.toHaveTextContent("%");
  expect(
    screen.getByRole("button", { name: "Help: Topic mastery" }),
  ).toBeInTheDocument();
});

it("lists items that need practice with links to their quiz or deck", async () => {
  mocks.progress.mockResolvedValue(
    progress({
      weak_spots: {
        items: [
          spot({}),
          spot({
            root_kind: "card",
            root_id: "c1",
            source_kind: "card",
            source_id: "c1",
            kind: "card",
            prompt: "What is ATP?",
            outcome: "again",
            container_id: "d1",
            container_title: "Biology deck",
          }),
          spot({ root_id: "r2", outcome: "partial", prompt: "Explain DNA" }),
          spot({ root_id: "r3", outcome: "unclear", prompt: "Tonicity" }),
          spot({ root_id: "r4", prompt: "Four" }),
          spot({ root_id: "r5", prompt: "Five" }),
        ],
        total: 60,
      },
    }),
  );
  const user = userEvent.setup();
  await setup();
  const section = await screen.findByRole("region", {
    name: "Needs practice",
  });
  expect(within(section).getByText("60 items")).toBeInTheDocument();
  expect(within(section).getAllByText("Missed")).toHaveLength(2);
  expect(within(section).getByText("Rated Again")).toBeInTheDocument();
  expect(within(section).getByText("Partly correct")).toBeInTheDocument();
  expect(within(section).getByText("Flagged as unclear")).toBeInTheDocument();
  expect(
    within(section).getAllByRole("link", { name: "Cells quiz" })[0],
  ).toHaveAttribute("href", "/projects/p/study/quizzes/q1");
  expect(
    within(section).getByRole("link", { name: "Biology deck" }),
  ).toHaveAttribute("href", "/projects/p/study/d1");
  expect(within(section).queryByText("Five")).toBeNull();
  await user.click(within(section).getByRole("button", { name: "Show all 6" }));
  expect(within(section).getByText("Five")).toBeInTheDocument();
  expect(
    within(section).getByText("Listing the 6 most recent of 60."),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Practice builds a quiz of 10 questions/),
  ).toBeInTheDocument();
});

it("builds a weak-spot practice quiz and opens it", async () => {
  const user = userEvent.setup();
  mocks.progress.mockResolvedValue(
    progress({ weak_spots: { items: [spot({})], total: 1 } }),
  );
  mocks.practice.mockResolvedValue({ id: "w1" });
  await setup();
  await user.click(
    await screen.findByRole("button", { name: "Practice weak spots" }),
  );
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith(
      "/projects/p/study/quizzes/w1/take",
    ),
  );
  expect(mocks.practice.mock.calls[0][0]).toEqual({
    path: { project_id: "p" },
    body: { topic: null, question_count: 1 },
  });
});

it("filters by topic and scopes Practice to it", async () => {
  const user = userEvent.setup();
  mocks.progress.mockResolvedValue(
    progress({
      topics: [topic({}), topic({ key: "energy", label: "Energy" })],
      weak_spots: {
        items: [
          spot({ prompt: "In cells", topics: ["cells"] }),
          spot({ root_id: "r2", prompt: "In energy", topics: ["energy"] }),
        ],
        total: 2,
      },
    }),
  );
  mocks.practice.mockResolvedValue({ id: "t1" });
  const panel = await setup();
  await user.click(await within(panel).findByLabelText("Topic"));
  await user.click(await screen.findByRole("option", { name: "Energy" }));
  const section = within(panel).getByRole("region", { name: "Needs practice" });
  expect(within(section).getByText("In energy")).toBeInTheDocument();
  expect(within(section).queryByText("In cells")).toBeNull();
  expect(within(section).getByText("1 in Energy")).toBeInTheDocument();
  expect(screen.queryByRole("listitem", { name: "Cells" })).toBeNull();
  await user.click(
    within(panel).getByRole("button", { name: "Practice Energy" }),
  );
  await waitFor(() => expect(mocks.practice).toHaveBeenCalled());
  expect(mocks.practice.mock.calls[0][0]).toEqual({
    path: { project_id: "p" },
    body: { topic: "Energy", question_count: 6 },
  });
});

it("reports a failed practice build", async () => {
  const user = userEvent.setup();
  mocks.progress.mockResolvedValue(
    progress({ weak_spots: { items: [spot({})], total: 1 } }),
  );
  mocks.practice.mockRejectedValue({
    detail: "There are no weak spots to practice yet",
  });
  await setup();
  await user.click(
    await screen.findByRole("button", { name: "Practice weak spots" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "There are no weak spots to practice yet",
  );
  expect(mocks.push).not.toHaveBeenCalled();
});

it("adds only the unclear item the learner confirms, with their wording", async () => {
  const user = userEvent.setup();
  mocks.progress
    .mockResolvedValueOnce(
      progress({
        unclear: {
          items: [unclear("Tonicity"), unclear("Why cells burst")],
          total: 2,
        },
      }),
    )
    .mockResolvedValue(
      progress({ unclear: { items: [unclear("Why cells burst")], total: 1 } }),
    );
  mocks.create.mockResolvedValue({ id: "card", front: "What is tonicity?" });
  await setup();
  const section = await screen.findByRole("region", {
    name: "From your reflections",
  });
  const first = within(section).getByRole("listitem", {
    name: "Unclear: Tonicity",
  });
  expect(within(first).getByLabelText("Question")).toHaveValue("Tonicity");
  const add = within(first).getByRole("button", { name: "Add card" });
  // A card needs an answer, so nothing is added from the prefilled text alone.
  expect(add).toBeDisabled();
  const question = within(first).getByLabelText("Question");
  await user.clear(question);
  await user.type(question, "What is tonicity?");
  await user.type(
    within(first).getByLabelText("Answer"),
    "Relative solute concentration",
  );
  await user.click(add);
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  expect(mocks.create.mock.calls[0][0]).toEqual({
    path: { project_id: "p" },
    body: {
      reflection_id: "ref1",
      item: "Tonicity",
      deck_id: null,
      front: "What is tonicity?",
      back: "Relative solute concentration",
      weak_spot: true,
    },
  });
  expect(await within(section).findByRole("status")).toHaveTextContent(
    "Card added: What is tonicity?",
  );
  // The progress read refreshes and the added item leaves the list.
  await waitFor(() =>
    expect(
      within(section).queryByRole("listitem", { name: "Unclear: Tonicity" }),
    ).toBeNull(),
  );
  expect(
    within(section).getByRole("listitem", { name: "Unclear: Why cells burst" }),
  ).toBeInTheDocument();
});

it("can use a chosen deck, skip Needs practice, and show a repeat", async () => {
  mocks.progress.mockResolvedValue(
    progress({ unclear: { items: [unclear("Tonicity")], total: 1 } }),
  );
  mocks.create.mockRejectedValueOnce({ detail: "This item is already a card" });
  const user = userEvent.setup();
  await setup();
  const section = await screen.findByRole("region", {
    name: "From your reflections",
  });
  await user.click(
    within(section).getByRole("combobox", { name: "Add cards to" }),
  );
  expect(
    screen.queryByRole("option", { name: "Unclear items" }),
  ).not.toBeInTheDocument();
  await user.click(await screen.findByRole("option", { name: "Biology" }));
  const first = within(section).getByRole("listitem", {
    name: "Unclear: Tonicity",
  });
  await user.type(within(first).getByLabelText("Answer"), "Look in chapter 3");
  await user.click(
    within(first).getByRole("checkbox", {
      name: "Also add to Needs practice",
    }),
  );
  await user.click(within(first).getByRole("button", { name: "Add card" }));
  expect(await within(first).findByRole("alert")).toHaveTextContent(
    "This item is already a card",
  );
  expect(mocks.create.mock.calls[0][0].body).toMatchObject({
    deck_id: "d1",
    weak_spot: false,
  });
});

it("describes practice quizzes", () => {
  const base = {
    id: "w1",
    project_id: "p",
    title: "Practice: weak spots",
    tags: [],
    question_count: 2,
    multiple_choice_count: 1,
    short_answer_count: 1,
    attempt_count: 0,
    last_score: null,
    best_score: null,
    created_at: 1,
    updated_at: 1,
    questions: [],
  };
  expect(
    quizDescription({
      ...base,
      origin: "practice",
      model_id: null,
      model_name: null,
    }),
  ).toBe(
    "2 questions · 1 multiple choice, 1 short answer · built for practice",
  );
  expect(
    quizDescription({
      ...base,
      origin: "generated",
      model_id: "m1",
      model_name: "Model One",
    }),
  ).toContain("written by Model One");
});
