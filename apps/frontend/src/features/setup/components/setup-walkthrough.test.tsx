import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SETUP_STEPS } from "../walkthrough";
import { SetupWalkthrough } from "./setup-walkthrough";

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

function setup() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({}),
  });
  render(
    <QueryClientProvider client={cache}>
      <SetupWalkthrough panes={panes} />
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
    screen.getByRole("button", { name: /Providers and models.*Done/ }),
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
});
