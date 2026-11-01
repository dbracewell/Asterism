import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GuideGenerate } from "./guide-generate";
import { NotePage } from "./note-page";
import { ProjectStudyNotes } from "./project-study-notes";
import { SummaryGenerate } from "./summary-generate";

const mocks = vi.hoisted(() => ({
  files: vi.fn(),
  models: vi.fn(),
  summarize: vi.fn(),
  plan: vi.fn(),
  createNote: vi.fn(),
  note: vi.fn(),
  notes: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ settings: { default_model_id: "m1" } }),
}));
vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
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
  studyNoteGetOneOptions: () => ({
    queryKey: ["note"],
    queryFn: () => mocks.note(),
  }),
  studyNoteGetManyOptions: () => ({
    queryKey: ["notes"],
    queryFn: () => mocks.notes(),
  }),
  studySummaryGenerateMutation: () => ({ mutationFn: mocks.summarize }),
  studyGuideGenerateMutation: () => ({ mutationFn: mocks.plan }),
  studyNoteCreateMutation: () => ({ mutationFn: mocks.createNote }),
  studyNoteUpdateMutation: () => ({ mutationFn: mocks.updateNote }),
  studyNoteDeleteMutation: () => ({ mutationFn: mocks.deleteNote }),
}));

const citation = {
  file_id: "f1",
  chunk_id: "c1",
  artifact_generation: 1,
  excerpt: "ATP stores energy",
  available: true,
  file_name: "cells.pdf",
};

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
  mocks.models.mockResolvedValue([
    { id: "m1", name: "Model One", available: true },
  ]);
  mocks.files.mockResolvedValue({
    files: [{ id: "f1", filename: "cells.pdf" }],
  });
  mocks.createNote.mockResolvedValue({ id: "n1" });
});

afterEach(() => {
  vi.useRealTimers();
});

it("summarizes at a chosen depth and saves the summary as a note", async () => {
  const user = userEvent.setup();
  mocks.summarize.mockResolvedValue({
    title: "Expert summary: cells.pdf",
    depth: "expert",
    sections: [
      {
        file_id: "f1",
        file_name: "cells.pdf",
        heading: "Energy",
        text: "ATP **stores** energy.",
        citations: [citation],
      },
    ],
    body: "## cells.pdf\n\n### Energy\n\nATP **stores** energy.\n",
    citations: [citation],
    files: [
      {
        file_id: "f1",
        file_name: "cells.pdf",
        status: "used",
        message: null,
        section_count: 1,
        truncated: true,
      },
    ],
    model_id: "m1",
    model_name: "Model One",
  });
  renderWithClient(<SummaryGenerate projectId="p" />);
  await user.click(await screen.findByLabelText("Expert"));
  await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("m1"));
  await user.click(screen.getByRole("button", { name: "Summarize" }));
  await waitFor(() => expect(mocks.summarize).toHaveBeenCalled());
  expect(mocks.summarize.mock.calls[0][0]).toEqual({
    path: { project_id: "p" },
    body: { model_id: "m1", depth: "expert", file_ids: null },
  });

  const section = await screen.findByRole("article", { name: "Energy" });
  expect(
    within(section).getByText("ATP **stores** energy."),
  ).toBeInTheDocument();
  expect(within(section).getByText("cells.pdf", { selector: "span" }));
  expect(
    screen.getByText(/Only the start of this file was used/),
  ).toBeInTheDocument();

  const title = screen.getByLabelText("Note title");
  expect(title).toHaveValue("Expert summary: cells.pdf");
  await user.clear(title);
  await user.type(title, "Cells, expert");
  await user.click(screen.getByRole("button", { name: "Save as note" }));
  await waitFor(() => expect(mocks.createNote).toHaveBeenCalled());
  expect(mocks.createNote.mock.calls[0][0]).toEqual({
    path: { project_id: "p" },
    body: {
      kind: "summary",
      title: "Cells, expert",
      body: "## cells.pdf\n\n### Energy\n\nATP **stores** energy.\n",
      citations: [
        {
          file_id: "f1",
          chunk_id: "c1",
          artifact_generation: 1,
          excerpt: "ATP stores energy",
        },
      ],
      model_id: "m1",
    },
  });
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith("/projects/p/study/notes/n1"),
  );
});

it("reports an empty summary without offering to save it", async () => {
  const user = userEvent.setup();
  mocks.summarize.mockResolvedValue({
    title: "Standard summary: cells.pdf",
    depth: "standard",
    sections: [],
    body: "",
    citations: [],
    files: [
      {
        file_id: "f1",
        file_name: "cells.pdf",
        status: "failed",
        message: "This file is still being processed.",
        section_count: 0,
        truncated: false,
      },
    ],
    model_id: "m1",
    model_name: "Model One",
  });
  renderWithClient(<SummaryGenerate projectId="p" />);
  const submit = await screen.findByRole("button", { name: "Summarize" });
  await waitFor(() => expect(submit).toBeEnabled());
  await user.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "No summary was produced",
  );
  expect(
    screen.getByText("This file is still being processed."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save as note" }),
  ).not.toBeInTheDocument();
});

it("plans study days with linked tasks and saves the plan", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 2, 9) });
  const user = userEvent.setup();
  mocks.plan.mockResolvedValue({
    title: "Study guide for 9 November 2026",
    start_date: "2026-11-02",
    exam_date: "2026-11-09",
    minutes_per_day: 45,
    days: [
      {
        date: "2026-11-02",
        focus: "Cells",
        tasks: [
          {
            text: "Review the deck",
            minutes: 30,
            link: { kind: "deck", id: "d1", title: "Bio deck" },
          },
          {
            text: "<b>Read</b> chapter 1",
            minutes: null,
            link: null,
          },
        ],
      },
      {
        date: "2026-11-08",
        focus: "",
        tasks: [
          {
            text: "Take the quiz",
            minutes: 20,
            link: { kind: "quiz", id: "q1", title: "Cells quiz" },
          },
        ],
      },
    ],
    body: "Plan body",
    model_id: "m1",
    model_name: "Model One",
  });
  renderWithClient(<GuideGenerate projectId="p" />);
  expect(await screen.findByLabelText("Start date")).toHaveValue("2026-11-02");
  const exam = screen.getByLabelText("Exam date");
  expect(exam).toHaveValue("2026-11-09");
  expect(screen.getByText("8 days to plan.")).toBeInTheDocument();

  await user.clear(exam);
  await user.type(exam, "2026-10-30");
  expect(
    screen.getByText(/Choose an exam date on or after the start date/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Plan study days" }),
  ).toBeDisabled();
  await user.clear(exam);
  await user.type(exam, "2026-11-09");
  const minutes = screen.getByLabelText("Minutes per day");
  await user.clear(minutes);
  await user.type(minutes, "45");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Plan study days" }),
    ).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Plan study days" }));
  await waitFor(() => expect(mocks.plan).toHaveBeenCalled());
  expect(mocks.plan.mock.calls[0][0].body).toEqual({
    model_id: "m1",
    start_date: "2026-11-02",
    exam_date: "2026-11-09",
    minutes_per_day: 45,
  });

  const plan = await screen.findByRole("region", { name: "Study plan" });
  const days = within(plan).getAllByRole("listitem", {
    name: /November|Nov/,
  });
  expect(days).toHaveLength(2);
  expect(
    within(days[0]).getByRole("link", { name: "Bio deck" }),
  ).toHaveAttribute("href", "/projects/p/study/d1");
  expect(
    within(days[0]).getByText(/<b>Read<\/b> chapter 1/),
  ).toBeInTheDocument();
  expect(
    within(days[1]).getByRole("link", { name: "Cells quiz" }),
  ).toHaveAttribute("href", "/projects/p/study/quizzes/q1");

  await user.click(screen.getByRole("button", { name: "Save as note" }));
  await waitFor(() => expect(mocks.createNote).toHaveBeenCalled());
  expect(mocks.createNote.mock.calls[0][0].body).toEqual({
    kind: "study_guide",
    title: "Study guide for 9 November 2026",
    body: "Plan body",
    citations: [],
    model_id: "m1",
  });
});

it("shows a plan failure", async () => {
  const user = userEvent.setup();
  mocks.plan.mockRejectedValue({
    detail:
      "The model could not write a study plan. Try again or choose another model.",
  });
  renderWithClient(<GuideGenerate projectId="p" />);
  const submit = await screen.findByRole("button", { name: "Plan study days" });
  await waitFor(() => expect(submit).toBeEnabled());
  await user.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not write a study plan",
  );
});

const note = {
  id: "n1",
  project_id: "p",
  kind: "summary",
  title: "Cells summary",
  body: "## Cells\n\nText",
  citations: [{ ...citation, available: false, file_name: null }],
  model_id: "m1",
  model_name: "Model One",
  created_at: 1,
  updated_at: 1,
};

it("views, edits and deletes a note", async () => {
  const user = userEvent.setup();
  mocks.note.mockResolvedValue(note);
  mocks.updateNote.mockResolvedValue({ ...note, title: "Renamed" });
  mocks.deleteNote.mockResolvedValue(undefined);
  renderWithClient(<NotePage projectId="p" noteId="n1" />);
  expect(
    await screen.findByRole("heading", { name: "Cells summary" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Summary · written by Model One/),
  ).toBeInTheDocument();
  expect(screen.getByTestId("markdown")).toHaveTextContent("## Cells Text");
  expect(
    screen.getByText("Source no longer in this project"),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Edit note" }));
  const dialog = await screen.findByRole("dialog");
  const title = within(dialog).getByLabelText("Title");
  await user.clear(title);
  await user.type(title, "Renamed");
  const body = within(dialog).getByLabelText("Body");
  await user.clear(body);
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));
  expect(mocks.updateNote).not.toHaveBeenCalled();
  await user.type(body, "New text");
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(mocks.updateNote).toHaveBeenCalled());
  expect(mocks.updateNote.mock.calls[0][0]).toEqual({
    path: { project_id: "p", note_id: "n1" },
    body: { title: "Renamed", body: "New text" },
  });

  await user.click(screen.getByRole("button", { name: "Delete note" }));
  await user.click(await screen.findByRole("button", { name: "Delete note" }));
  await waitFor(() => expect(mocks.deleteNote).toHaveBeenCalled());
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/projects/p"));
});

it("lists notes and offers both generators", async () => {
  mocks.notes.mockResolvedValue({
    items: [
      { ...note, kind: "study_guide", title: "Exam plan", model_name: null },
    ],
    total: 1,
    page: 1,
    page_size: 20,
  });
  renderWithClient(<ProjectStudyNotes projectId="p" />);
  expect(
    await screen.findByRole("link", { name: "Exam plan" }),
  ).toHaveAttribute("href", "/projects/p/study/notes/n1");
  expect(screen.getByText(/^Study guide · updated/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Summarize files" })).toHaveAttribute(
    "href",
    "/projects/p/study/summaries/new",
  );
  expect(
    screen.getByRole("link", { name: "Plan for an exam" }),
  ).toHaveAttribute("href", "/projects/p/study/guides/new");
});
