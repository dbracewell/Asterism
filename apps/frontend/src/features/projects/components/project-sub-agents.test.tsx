import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectSubAgents } from "./project-sub-agents";
const mocks = vi.hoisted(() => ({
  selected: vi.fn(),
  candidates: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  projectSubAgentGetManyOptions: (options: object) => ({
    queryKey: ["selected", options],
    queryFn: () => mocks.selected(options),
  }),
  projectSubAgentCandidatesOptions: (options: object) => ({
    queryKey: ["candidates", options],
    queryFn: () => mocks.candidates(options),
  }),
  chatModelsListOptions: () => ({
    queryKey: ["models"],
    queryFn: async () => [
      { id: "model", name: "Fixed", provider_name: "Provider" },
    ],
  }),
  projectSubAgentSelectManyMutation: () => ({ mutationFn: mocks.add }),
  projectSubAgentDeselectManyMutation: () => ({ mutationFn: mocks.remove }),
}));
const worker = {
  id: "worker",
  name: "Research",
  model_id: "model",
  model_available: true,
};
const page = {
  context_revision: 3,
  agents: [worker],
  total: 1,
  page: 1,
  page_size: 10,
};
function setup(projectId = "p") {
  const cache = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: () => {
        void cache.invalidateQueries();
      },
    }),
    defaultOptions: { queries: { retry: false } },
  });
  return {
    cache,
    ...render(
      <QueryClientProvider client={cache}>
        <ProjectSubAgents projectId={projectId} />
      </QueryClientProvider>,
    ),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.selected.mockResolvedValue({ ...page, agents: [], total: 0 });
  mocks.candidates.mockResolvedValue(page);
  mocks.add.mockResolvedValue({ context_revision: 4 });
  mocks.remove.mockResolvedValue({ context_revision: 5 });
});
it("starts with no selections and adds a worker using the observed project revision", async () => {
  setup();
  expect(await screen.findByText("No selected sub-agents")).toBeVisible();
  expect(screen.getByText("Fixed model: Fixed (Provider)")).toBeVisible();
  mocks.selected.mockResolvedValue({ ...page, context_revision: 4 });
  mocks.candidates.mockResolvedValue({
    ...page,
    agents: [],
    total: 0,
    context_revision: 4,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Select Research" }),
  );
  await screen.findByRole("button", { name: "Deselect Research" });
  expect(mocks.add.mock.calls[0][0]).toEqual({
    path: { project_id: "p" },
    body: { agent_ids: ["worker"], expected_context_revision: 3 },
  });
  mocks.selected.mockResolvedValue({
    ...page,
    agents: [],
    total: 0,
    context_revision: 5,
  });
  mocks.candidates.mockResolvedValue({ ...page, context_revision: 5 });
  await userEvent.click(
    screen.getByRole("button", { name: "Deselect Research" }),
  );
  await screen.findByText("No selected sub-agents");
  expect(mocks.remove.mock.calls[0][0].body.expected_context_revision).toBe(4);
});
it("retains selection on conflict until explicit reload and allows removing unavailable workers", async () => {
  mocks.selected.mockResolvedValue({
    ...page,
    agents: [{ ...worker, model_available: false }],
  });
  mocks.candidates.mockResolvedValue({ ...page, agents: [], total: 0 });
  mocks.remove.mockRejectedValueOnce({ detail: "Project changed" });
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Deselect Research" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Project changed");
  expect(
    screen.getByRole("button", { name: "Deselect Research" }),
  ).toBeDisabled();
  mocks.selected.mockResolvedValue({
    ...page,
    agents: [],
    total: 0,
    context_revision: 8,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Reload sub-agent selections" }),
  );
  expect(await screen.findByText("No selected sub-agents")).toBeVisible();
  expect(mocks.remove).toHaveBeenCalledTimes(1);
});
it("paginates candidates with project-local scope and blocks unavailable model additions", async () => {
  mocks.candidates.mockImplementation(async ({ query }) => ({
    ...page,
    total: 11,
    agents:
      query.page === 1
        ? [worker]
        : [{ ...worker, name: "Other", model_available: false }],
  }));
  setup("q");
  await userEvent.click(
    await screen.findByRole("button", { name: "Next available sub-agents" }),
  );
  expect(
    await screen.findByRole("button", { name: "Select Other" }),
  ).toBeDisabled();
  expect(mocks.candidates.mock.calls.at(-1)?.[0]).toEqual({
    client: {},
    path: { project_id: "q" },
    query: { page: 2, page_size: 10 },
  });
  expect(
    within(
      screen.getByRole("region", { name: "Available sub-agents" }),
    ).getByText("Model unavailable"),
  ).toBeVisible();
});
it("distinguishes query failure from empty and recovers with retry", async () => {
  mocks.candidates.mockRejectedValueOnce({ detail: "Denied" });
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load available sub-agents",
  );
  expect(
    screen.queryByText("No more sub-agents to select"),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("button", { name: "Select Research" }),
  ).toBeEnabled();
});

it("retains cached selections after refresh failure while disabling changes", async () => {
  mocks.selected.mockResolvedValue(page);
  mocks.candidates.mockResolvedValue({ ...page, agents: [], total: 0 });
  const { cache } = setup();
  await screen.findByRole("button", { name: "Deselect Research" });
  mocks.selected.mockRejectedValue({ detail: "Offline" });
  await cache.invalidateQueries({ queryKey: ["selected"] });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Saved selections are shown",
  );
  expect(
    screen.getByRole("button", { name: "Deselect Research" }),
  ).toBeDisabled();
  expect(screen.getByText("Fixed model: Fixed (Provider)")).toBeVisible();
});
