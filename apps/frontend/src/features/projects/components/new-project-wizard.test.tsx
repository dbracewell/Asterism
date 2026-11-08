import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { NewProjectWizard } from "./new-project-wizard";

const mocks = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  projectCreateMutation: () => ({ mutationFn: mocks.create }),
}));
// The real picker browses the library; this one offers a single file.
vi.mock("@/components/file-manager/library-file-picker", () => ({
  LibraryFilePickerDialog: ({
    open,
    onPick,
    onOpenChange,
  }: {
    open: boolean;
    onPick: (files: object[]) => Promise<void>;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={async () => {
          await onPick([{ id: "f1", original_name: "syllabus.pdf" }]);
          onOpenChange(false);
        }}
      >
        Pick syllabus
      </button>
    ) : null,
}));

const ALL_ON = { study: true, reflections: true, goal: true, sub_agents: true };

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NewProjectWizard />
    </QueryClientProvider>,
  );
}

const next = () =>
  userEvent.click(screen.getByRole("button", { name: "Next" }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: "p" });
});

it("walks the documents path without a goal step and creates exactly what it reviews", async () => {
  setup();
  await userEvent.click(screen.getByRole("button", { name: "New project" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAccessibleDescription("Step 1 of 5: Starting point");
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  expect(
    screen.getByRole("radio", { name: "Ask my documents" }),
  ).toHaveAccessibleDescription(/answers from the project's files/);
  await userEvent.click(
    screen.getByRole("radio", { name: "Ask my documents" }),
  );
  // Ask my documents turns Goal off, so the goal step is skipped.
  expect(dialog).toHaveAccessibleDescription("Step 1 of 4: Starting point");
  await next();
  expect(
    screen.getByRole("heading", { name: "Name and description" }),
  ).toHaveFocus();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Name"), "  Contracts  ");
  await userEvent.type(screen.getByLabelText("Description"), "Supplier terms");
  await next();
  expect(screen.getByLabelText("Project instructions")).toHaveValue(
    "Answer from this project's files. Name the file you used, and say so when the files don't cover a question.",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Choose library files" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Pick syllabus" }));
  expect(
    within(screen.getByRole("list", { name: "Chosen files" })).getByText(
      "syllabus.pdf",
    ),
  ).toBeVisible();
  // Back keeps what was entered.
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Name")).toHaveValue("  Contracts  ");
  await next();
  expect(screen.getByText("syllabus.pdf")).toBeVisible();
  await next();
  expect(dialog).toHaveAccessibleDescription("Step 4 of 4: Review");
  expect(screen.getByText("Contracts")).toBeVisible();
  expect(screen.getByText("Supplier terms")).toBeVisible();
  expect(screen.getByRole("switch", { name: "Study" })).not.toBeChecked();
  expect(screen.getByRole("switch", { name: "Goal" })).not.toBeChecked();
  expect(mocks.create).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("switch", { name: "Reflections" }));
  await userEvent.click(screen.getByRole("button", { name: "Create project" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/projects/p"));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create.mock.calls[0][0]).toEqual({
    body: {
      name: "Contracts",
      description: "Supplier terms",
      system_prompt:
        "Answer from this project's files. Name the file you used, and say so when the files don't cover a question.",
      accent: null,
      goal: "",
      goal_target_date: null,
      areas: {
        study: false,
        reflections: true,
        goal: false,
        sub_agents: false,
      },
      file_ids: ["f1"],
    },
  });
});

it("asks for a goal when studying, and sends none once Goal is turned off", async () => {
  setup();
  await userEvent.click(screen.getByRole("button", { name: "New project" }));
  await userEvent.click(screen.getByRole("radio", { name: "Study a course" }));
  await next();
  await userEvent.type(screen.getByLabelText("Name"), "Biology");
  await next();
  await next();
  expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
    "Step 4 of 5: Goal",
  );
  await userEvent.type(screen.getByLabelText("Learning goal"), "Pass the exam");
  await next();
  expect(screen.getByText("Pass the exam")).toBeVisible();
  await userEvent.click(screen.getByRole("switch", { name: "Goal" }));
  expect(screen.queryByText("Pass the exam")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Create project" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalled());
  expect(mocks.create.mock.calls[0][0].body).toEqual(
    expect.objectContaining({
      goal: "",
      areas: { ...ALL_ON, goal: false },
      file_ids: [],
    }),
  );
});

it("keeps instructions the user wrote when the starting point changes", async () => {
  setup();
  await userEvent.click(screen.getByRole("button", { name: "New project" }));
  await userEvent.click(screen.getByRole("radio", { name: "Agent workspace" }));
  expect(
    screen.getByRole("radio", { name: "Agent workspace" }),
  ).toHaveAccessibleDescription(
    /choose sub-agents in its Sub-agents tab.*model that supports tools/,
  );
  await next();
  await userEvent.type(screen.getByLabelText("Name"), "Ops");
  await next();
  expect(screen.getByLabelText("Project instructions")).toHaveValue(
    "Plan the work, hand suitable tasks to the selected sub-agents, and check their results before you answer.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  // Untouched pre-filled text follows the new starting point.
  await userEvent.click(screen.getByRole("radio", { name: "Blank" }));
  await next();
  await next();
  const instructions = screen.getByLabelText("Project instructions");
  expect(instructions).toHaveValue("");
  await userEvent.type(instructions, "My own rules");
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await userEvent.click(screen.getByRole("radio", { name: "Study a course" }));
  await next();
  await next();
  expect(screen.getByLabelText("Project instructions")).toHaveValue(
    "My own rules",
  );
});

it("creates nothing on Cancel and starts fresh next time", async () => {
  setup();
  await userEvent.click(screen.getByRole("button", { name: "New project" }));
  await userEvent.click(screen.getByRole("radio", { name: "Blank" }));
  await next();
  await userEvent.type(screen.getByLabelText("Name"), "Draft");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "New project" }));
  expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
    "Step 1 of 5: Starting point",
  );
  expect(screen.getByRole("radio", { name: "Blank" })).not.toBeChecked();
  expect(mocks.create).not.toHaveBeenCalled();
});

it("reports a failed create and keeps the entries", async () => {
  mocks.create.mockRejectedValue({
    detail: "A project with this name already exists",
  });
  setup();
  await userEvent.click(screen.getByRole("button", { name: "New project" }));
  await userEvent.click(screen.getByRole("radio", { name: "Blank" }));
  await next();
  await userEvent.type(screen.getByLabelText("Name"), "Taken");
  await next();
  await next();
  await next();
  await userEvent.click(screen.getByRole("button", { name: "Create project" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "A project with this name already exists Nothing was created.",
  );
  expect(screen.getByText("Taken")).toBeVisible();
  expect(mocks.push).not.toHaveBeenCalled();
});
