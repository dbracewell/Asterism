import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatInput } from "./chat-input";

vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  skillEligibleGetManyOptions: () => ({
    queryKey: [{ _id: "eligible" }],
    queryFn: async () => ({
      items: [],
      total: 0,
      page: 1,
      page_size: 100,
      policy_enabled: true,
      agent_revision: 1,
    }),
  }),
  promptFrameworkGetManyOptions: () => ({
    queryKey: [{ _id: "promptFrameworkGetMany" }],
    queryFn: async () => ({
      version: 1,
      items: [
        {
          id: "rtf",
          revision: 2,
          name: "RTF",
          description: "Role, Task, Format",
          document: {
            name: "RTF",
            description: "Role, Task, Format",
            fields: [
              {
                kind: "short_text",
                key: "task",
                label: "Task",
                required: true,
              },
            ],
            body: "Do {{task}}.",
          },
        },
      ],
    }),
  }),
  promptTemplateGetManyOptions: () => ({
    queryKey: [{ _id: "promptTemplateGetMany" }],
    queryFn: async () => ({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000009",
          name: "My Weekly Brief",
          description: "Status",
          revision: 1,
          created_at: 1,
          updated_at: 1,
        },
      ],
      total: 1,
      page: 1,
      page_size: 100,
    }),
  }),
  promptTemplateGetOneOptions: () => ({
    queryKey: [{ _id: "promptTemplateGetOne" }],
    queryFn: async () => null,
  }),
}));
vi.mock("../hooks/use-attachment-draft", () => ({
  useAttachmentDraft: () => ({
    id: { current: undefined },
    verify: async () => {},
    consumed: () => {},
    discard: async () => {},
  }),
}));
vi.mock("./chat-file-context", () => ({ ChatFileContext: () => null }));
vi.mock("@/components/file-manager/library-file-picker", () => ({
  LibraryFilePickerDialog: () => null,
}));
vi.mock("./attach-menu", () => ({ AttachMenu: () => null }));

beforeEach(() => sessionStorage.clear());

function setup() {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TooltipProvider>
        <ChatInput
          skillOwner="alice"
          skillScope="new:general"
          onSubmit={submit}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { submit, input: screen.getByLabelText("Message") };
}

async function build(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Task/), "laundry");
  await user.click(screen.getByRole("button", { name: "Use prompt" }));
}

it("discovers /template and template names by slash and opens the builder", async () => {
  const user = userEvent.setup();
  const { input } = setup();
  await user.type(input, "/");
  expect(
    await screen.findByRole("option", { name: /\/template/ }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("option", { name: /\/rtf/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("option", { name: /\/my-weekly-brief/ }),
  ).toBeInTheDocument();
  await user.type(input, "rt");
  expect(screen.queryByRole("option", { name: /\/template/ })).toBeNull();
  await user.keyboard("{Enter}");
  // The command token is removed rather than sent as text.
  expect(input).toHaveValue("");
  expect(await screen.findByRole("heading", { name: "RTF" })).toBeVisible();
  await build(user);
  await waitFor(() => expect(input).toHaveValue("Do laundry."));
  expect(screen.getByText("Built with RTF")).toBeInTheDocument();
});

it("sends template provenance once and drops it when removed or cleared", async () => {
  const user = userEvent.setup();
  const { submit, input } = setup();
  await user.click(screen.getByRole("button", { name: "Prompt templates" }));
  await user.click(await screen.findByRole("button", { name: /^RTF/ }));
  await build(user);
  await user.click(screen.getByLabelText("Send message"));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Do laundry.",
        template: {
          source: "framework",
          id: "rtf",
          revision: 2,
          level: "guided",
        },
      }),
    ),
  );
  expect(screen.queryByText("Built with RTF")).toBeNull();

  await user.type(input, "/rtf");
  await user.keyboard("{Enter}");
  await build(user);
  await user.click(
    screen.getByRole("button", { name: "Remove RTF template label" }),
  );
  await user.click(screen.getByLabelText("Send message"));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit.mock.calls[1][0]).not.toHaveProperty("template");

  await user.type(input, "/rtf");
  await user.keyboard("{Enter}");
  await build(user);
  await user.clear(input);
  expect(screen.queryByText("Built with RTF")).toBeNull();
});
