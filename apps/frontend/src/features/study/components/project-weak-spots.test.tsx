import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectWeakSpots } from "./project-weak-spots";
import { quizDescription } from "./quiz-page";

const mocks = vi.hoisted(() => ({
  spots: vi.fn(),
  practice: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => <span>{content}</span>,
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  studyWeakSpotGetManyOptions: () => ({
    queryKey: ["weak-spots"],
    queryFn: () => mocks.spots(),
  }),
  studyWeakSpotPracticeMutation: () => ({ mutationFn: mocks.practice }),
}));

const spot = (overrides: Record<string, unknown>) => ({
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
  ...overrides,
});

function setup() {
  const queryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: () => {
        queryClient.invalidateQueries();
      },
    }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectWeakSpots projectId="p" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("stays hidden until there are weak spots", async () => {
  mocks.spots.mockResolvedValue({ items: [], total: 0 });
  const { container } = setup();
  await waitFor(() => expect(mocks.spots).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

it("lists weak spots with links to their quiz or deck", async () => {
  mocks.spots.mockResolvedValue({
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
    ],
    total: 12,
  });
  setup();
  const section = await screen.findByRole("region", { name: "Weak spots" });
  expect(within(section).getByText("12 items to practice")).toBeInTheDocument();
  expect(within(section).getByText("Missed")).toBeInTheDocument();
  expect(within(section).getByText("Rated Again")).toBeInTheDocument();
  expect(within(section).getByText("Partly correct")).toBeInTheDocument();
  expect(
    within(section).getAllByRole("link", { name: "Cells quiz" })[0],
  ).toHaveAttribute("href", "/projects/p/study/quizzes/q1");
  expect(
    within(section).getByRole("link", { name: "Biology deck" }),
  ).toHaveAttribute("href", "/projects/p/study/d1");
  expect(
    within(section).getByText(/Practice builds a quiz of 10 questions/),
  ).toBeInTheDocument();
  expect(
    within(section).getByText("Showing the 5 most recent of 12."),
  ).toBeInTheDocument();
});

it("builds a practice quiz and opens it", async () => {
  const user = userEvent.setup();
  mocks.spots.mockResolvedValue({ items: [spot({})], total: 1 });
  mocks.practice.mockResolvedValue({ id: "w1" });
  setup();
  await user.click(
    await screen.findByRole("button", { name: "Practice weak spots" }),
  );
  await waitFor(() => expect(mocks.practice).toHaveBeenCalled());
  expect(mocks.practice.mock.calls[0][0]).toEqual({
    path: { project_id: "p" },
    body: { question_count: 1 },
  });
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith(
      "/projects/p/study/quizzes/w1/take",
    ),
  );
});

it("reports a failed practice build", async () => {
  const user = userEvent.setup();
  mocks.spots.mockResolvedValue({ items: [spot({})], total: 1 });
  mocks.practice.mockRejectedValue({
    detail: "There are no weak spots to practice yet",
  });
  setup();
  await user.click(
    await screen.findByRole("button", { name: "Practice weak spots" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "There are no weak spots to practice yet",
  );
  expect(mocks.push).not.toHaveBeenCalled();
});

it("describes quizzes built from weak spots", () => {
  const base = {
    id: "w1",
    project_id: "p",
    title: "Weak spots practice",
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
      origin: "weak_spots",
      model_id: null,
      model_name: null,
    }),
  ).toBe(
    "2 questions · 1 multiple choice, 1 short answer · built from your weak spots",
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
