import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { StudyTopicMastery } from "@/lib/client";
import { ProjectTopicMastery } from "./project-topic-mastery";

const mocks = vi.hoisted(() => ({
  topics: vi.fn(),
  practice: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  studyTopicMasteryGetManyOptions: () => ({
    queryKey: [{ _id: "studyTopicMasteryGetMany" }],
    queryFn: () => mocks.topics(),
  }),
  studyTopicPracticeMutation: () => ({ mutationFn: mocks.practice }),
}));

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

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.practice.mockResolvedValue({ id: "quiz1" });
});

function setup() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ProjectTopicMastery projectId="p" />
    </QueryClientProvider>,
  );
}

it("shows each topic's level, score, coverage and trend", async () => {
  mocks.topics.mockResolvedValue({
    computed_at: 3,
    items: [
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
  });
  setup();
  const cells = await screen.findByRole("listitem", { name: "Cells" });
  expect(cells).toHaveTextContent("Developing");
  expect(cells).toHaveTextContent("70% · 4 of 6 practiced");
  expect(cells).toHaveTextContent("Up from 40% to 70% over the last 3 weeks.");
  const energy = screen.getByRole("listitem", { name: "Energy" });
  expect(energy).toHaveTextContent("Not started");
  expect(energy).toHaveTextContent("0 of 2 practiced");
  expect(energy).not.toHaveTextContent("%");
  expect(energy).toHaveTextContent("Not practiced yet.");
  expect(
    screen.getByRole("button", { name: "Help: Topic mastery" }),
  ).toBeInTheDocument();
});

it("starts practice on a topic and opens the quiz", async () => {
  mocks.topics.mockResolvedValue({ computed_at: 3, items: [topic({})] });
  setup();
  const cells = await screen.findByRole("listitem", { name: "Cells" });
  await userEvent.click(
    within(cells).getByRole("button", { name: "Practice Cells" }),
  );
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith(
      "/projects/p/study/quizzes/quiz1/take",
    ),
  );
  expect(mocks.practice.mock.calls[0][0]).toEqual({
    path: { project_id: "p" },
    body: { topic: "Cells", question_count: 10 },
  });
});

it("stays hidden until a deck or quiz has a topic", async () => {
  mocks.topics.mockResolvedValue({ computed_at: 3, items: [] });
  setup();
  await waitFor(() => expect(mocks.topics).toHaveBeenCalled());
  expect(screen.queryByRole("region", { name: "Topic mastery" })).toBeNull();
});
