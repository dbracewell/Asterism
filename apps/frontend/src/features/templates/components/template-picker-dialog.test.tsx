import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TemplatePickerDialog } from "./template-picker-dialog";

const { frameworks, templates, detail } = vi.hoisted(() => ({
  frameworks: vi.fn(),
  templates: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  promptFrameworkGetManyOptions: () => ({
    queryKey: [{ _id: "promptFrameworkGetMany" }],
    queryFn: frameworks,
  }),
  promptTemplateGetManyOptions: () => ({
    queryKey: [{ _id: "promptTemplateGetMany" }],
    queryFn: templates,
  }),
  promptTemplateGetOneOptions: ({
    path,
  }: {
    path: { template_id: string };
  }) => ({
    queryKey: [{ _id: "promptTemplateGetOne", path }],
    queryFn: () => detail(path.template_id),
  }),
}));

const rtf = {
  id: "rtf",
  revision: 1,
  name: "RTF",
  description: "Role, Task, Format",
  document: {
    name: "RTF",
    description: "Role, Task, Format",
    fields: [
      { kind: "short_text", key: "task", label: "Task", required: true },
    ],
    body: "Do {{task}}.",
  },
};
const mine = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "My summary",
  description: "Summaries",
  revision: 3,
  created_at: 1,
  updated_at: 1,
};

beforeEach(() => {
  frameworks.mockReset().mockResolvedValue({ version: 1, items: [rtf] });
  templates.mockReset().mockResolvedValue({
    items: [mine],
    total: 1,
    page: 1,
    page_size: 100,
  });
  detail.mockReset().mockResolvedValue({
    ...mine,
    document: {
      name: "My summary",
      description: "Summaries",
      fields: [{ kind: "long_text", key: "text", label: "Text" }],
      body: "Summarize: {{text}}",
    },
  });
});

function setup() {
  const onUse = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TemplatePickerDialog
        owner="alice"
        open
        onOpenChange={onOpenChange}
        onUse={onUse}
      />
    </QueryClientProvider>,
  );
  return { onUse, onOpenChange };
}

it("lists frameworks and owned templates, then builds and uses a framework", async () => {
  const user = userEvent.setup();
  const { onUse, onOpenChange } = setup();
  await user.click(await screen.findByRole("button", { name: /^RTF/ }));
  expect(screen.getByRole("heading", { name: "RTF" })).toBeInTheDocument();
  await user.type(screen.getByLabelText(/Task/), "the dishes");
  await user.click(screen.getByRole("button", { name: "Use prompt" }));
  expect(onUse).toHaveBeenCalledWith("Do the dishes.");
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("loads an owned template's document on demand and can go back", async () => {
  const user = userEvent.setup();
  setup();
  await user.click(await screen.findByRole("button", { name: /My summary/ }));
  expect(await screen.findByLabelText("Text")).toBeInTheDocument();
  expect(detail).toHaveBeenCalledWith(mine.id);
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(
    screen.getByRole("heading", { name: "Prompt templates" }),
  ).toBeInTheDocument();
});

it("shows an empty state and a retryable error independently", async () => {
  templates.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
  frameworks.mockRejectedValueOnce({ detail: "Catalog down" });
  const user = userEvent.setup();
  setup();
  expect(
    await screen.findByText("Templates you save will appear here."),
  ).toBeInTheDocument();
  expect(await screen.findByText("Catalog down")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("button", { name: /^RTF/ }),
  ).toBeInTheDocument();
});
