import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectStudyQuizzes } from "./project-study-quizzes";
import { QuizGenerate } from "./quiz-generate";
import { QuizResults } from "./quiz-results";
import { QuizTake, answerInputs } from "./quiz-take";

const mocks = vi.hoisted(() => ({
  files: vi.fn(),
  models: vi.fn(),
  quiz: vi.fn(),
  quizzes: vi.fn(),
  attempt: vi.fn(),
  generate: vi.fn(),
  submit: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ settings: { default_model_id: "m2" } }),
}));
vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => (
    <span data-testid="markdown">{content}</span>
  ),
}));
vi.mock("@/components/settings/model-selector", () => ({
  ModelSelector: ({
    id,
    value,
    onValueChange,
    availableModels,
  }: {
    id: string;
    value?: string;
    onValueChange: (value: string) => void;
    availableModels: { id: string; name: string }[];
  }) => (
    <select
      id={id}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {availableModels.map((model) => (
        <option key={model.id} value={model.id}>
          {model.name}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  projectFileGetManyOptions: () => ({
    queryKey: ["files"],
    queryFn: () => mocks.files(),
  }),
  chatModelsListOptions: () => ({
    queryKey: ["models"],
    queryFn: () => mocks.models(),
  }),
  studyQuizGetOneOptions: () => ({
    queryKey: ["quiz"],
    queryFn: () => mocks.quiz(),
  }),
  studyQuizGetManyOptions: () => ({
    queryKey: ["quizzes"],
    queryFn: () => mocks.quizzes(),
  }),
  studyQuizAttemptGetOneOptions: () => ({
    queryKey: ["attempt"],
    queryFn: () => mocks.attempt(),
  }),
  studyQuizGenerateMutation: () => ({ mutationFn: mocks.generate }),
  studyQuizAttemptSubmitMutation: () => ({ mutationFn: mocks.submit }),
}));

const summary = {
  id: "q1",
  project_id: "p",
  title: "Cells quiz",
  question_count: 3,
  multiple_choice_count: 2,
  short_answer_count: 1,
  attempt_count: 0,
  last_score: null,
  best_score: null,
  origin: "generated",
  model_id: "m1",
  model_name: "Model One",
  created_at: 1,
  updated_at: 1,
};
const quiz = {
  ...summary,
  questions: [
    {
      id: "a",
      position: 0,
      kind: "multiple_choice",
      prompt: "Powerhouse?",
      options: ["Nucleus", "Mitochondria"],
    },
    {
      id: "b",
      position: 1,
      kind: "multiple_choice",
      prompt: "Membrane?",
      options: ["Lipids", "Steel"],
    },
    {
      id: "c",
      position: 2,
      kind: "short_answer",
      prompt: "What does ATP do?",
      options: [],
    },
  ],
};
const models = [
  { id: "m1", name: "Model One", available: true },
  { id: "m2", name: "Model Two", available: true },
  { id: "m3", name: "Gone", available: false },
];

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: () => {
        queryClient.invalidateQueries();
      },
    }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.models.mockResolvedValue(models);
  mocks.files.mockResolvedValue({
    files: [
      { id: "f1", filename: "cells.pdf" },
      { id: "f2", filename: "genes.pdf" },
    ],
  });
  mocks.quiz.mockResolvedValue(quiz);
});

it("lists quizzes with their last score", async () => {
  mocks.quizzes.mockResolvedValue({
    items: [{ ...summary, attempt_count: 1, last_score: 0.5 }],
    total: 1,
    page: 1,
    page_size: 20,
  });
  renderWithClient(<ProjectStudyQuizzes projectId="p" />);
  const link = await screen.findByRole("link", { name: "Cells quiz" });
  expect(link).toHaveAttribute("href", "/projects/p/study/quizzes/q1");
  expect(screen.getByText("3 questions · last 50%")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Take Cells quiz" })).toHaveAttribute(
    "href",
    "/projects/p/study/quizzes/q1/take",
  );
});

it("generates a quiz from chosen files and question types", async () => {
  const user = userEvent.setup();
  mocks.generate.mockResolvedValue({
    quiz,
    files: [
      {
        file_id: "f2",
        file_name: "genes.pdf",
        status: "used",
        message: null,
        question_count: 3,
        truncated: true,
      },
    ],
  });
  renderWithClient(<QuizGenerate projectId="p" />);
  await user.click(await screen.findByLabelText("Choose files"));
  await user.click(await screen.findByLabelText("genes.pdf"));
  await user.click(screen.getByLabelText("Multiple choice"));
  const count = screen.getByLabelText("Number of questions");
  await user.clear(count);
  await user.type(count, "3");
  await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("m2"));
  await user.click(screen.getByRole("button", { name: "Generate quiz" }));

  await waitFor(() => expect(mocks.generate).toHaveBeenCalled());
  expect(mocks.generate.mock.calls[0][0]).toEqual({
    path: { project_id: "p" },
    body: {
      model_id: "m2",
      question_count: 3,
      kinds: ["short_answer"],
      file_ids: ["f2"],
      title: null,
    },
  });
  const result = await screen.findByRole("status");
  expect(result).toHaveTextContent("Saved Cells quiz with 3 questions.");
  expect(screen.getByRole("link", { name: "Start quiz" })).toHaveAttribute(
    "href",
    "/projects/p/study/quizzes/q1/take",
  );
  expect(
    screen.getByText(/Only the start of this file was used/),
  ).toBeInTheDocument();
});

it("requires a question type and reports when no quiz was saved", async () => {
  const user = userEvent.setup();
  mocks.generate.mockResolvedValue({
    quiz: null,
    files: [
      {
        file_id: "f1",
        file_name: "cells.pdf",
        status: "failed",
        message: "The model did not return any usable questions.",
        question_count: 0,
        truncated: false,
      },
    ],
  });
  renderWithClient(<QuizGenerate projectId="p" />);
  const submit = await screen.findByRole("button", { name: "Generate quiz" });
  await user.click(screen.getByLabelText("Multiple choice"));
  await user.click(screen.getByLabelText("Short answer"));
  expect(submit).toBeDisabled();
  expect(
    screen.getByText("Choose at least one question type."),
  ).toBeInTheDocument();
  await user.click(screen.getByLabelText("Short answer"));
  await waitFor(() => expect(submit).toBeEnabled());
  await user.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "No questions were produced",
  );
  expect(
    screen.getByText("The model did not return any usable questions."),
  ).toBeInTheDocument();
});

it("maps answers to the wire shape and omits unanswered questions", () => {
  // @ts-expect-error Test fixture omits fields the mapper does not read.
  const typed: Parameters<typeof answerInputs>[0] = quiz;
  expect(
    answerInputs(typed, { a: { choice: 1 }, b: {}, c: { text: "  " } }),
  ).toEqual([{ question_id: "a", choice: 1 }]);
  expect(answerInputs(typed, { c: { text: " energy " } })).toEqual([
    { question_id: "c", text: "energy" },
  ]);
});

it("takes a quiz and grades short answers with the quiz's model", async () => {
  const user = userEvent.setup();
  mocks.submit.mockResolvedValue({ id: "t1" });
  renderWithClient(<QuizTake projectId="p" quizId="q1" />);
  await screen.findByRole("heading", { name: "Cells quiz" });
  expect(screen.getByText("3 of 3 unanswered.", { exact: false }));
  const first = screen.getByRole("radiogroup", { name: "1. Powerhouse?" });
  await user.click(within(first).getByRole("radio", { name: /Mitochondria/ }));
  await user.type(
    screen.getByRole("textbox", { name: "Your answer to question 3" }),
    "It stores energy",
  );
  expect(screen.getByText(/1 of 3 unanswered/)).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByLabelText("Grading model")).toHaveValue("m1"),
  );
  await user.click(screen.getByRole("button", { name: "Submit answers" }));

  await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
  expect(mocks.submit.mock.calls[0][0]).toEqual({
    path: { project_id: "p", quiz_id: "q1" },
    body: {
      answers: [
        { question_id: "a", choice: 1 },
        { question_id: "c", text: "It stores energy" },
      ],
      model_id: "m1",
    },
  });
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith(
      "/projects/p/study/quizzes/q1/attempts/t1",
    ),
  );
});

it("submits multiple-choice-only answers without a grading model", async () => {
  const user = userEvent.setup();
  mocks.submit.mockRejectedValue({ detail: "Quiz not found" });
  renderWithClient(<QuizTake projectId="p" quizId="q1" />);
  const second = await screen.findByRole("radiogroup", {
    name: "2. Membrane?",
  });
  await user.click(within(second).getByRole("radio", { name: /Lipids/ }));
  await user.click(screen.getByRole("button", { name: "Submit answers" }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
  expect(mocks.submit.mock.calls[0][0].body).toEqual({
    answers: [{ question_id: "b", choice: 0 }],
    model_id: null,
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Quiz not found");
  expect(mocks.push).not.toHaveBeenCalled();
});

it("shows results with the answer key, feedback and citations", async () => {
  mocks.attempt.mockResolvedValue({
    id: "t1",
    quiz_id: "q1",
    quiz_title: "Cells quiz",
    submitted_at: 1,
    score: 1.5,
    question_count: 3,
    ungraded_count: 1,
    grader_model_id: "m1",
    grader_model_name: "Model One",
    results: [
      {
        question_id: "a",
        position: 0,
        kind: "multiple_choice",
        prompt: "Powerhouse?",
        options: ["Nucleus", "Mitochondria"],
        correct_option: 1,
        rubric: "",
        explanation: "Mitochondria make ATP.",
        citations: [
          {
            file_id: "f1",
            chunk_id: "c1",
            artifact_generation: 1,
            excerpt: "Mitochondria…",
            available: true,
            file_name: "cells.pdf",
          },
        ],
        choice: 0,
        text: null,
        verdict: "incorrect",
        grader: "exact",
        feedback: "",
      },
      {
        question_id: "c",
        position: 2,
        kind: "short_answer",
        prompt: "What does ATP do?",
        options: [],
        correct_option: null,
        rubric: "Stores energy.",
        explanation: "",
        citations: [
          {
            file_id: "f9",
            chunk_id: null,
            artifact_generation: null,
            excerpt: null,
            available: false,
            file_name: null,
          },
        ],
        choice: null,
        text: "Energy stuff",
        verdict: "partial",
        grader: "model",
        feedback: "Mention storage.",
      },
    ],
  });
  renderWithClient(<QuizResults projectId="p" quizId="q1" attemptId="t1" />);
  expect(
    await screen.findByRole("heading", { name: "Results: Cells quiz" }),
  ).toBeInTheDocument();
  expect(screen.getByText("1.5 of 3 points (50%)")).toBeInTheDocument();
  expect(screen.getByText(/graded by Model One/)).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "1 answer could not be graded",
  );

  const first = screen.getByRole("listitem", { name: "Question 1: Incorrect" });
  const options = within(first).getAllByRole("listitem");
  expect(options[0]).toHaveTextContent("Your answer");
  expect(options[1]).toHaveTextContent("Correct answer");
  expect(within(first).getByText("Mitochondria make ATP.")).toBeInTheDocument();
  expect(within(first).getByText("cells.pdf")).toBeInTheDocument();

  const second = screen.getByRole("listitem", {
    name: "Question 2: Partly correct",
  });
  expect(within(second).getByText("Energy stuff")).toBeInTheDocument();
  expect(within(second).getByText("Stores energy.")).toBeInTheDocument();
  expect(within(second).getByText("Mention storage.")).toBeInTheDocument();
  expect(
    within(second).getByText("Source no longer in this project"),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Retake quiz" })).toHaveAttribute(
    "href",
    "/projects/p/study/quizzes/q1/take",
  );
});
