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
import { TemplatesSettings } from "./templates-settings";

const mocks = vi.hoisted(() => ({
  frameworks: vi.fn(),
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
    promptFrameworkGetManyOptions: () => ({
      queryKey: key("promptFrameworkGetMany"),
      queryFn: mocks.frameworks,
    }),
    promptTemplateGetManyOptions: ({ query }: { query: object }) => ({
      queryKey: key("promptTemplateGetMany", { query }),
      queryFn: () => mocks.list(query),
    }),
    promptTemplateGetOneOptions: ({ path }: { path: object }) => ({
      queryKey: key("promptTemplateGetOne", { path }),
      queryFn: () => mocks.detail(path),
    }),
    promptTemplateGetManyQueryKey: () => key("promptTemplateGetMany"),
    promptTemplateGetOneQueryKey: (options: object) =>
      key("promptTemplateGetOne", options),
    promptTemplateCreateMutation: () => ({ mutationFn: mocks.create }),
    promptTemplateUpdateMutation: () => ({ mutationFn: mocks.update }),
    promptTemplateDeleteMutation: () => ({ mutationFn: mocks.remove }),
  };
});

const rtfDocument = {
  name: "RTF",
  description: "Role, Task, Format",
  fields: [
    {
      kind: "short_text" as const,
      key: "role",
      label: "Role",
      help: "",
      required: true,
      example: "a running coach",
      default: "a teacher",
    },
    {
      kind: "long_text" as const,
      key: "task",
      label: "Task",
      help: "",
      required: true,
      example: null,
      default: null,
    },
  ],
  body: "Act as {{role}}. {{task}}",
  checklist: ["Say who should answer.", "State the task."],
};
const rtf = {
  id: "rtf",
  revision: 2,
  name: "RTF",
  description: "Role, Task, Format",
  document: rtfDocument,
};
const mine = {
  id: "t1",
  name: "Weekly brief",
  description: "Summaries",
  revision: 3,
  created_at: 1,
  updated_at: 1,
  document: { ...rtfDocument, name: "Weekly brief", description: "Summaries" },
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
  mocks.frameworks.mockResolvedValue({ version: 1, items: [rtf] });
  mocks.list.mockResolvedValue({
    items: [mine],
    total: 1,
    page: 1,
    page_size: 10,
  });
  mocks.detail.mockResolvedValue(mine);
  mocks.create.mockImplementation(async ({ body }) => ({
    ...mine,
    id: "t2",
    ...body,
  }));
  mocks.update.mockResolvedValue({ ...mine, revision: 4 });
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
  render(<TemplatesSettings />, { wrapper: Wrapper });
  return user;
};

it("lists read-only frameworks and owned templates", async () => {
  setup();
  const frameworks = await screen.findByRole("list", { name: "Frameworks" });
  expect(within(frameworks).getByText("RTF")).toBeInTheDocument();
  expect(within(frameworks).getByText("Framework · revision 2")).toBeVisible();
  expect(
    within(frameworks).queryByRole("button", { name: /Edit/ }),
  ).not.toBeInTheDocument();
  const owned = await screen.findByRole("list", { name: "Your templates" });
  expect(within(owned).getByText("Weekly brief")).toBeVisible();
  expect(
    within(owned).getByRole("button", { name: "Edit Weekly brief" }),
  ).toBeVisible();
});

it("duplicates a framework into a new owned template", async () => {
  const user = setup();
  await user.click(
    await screen.findByRole("button", { name: "Duplicate RTF" }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByLabelText("Name")).toHaveValue("RTF (copy)");
  await user.click(within(dialog).getByRole("tab", { name: "Preview" }));
  expect(within(dialog).getByTestId("template-preview")).toHaveTextContent(
    "Act as a teacher. [Task]",
  );
  expect(
    within(dialog).queryByRole("button", { name: "Use prompt" }),
  ).not.toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Save template" }),
  );
  await waitFor(() => expect(mocks.create).toHaveBeenCalled());
  expect(mocks.create.mock.calls[0][0]).toEqual({
    body: { document: { ...rtfDocument, name: "RTF (copy)" } },
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // The shared mutation cache refreshes the owned list.
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
});

it("edits fields and body with a revision-checked save", async () => {
  const user = setup();
  await user.click(
    await screen.findByRole("button", { name: "Edit Weekly brief" }),
  );
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Add field" }));
  // The new field is focused and its placeholder is appended to the body.
  const label = within(dialog).getAllByLabelText("Label")[2];
  await waitFor(() => expect(label).toHaveFocus());
  await user.clear(label);
  await user.type(label, "Audience");
  const key = within(dialog).getAllByLabelText("Key")[2];
  await user.clear(key);
  await user.type(key, "audience");
  const body = within(dialog).getByLabelText("Prompt body");
  // The label set the key, and the body followed it.
  expect(body).toHaveValue("Act as {{role}}. {{task}}\n\n{{audience}}");
  await user.clear(body);
  await user.type(body, "For ");
  await user.click(
    within(dialog).getByRole("button", { name: "Insert {{audience}}" }),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Save template" }),
  );
  // Unused fields block the save and are announced.
  const alert = await within(dialog).findByRole("alert");
  expect(alert).toHaveTextContent(
    "Field 1 (Role): Not used in the body; insert {{role}} or remove the field.",
  );
  await waitFor(() => expect(alert).toHaveFocus());
  expect(mocks.update).not.toHaveBeenCalled();
  await user.click(body);
  await user.type(body, ": {{{{role}} {{{{task}}");
  expect(body).toHaveValue("For {{audience}}: {{role}} {{task}}");
  expect(within(dialog).queryByRole("alert")).toBeNull();
  await user.click(
    within(dialog).getByRole("button", { name: "Save template" }),
  );
  await waitFor(() => expect(mocks.update).toHaveBeenCalled());
  const call = mocks.update.mock.calls[0][0];
  expect(call.path).toEqual({ template_id: "t1" });
  expect(call.body.expected_revision).toBe(3);
  expect(call.body.document.fields[2]).toEqual({
    kind: "short_text",
    key: "audience",
    label: "Audience",
    help: "",
    required: false,
    example: null,
    default: null,
  });
});

it("keeps the draft on a conflict and reloads the current revision", async () => {
  const user = setup();
  mocks.update.mockRejectedValueOnce({
    detail: "Prompt template changed; reload before saving",
  });
  await user.click(
    await screen.findByRole("button", { name: "Edit Weekly brief" }),
  );
  const dialog = await screen.findByRole("dialog");
  const name = within(dialog).getByLabelText("Name");
  await user.clear(name);
  await user.type(name, "My draft");
  await user.click(
    within(dialog).getByRole("button", { name: "Save template" }),
  );
  expect(
    await within(dialog).findByText(
      "Prompt template changed; reload before saving",
    ),
  ).toBeVisible();
  expect(name).toHaveValue("My draft");
  mocks.detail.mockResolvedValue({
    ...mine,
    revision: 5,
    name: "Server name",
    document: { ...mine.document, name: "Server name" },
  });
  await user.click(
    within(dialog).getByRole("button", { name: "Reload current template" }),
  );
  await user.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Discard changes",
    }),
  );
  await waitFor(() =>
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Server name"),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Save template" }),
  );
  await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
  expect(mocks.update.mock.calls[1][0].body.expected_revision).toBe(5);
});

it("deletes with the loaded revision after confirmation", async () => {
  const user = setup();
  await user.click(
    await screen.findByRole("button", { name: "Edit Weekly brief" }),
  );
  const dialog = await screen.findByRole("dialog");
  await user.click(
    within(dialog).getByRole("button", { name: "Delete template" }),
  );
  await user.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Delete template",
    }),
  );
  await waitFor(() =>
    expect(mocks.remove.mock.calls[0][0]).toEqual({
      path: { template_id: "t1" },
      query: { expected_revision: 3 },
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("reorders fields from the keyboard and keeps focus on the moved field", async () => {
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "New template" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Add field" }));
  await waitFor(() =>
    expect(within(dialog).getAllByLabelText("Label")[1]).toHaveFocus(),
  );
  const moveUp = within(dialog).getByRole("button", {
    name: "Move Field 2 up",
  });
  moveUp.focus();
  await user.keyboard("{Enter}");
  const groups = within(dialog).getAllByRole("group", { name: /^Field \d/ });
  expect(groups[0]).toHaveAccessibleName("Field 1: Field 2");
  // At the top, focus moves to the remaining enabled direction.
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Move Field 2 down" }),
    ).toHaveFocus(),
  );
});
