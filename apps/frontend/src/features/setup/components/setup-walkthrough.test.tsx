import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETUP_STEPS } from "../steps";
import { stepGuideHref } from "../walkthrough";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SetupWalkthrough } from "./setup-walkthrough";
import { useSetupDraft } from "../setup-draft";
import { useState, type ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  record: vi.fn(),
  replace: vi.fn(),
  search: "t=admin&setting=setup",
  role: "admin",
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: "admin", role: mocks.role }),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  setupProgressGetOptions: () => ({
    queryKey: [{ _id: "setupProgressGet" }],
    queryFn: () => mocks.get(),
  }),
  setupProgressGetQueryKey: () => [{ _id: "setupProgressGet" }],
  setupStepUpdateMutation: () => ({ mutationFn: mocks.record }),
}));

const panes = Object.fromEntries(
  SETUP_STEPS.map((step) => [step.id, <p key={step.id}>{step.id} pane</p>]),
);

function setup(overrides: Record<string, ReactNode> = {}) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({}),
  });
  render(
    <QueryClientProvider client={cache}>
      <TooltipProvider>
        <SetupWalkthrough panes={{ ...panes, ...overrides }} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const stepped = (...ids: string[]) => ({
  steps: Object.fromEntries(ids.map((id) => [id, { state: "done", at: 1 }])),
});

beforeEach(() => {
  mocks.role = "admin";
  mocks.search = "t=admin&setting=setup";
  mocks.replace.mockReset();
  mocks.get.mockReset().mockResolvedValue(stepped("providers"));
  mocks.record.mockReset();
});

it("is for administrators only", () => {
  mocks.role = "user";
  setup();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Administrator access is required to set up Asterism.",
  );
});

it("resumes at the first step nobody reviewed, with its pane", async () => {
  setup();
  expect(
    await screen.findByRole("heading", { name: "Groups and budgets" }),
  ).toBeVisible();
  expect(screen.getByText("group-settings pane")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(
    `1 of ${SETUP_STEPS.length} steps reviewed`,
  );
  expect(
    screen.getByRole("button", { name: /Providers and models.*Reviewed/ }),
  ).toBeVisible();
});

it("says plainly that pictures can't be found without captions", async () => {
  mocks.search = "t=admin&setting=setup&step=image-captioning";
  setup();
  expect(
    await screen.findByText(
      /Captioning is off by default\. While it is off, pictures are kept and can be attached to chats, but search can't find them\./,
    ),
  ).toBeVisible();
  expect(screen.getByText("image-captioning pane")).toBeVisible();
});

it("records Skip and Next and moves on to the next step not reviewed", async () => {
  mocks.record.mockImplementation(
    async ({ path, body }: { path: { step_id: string }; body: object }) => ({
      steps: {
        ...stepped("providers", "usage").steps,
        [path.step_id]: { ...body, at: 2 },
      },
    }),
  );
  setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Skip for now" }));
  expect(mocks.record).toHaveBeenCalledWith(
    { path: { step_id: "group-settings" }, body: { state: "skipped" } },
    expect.anything(),
  );
  // Usage was reviewed meanwhile, so Tools is next.
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith(
      "/settings?t=admin&setting=setup&step=tools",
    ),
  );
});

it("ends at a summary once every step is reviewed", async () => {
  mocks.get.mockResolvedValue(stepped(...SETUP_STEPS.map((step) => step.id)));
  setup();
  expect(
    await screen.findByRole("heading", {
      name: "Every step has been reviewed",
    }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Start chatting" })).toHaveAttribute(
    "href",
    "/",
  );
});

it("every step explains itself and links to where to read more", () => {
  for (const step of SETUP_STEPS) {
    expect(step.explanation.length, step.id).toBeGreaterThan(40);
    expect(stepGuideHref(step), step.id).toMatch(
      /^(\/help\/guide\/|https:\/\/github\.com\/)/,
    );
  }
});

it("shows each step's guide link", async () => {
  mocks.search = "t=admin&setting=setup&step=memory";
  setup();
  expect(
    await screen.findByRole("link", { name: "Read more in the guide: Memory" }),
  ).toHaveAttribute(
    "href",
    "/help/guide/08-for-administrators/policies#memory",
  );
});

it("the summary sorts steps by state and opens one", async () => {
  mocks.search = "t=admin&setting=setup&step=summary";
  mocks.get.mockResolvedValue({
    steps: {
      providers: { state: "done", at: 1 },
      usage: { state: "skipped", at: 1 },
    },
  });
  setup();
  const skipped = await screen.findByRole("list", { name: "Skipped (1)" });
  expect(skipped).toHaveTextContent("Usage time zone");
  expect(screen.getByRole("list", { name: "Reviewed (1)" })).toHaveTextContent(
    "Providers and models",
  );
  expect(
    screen.getByRole("list", {
      name: `Not reviewed (${SETUP_STEPS.length - 2})`,
    }),
  ).toHaveTextContent("Context compaction");
  await userEvent
    .setup()
    .click(within(skipped).getByRole("button", { name: "Usage time zone" }));
  expect(mocks.replace).toHaveBeenCalledWith(
    "/settings?t=admin&setting=setup&step=usage",
  );
});

it("ignores stored progress for steps setup no longer has (US-102.1)", async () => {
  mocks.search = "t=admin&setting=setup&step=summary";
  // Installations set up before EPIC-102 may have reviewed these.
  mocks.get.mockResolvedValue(
    stepped("providers", "theme_editor", "educators", "backup"),
  );
  setup();
  expect(
    await screen.findByRole("list", { name: "Reviewed (1)" }),
  ).toHaveTextContent("Providers and models");
  expect(screen.getByRole("status")).toHaveTextContent(
    `1 of ${SETUP_STEPS.length} steps reviewed`,
  );
  expect(SETUP_STEPS).toHaveLength(12);
  expect(
    screen.queryByRole("button", { name: /Theme|Educators|First backup/ }),
  ).toBeNull();
});

/** A pane with one field that reports its unsaved edits, as panes do. */
function DraftPane({
  save,
  blocked,
}: {
  save: () => Promise<unknown>;
  blocked?: (value: string) => string | undefined;
}) {
  const [value, setValue] = useState("");
  useSetupDraft({ dirty: value !== "", save, blocked: blocked?.(value) });
  return (
    <input
      aria-label="Group name"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

const recordsAs = () =>
  mocks.record.mockImplementation(
    async ({ path, body }: { path: { step_id: string }; body: object }) => ({
      steps: { ...stepped("providers").steps, [path.step_id]: body },
    }),
  );

describe("unsaved edits (US-102.3)", () => {
  it("Next saves the pane's edits, then records the step", async () => {
    recordsAs();
    const save = vi.fn().mockResolvedValue({});
    setup({ "group-settings": <DraftPane save={save} /> });
    const user = userEvent.setup();
    expect(await screen.findByRole("button", { name: "Next" })).toBeVisible();
    await user.type(screen.getByLabelText("Group name"), "Year 9");
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(save).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(mocks.record).toHaveBeenCalledWith(
        { path: { step_id: "group-settings" }, body: { state: "done" } },
        expect.anything(),
      ),
    );
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.record.mock.invocationCallOrder[0],
    );
  });

  it("a failed save keeps the step open and records nothing", async () => {
    const save = vi.fn().mockRejectedValue(new Error("nope"));
    setup({ "group-settings": <DraftPane save={save} /> });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Group name"), "Year 9");
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your changes could not be saved, so this step is still open.",
    );
    expect(mocks.record).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Group name")).toHaveValue("Year 9");
  });

  it("edits that can't be saved block Next and say why", async () => {
    const save = vi.fn();
    setup({
      "group-settings": (
        <DraftPane
          save={save}
          blocked={(value) =>
            value === "?" ? "Enter a real name." : undefined
          }
        />
      ),
    });
    await userEvent
      .setup()
      .type(await screen.findByLabelText("Group name"), "?");
    expect(
      screen.getByRole("button", { name: "Save and continue" }),
    ).toBeDisabled();
    expect(screen.getByText("Enter a real name.")).toBeVisible();
  });

  it("Skip asks before discarding edits; Cancel keeps them", async () => {
    recordsAs();
    const save = vi.fn();
    setup({ "group-settings": <DraftPane save={save} /> });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Group name"), "Year 9");
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Discard unsaved changes?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mocks.record).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Group name")).toHaveValue("Year 9");

    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    await user.click(
      within(
        await screen.findByRole("alertdialog", {
          name: "Discard unsaved changes?",
        }),
      ).getByRole("button", { name: "Discard changes" }),
    );
    await waitFor(() =>
      expect(mocks.record).toHaveBeenCalledWith(
        { path: { step_id: "group-settings" }, body: { state: "skipped" } },
        expect.anything(),
      ),
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("opening another step with edits asks first", async () => {
    setup({ "group-settings": <DraftPane save={vi.fn()} /> });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Group name"), "Year 9");
    await user.click(screen.getByRole("button", { name: /Memory/ }));
    expect(
      await screen.findByRole("alertdialog", {
        name: "Discard unsaved changes?",
      }),
    ).toBeVisible();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
