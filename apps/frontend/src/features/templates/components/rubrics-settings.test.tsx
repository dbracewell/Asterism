import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import { RubricsSettings } from "./rubrics-settings";

const mocks = vi.hoisted(() => ({
  bundled: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: "owner" }),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => {
  const key = (_id: string, options?: object) => [{ _id, ...options }];
  return {
    rubricBundledGetManyOptions: () => ({
      queryKey: key("rubricBundledGetMany"),
      queryFn: mocks.bundled,
    }),
    rubricGetManyOptions: ({ query }: { query: object }) => ({
      queryKey: key("rubricGetMany", { query }),
      queryFn: () => mocks.list(query),
    }),
    rubricGetOneOptions: ({ path }: { path: object }) => ({
      queryKey: key("rubricGetOne", { path }),
      queryFn: () => mocks.detail(path),
    }),
    rubricGetManyQueryKey: () => key("rubricGetMany"),
    rubricGetOneQueryKey: (options: object) => key("rubricGetOne", options),
    rubricCreateMutation: () => ({ mutationFn: mocks.create }),
    rubricUpdateMutation: () => ({ mutationFn: mocks.update }),
    rubricDeleteMutation: () => ({ mutationFn: mocks.remove }),
  };
});

const essay = {
  name: "Argumentative essay",
  description: "Essays that take a position.",
  levels: ["Exemplary", "Proficient"],
  criteria: [
    {
      label: "Thesis",
      description: "A clear claim.",
      descriptors: ["Specific and arguable.", "Clear."],
    },
  ],
};
const mine = {
  id: "r1",
  name: "History essay",
  description: "Mr. Lee's rubric",
  revision: 2,
  created_at: 1,
  updated_at: 1,
  document: {
    ...essay,
    name: "History essay",
    description: "Mr. Lee's rubric",
  },
};

let cache: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={cache}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.bundled.mockResolvedValue({
    version: 1,
    items: [
      {
        id: "argumentative-essay",
        revision: 1,
        name: essay.name,
        description: essay.description,
        document: essay,
      },
    ],
  });
  mocks.list.mockResolvedValue({
    items: [mine],
    total: 1,
    page: 1,
    page_size: 10,
  });
  mocks.detail.mockResolvedValue(mine);
  mocks.create.mockImplementation(async ({ body }) => ({
    ...mine,
    id: "r2",
    ...body,
  }));
  mocks.update.mockResolvedValue({ ...mine, revision: 3 });
  mocks.remove.mockResolvedValue(undefined);
  cache = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_d, _v, _c, mutation) =>
        handleMutationSuccess(cache, mutation),
    }),
    defaultOptions: { queries: { retry: false } },
  });
});

const setup = () => {
  const user = userEvent.setup();
  render(<RubricsSettings />, { wrapper: Wrapper });
  return user;
};

it("lists bundled rubrics read-only and owned rubrics with edit", async () => {
  setup();
  const bundled = await screen.findByRole("list", { name: "Bundled rubrics" });
  expect(within(bundled).getByText("Argumentative essay")).toBeVisible();
  expect(
    within(bundled).getByText("Bundled · 1 criteria · revision 1"),
  ).toBeVisible();
  expect(
    within(bundled).queryByRole("button", { name: /Edit/ }),
  ).not.toBeInTheDocument();
  const owned = await screen.findByRole("list", { name: "Your rubrics" });
  expect(
    within(owned).getByRole("button", { name: "Edit History essay" }),
  ).toBeVisible();
});

it("duplicates a bundled rubric and adds a level to every criterion", async () => {
  const user = setup();
  await user.click(
    await screen.findByRole("button", {
      name: "Duplicate Argumentative essay",
    }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByLabelText("Name")).toHaveValue(
    "Argumentative essay (copy)",
  );
  await user.click(within(dialog).getByRole("button", { name: "Add level" }));
  const level = within(dialog).getByLabelText("Level 3 name");
  await waitFor(() => expect(level).toHaveFocus());
  // A blank level and descriptor are reported, not sent.
  await user.click(within(dialog).getByRole("button", { name: "Save rubric" }));
  const alert = within(dialog).getByRole("alert");
  expect(alert).toHaveTextContent("Level 3 needs a name.");
  expect(alert).toHaveTextContent(
    "Criterion 1 (Thesis): Describe the level 3 level.",
  );
  expect(mocks.create).not.toHaveBeenCalled();
  // The problem list takes focus so screen readers announce it.
  await waitFor(() => expect(alert).toHaveFocus());
  await user.type(level, "Developing");
  await user.type(within(dialog).getByLabelText("Developing"), "Vague.");
  await user.click(within(dialog).getByRole("button", { name: "Save rubric" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalled());
  expect(mocks.create.mock.calls[0][0]).toEqual({
    body: {
      document: {
        ...essay,
        name: "Argumentative essay (copy)",
        levels: ["Exemplary", "Proficient", "Developing"],
        criteria: [
          {
            ...essay.criteria[0],
            descriptors: ["Specific and arguable.", "Clear.", "Vague."],
          },
        ],
      },
    },
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
});

it("saves edits with the loaded revision and shows conflicts", async () => {
  const user = setup();
  await user.click(
    await screen.findByRole("button", { name: "Edit History essay" }),
  );
  const dialog = await screen.findByRole("dialog");
  await user.click(
    within(dialog).getByRole("button", { name: "Add criterion" }),
  );
  const name = within(dialog).getByLabelText("Criterion 2 name");
  await waitFor(() => expect(name).toHaveFocus());
  await user.type(name, "Sources");
  await user.type(within(dialog).getAllByLabelText("Exemplary")[1], "Many.");
  await user.type(within(dialog).getAllByLabelText("Proficient")[1], "Some.");
  mocks.update.mockRejectedValueOnce({
    detail: "Rubric changed; reload before saving",
  });
  await user.click(within(dialog).getByRole("button", { name: "Save rubric" }));
  expect(
    await within(dialog).findByText("Rubric changed; reload before saving"),
  ).toBeVisible();
  const [request] = mocks.update.mock.calls[0];
  expect(request.path).toEqual({ rubric_id: "r1" });
  expect(request.body.expected_revision).toBe(2);
  expect(request.body.document.criteria[1]).toEqual({
    label: "Sources",
    description: "",
    descriptors: ["Many.", "Some."],
  });
});

it("deletes after confirmation", async () => {
  const user = setup();
  await user.click(
    await screen.findByRole("button", { name: "Edit History essay" }),
  );
  const dialog = await screen.findByRole("dialog");
  await user.click(
    within(dialog).getByRole("button", { name: "Delete rubric" }),
  );
  const confirm = await screen.findByRole("alertdialog");
  await user.click(
    within(confirm).getByRole("button", { name: "Delete rubric" }),
  );
  await waitFor(() =>
    expect(mocks.remove.mock.calls[0][0]).toEqual({
      path: { rubric_id: "r1" },
      query: { expected_revision: 2 },
    }),
  );
});
