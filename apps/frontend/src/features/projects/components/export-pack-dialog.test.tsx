import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExportPackDialog } from "./export-pack-dialog";

const mocks = vi.hoisted(() => ({
  agents: vi.fn(),
  skills: vi.fn(),
  templates: vi.fn(),
  rubrics: vi.fn(),
  exportPack: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  projectSubAgentGetManyOptions: () => ({
    queryKey: ["agents"],
    queryFn: mocks.agents,
  }),
  skillGetManyOptions: () => ({ queryKey: ["skills"], queryFn: mocks.skills }),
  promptTemplateGetManyOptions: () => ({
    queryKey: ["templates"],
    queryFn: mocks.templates,
  }),
  rubricGetManyOptions: () => ({
    queryKey: ["rubrics"],
    queryFn: mocks.rubrics,
  }),
  projectPackExportMutation: () => ({ mutationFn: mocks.exportPack }),
}));

const page = (items: object[], total = items.length) => ({ items, total });
const pack = { pack: { id: "research", version: "1.0.0" } };

function setup() {
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ExportPackDialog
        projectId="p"
        projectName="Research"
        open
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agents.mockResolvedValue({
    agents: [{ id: "agent", name: "Critic" }],
    total: 1,
  });
  mocks.skills.mockResolvedValue(page([{ id: "skill", name: "cite" }]));
  mocks.templates.mockResolvedValue(page([{ id: "tpl", name: "Summary" }]));
  mocks.rubrics.mockResolvedValue(page([]));
  mocks.exportPack.mockResolvedValue(pack);
  URL.createObjectURL = vi.fn(() => "blob:pack");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

it("starts with nothing chosen and cannot download an empty pack", async () => {
  setup();
  const agent = await screen.findByRole("checkbox", { name: "Critic" });
  expect(agent).not.toBeChecked();
  expect(
    screen.getByRole("button", { name: "Help: Team pack" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download pack" })).toBeDisabled();
});

it("sends only the chosen items and downloads the pack", async () => {
  const user = userEvent.setup();
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const { onOpenChange } = setup();
  await user.click(await screen.findByRole("checkbox", { name: "Critic" }));
  await user.click(await screen.findByRole("checkbox", { name: "Summary" }));
  await user.click(screen.getByRole("checkbox", { name: /Project settings/ }));
  await user.click(screen.getByRole("button", { name: "Download pack" }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(mocks.exportPack.mock.calls[0][0]).toEqual({
    path: { project_id: "p" },
    body: {
      name: "Research",
      description: "",
      sub_agent_ids: ["agent"],
      skill_ids: [],
      template_ids: ["tpl"],
      rubric_ids: [],
      include_project_settings: true,
    },
  });
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
});

it("shows why the server refused and keeps the dialog open", async () => {
  const user = userEvent.setup();
  mocks.exportPack.mockRejectedValue({
    detail: "Pack text at $.skills[0].content looks like a credential",
  });
  const { onOpenChange } = setup();
  await user.click(await screen.findByRole("checkbox", { name: "cite" }));
  await user.click(screen.getByRole("button", { name: "Download pack" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "looks like a credential",
  );
  expect(onOpenChange).not.toHaveBeenCalled();
});

it("requires a pack name", async () => {
  const user = userEvent.setup();
  setup();
  await user.click(await screen.findByRole("checkbox", { name: "Critic" }));
  await user.clear(screen.getByLabelText("Pack name"));
  expect(screen.getByRole("button", { name: "Download pack" })).toBeDisabled();
});

it("stops at the pack limit and says when a list is cut off", async () => {
  const user = userEvent.setup();
  const agents = Array.from({ length: 17 }, (_, index) => ({
    id: `agent-${index}`,
    name: `Agent ${index}`,
  }));
  mocks.agents.mockResolvedValue({ agents, total: 140 });
  setup();
  const list = await screen.findByRole("region", { name: "Sub-agents" });
  await within(list).findByRole("checkbox", { name: "Agent 0" });
  for (const agent of agents.slice(0, 16))
    await user.click(within(list).getByRole("checkbox", { name: agent.name }));
  expect(
    within(list).getByRole("checkbox", { name: "Agent 16" }),
  ).toBeDisabled();
  expect(list).toHaveTextContent("A pack can hold 16 sub-agents.");
  expect(list).toHaveTextContent("Showing the first 17 of 140.");
});
