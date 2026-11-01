import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { CardDraftReview } from "./card-draft-review";

const mocks = vi.hoisted(() => ({
  deck: vi.fn(),
  files: vi.fn(),
  models: vi.fn(),
  generate: vi.fn(),
  createCard: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ settings: { default_model_id: "m2" } }),
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
  studyDeckGetOneOptions: () => ({
    queryKey: ["deck"],
    queryFn: () => mocks.deck(),
  }),
  projectFileGetManyOptions: () => ({
    queryKey: ["files"],
    queryFn: () => mocks.files(),
  }),
  chatModelsListOptions: () => ({
    queryKey: ["models"],
    queryFn: () => mocks.models(),
  }),
  studyCardDraftGenerateMutation: () => ({ mutationFn: mocks.generate }),
  studyCardCreateMutation: () => ({ mutationFn: mocks.createCard }),
}));

const citation = (file: string) => ({
  file_id: file,
  chunk_id: `${file}-c0`,
  artifact_generation: 1,
  excerpt: "ATP stores energy",
  available: true,
  file_name: `${file}.pdf`,
});
const batch = {
  drafts: [
    { front: "What is ATP?", back: "Energy", citations: [citation("f1")] },
    { front: "What is DNA?", back: "Genes", citations: [citation("f1")] },
    { front: "What is RNA?", back: "Messenger", citations: [citation("f1")] },
  ],
  files: [
    {
      file_id: "f1",
      file_name: "f1.pdf",
      status: "used",
      message: null,
      card_count: 3,
      truncated: true,
    },
    {
      file_id: "f2",
      file_name: "f2.pdf",
      status: "failed",
      message: "This file is still being processed.",
      card_count: 0,
      truncated: false,
    },
  ],
};

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
      <CardDraftReview projectId="p" deckId="d" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deck.mockResolvedValue({ id: "d", name: "Biology", card_count: 0 });
  mocks.files.mockResolvedValue({
    files: Array.from({ length: 12 }, (_, i) => ({
      id: `f${i + 1}`,
      filename: `f${i + 1}.pdf`,
    })),
    total: 12,
  });
  mocks.models.mockResolvedValue([
    { id: "m1", name: "Model one", available: true },
    { id: "m2", name: "Model two", available: true },
    { id: "m3", name: "Off", available: false },
  ]);
  mocks.generate.mockResolvedValue(batch);
  mocks.createCard.mockResolvedValue({});
});

async function generateDrafts() {
  await screen.findByRole("option", { name: "Model two" });
  await userEvent.click(screen.getByRole("radio", { name: "Choose files" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "f1.pdf" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "f2.pdf" }));
  await userEvent.click(screen.getByRole("button", { name: "Draft cards" }));
  return screen.findByRole("region", { name: "Drafts" });
}

it("drafts from chosen files with the default model and shows file results", async () => {
  setup();
  expect(
    await screen.findByRole("heading", { level: 1, name: "Draft cards" }),
  ).toBeInTheDocument();
  // All 12 project files exceed the whole-project limit, so the learner is told to choose.
  expect(await screen.findByText(/more than 10 files/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Draft cards" })).toBeDisabled();
  await generateDrafts();
  expect(mocks.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      path: { project_id: "p", deck_id: "d" },
      body: { model_id: "m2", count: 10, file_ids: ["f1", "f2"] },
    }),
    expect.anything(),
  );
  const files = screen.getByRole("region", { name: "File results" });
  expect(files).toHaveTextContent(
    "3 drafts. Only the start of this file was used.",
  );
  expect(files).toHaveTextContent("This file is still being processed.");
  expect(
    screen.getAllByTestId("markdown").map((node) => node.textContent),
  ).toContain("What is ATP?");
});

it("limits file choices to ten", async () => {
  setup();
  await screen.findByRole("option", { name: "Model two" });
  await userEvent.click(screen.getByRole("radio", { name: "Choose files" }));
  for (let i = 1; i <= 10; i++)
    await userEvent.click(screen.getByRole("checkbox", { name: `f${i}.pdf` }));
  expect(screen.getByRole("checkbox", { name: "f11.pdf" })).toBeDisabled();
  expect(screen.getByText("10 of up to 10 files chosen.")).toBeInTheDocument();
});

it("saves an edited draft with its citations and marks it saved", async () => {
  setup();
  await generateDrafts();
  await userEvent.click(screen.getByRole("button", { name: "Edit Draft 1" }));
  const item = screen.getByRole("listitem", { name: "Draft 1" });
  const back = within(item).getByLabelText("Back");
  await userEvent.clear(back);
  await userEvent.type(back, "Adenosine triphosphate");
  await userEvent.click(
    within(item).getByRole("button", { name: "Done editing" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Accept Draft 1" }));
  await waitFor(() =>
    expect(mocks.createCard).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { project_id: "p", deck_id: "d" },
        body: {
          front: "What is ATP?",
          back: "Adenosine triphosphate",
          citations: [
            {
              file_id: "f1",
              chunk_id: "f1-c0",
              artifact_generation: 1,
              excerpt: "ATP stores energy",
            },
          ],
        },
      }),
      expect.anything(),
    ),
  );
  expect(await within(item).findByText("Saved to deck")).toBeInTheDocument();
});

it("discards, restores and accepts all remaining drafts", async () => {
  setup();
  await generateDrafts();
  await userEvent.click(
    screen.getByRole("button", { name: "Discard Draft 2" }),
  );
  expect(screen.getByText("Draft 2 discarded.")).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Restore Draft 2" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Discard Draft 2" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Accept all (2)" }));
  await waitFor(() => expect(mocks.createCard).toHaveBeenCalledTimes(2));
  const fronts = mocks.createCard.mock.calls.map(([vars]) => vars.body.front);
  expect(fronts).toEqual(["What is ATP?", "What is RNA?"]);
  expect(await screen.findAllByText("Saved to deck")).toHaveLength(2);
});

it("keeps a draft pending when saving fails", async () => {
  mocks.createCard.mockRejectedValueOnce({
    detail: "Citations must reference files in this project",
  });
  setup();
  await generateDrafts();
  await userEvent.click(screen.getByRole("button", { name: "Accept Draft 1" }));
  const item = screen.getByRole("listitem", { name: "Draft 1" });
  expect(await within(item).findByRole("alert")).toHaveTextContent(
    "Citations must reference files in this project",
  );
  expect(
    within(item).getByRole("button", { name: "Accept Draft 1" }),
  ).toBeEnabled();
});

it("confirms before replacing unaccepted drafts", async () => {
  setup();
  await generateDrafts();
  await userEvent.click(screen.getByRole("button", { name: "Draft cards" }));
  const confirm = await screen.findByRole("alertdialog");
  expect(confirm).toHaveTextContent("Replace your drafts?");
  await userEvent.click(
    within(confirm).getByRole("button", { name: "Cancel" }),
  );
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Draft cards" }));
  await userEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Draft again",
    }),
  );
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2));
});

it("shows generation errors", async () => {
  mocks.generate.mockRejectedValueOnce({
    detail: "Selected model is unavailable (disabled); choose another model",
  });
  setup();
  await screen.findByRole("option", { name: "Model two" });
  await userEvent.click(screen.getByRole("radio", { name: "Choose files" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "f1.pdf" }));
  await userEvent.click(screen.getByRole("button", { name: "Draft cards" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Selected model is unavailable",
  );
});
