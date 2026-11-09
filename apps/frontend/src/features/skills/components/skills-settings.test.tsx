import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import { SkillsSettings } from "./skills-settings";
import { MainAgentSkills } from "./main-agent-skills";

const mocks = vi.hoisted(() => ({
  owner: "a",
  list: vi.fn(),
  detail: vi.fn(),
  eligible: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  assignments: vi.fn(),
  saveAssignments: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: mocks.owner }),
}));
vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => ({ currentThemeType: "light", fontSize: "16px" }),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => {
  const key = (_id: string, options?: object) => [{ _id, ...options }];
  return {
    skillGetManyOptions: ({ query }: { query: object }) => ({
      queryKey: key("skillGetMany", { query }),
      queryFn: () => mocks.list(query),
    }),
    skillGetOneOptions: ({ path }: { path: object }) => ({
      queryKey: key("skillGetOne", { path }),
      queryFn: () => mocks.detail(path),
    }),
    skillEligibleGetManyOptions: () => ({
      queryKey: key("skillEligibleGetMany"),
      queryFn: mocks.eligible,
    }),
    mainAgentSkillsGetOptions: () => ({
      queryKey: key("mainAgentSkillsGet"),
      queryFn: mocks.assignments,
    }),
    skillGetManyQueryKey: () => key("skillGetMany"),
    skillGetOneQueryKey: (options: object) => key("skillGetOne", options),
    skillEligibleGetManyQueryKey: () => key("skillEligibleGetMany"),
    mainAgentSkillsGetQueryKey: () => key("mainAgentSkillsGet"),
    mainAgentGetQueryKey: () => key("mainAgentGet"),
    skillCreateMutation: () => ({ mutationFn: mocks.create }),
    skillUpdateMutation: () => ({ mutationFn: mocks.update }),
    skillDeleteMutation: () => ({ mutationFn: mocks.remove }),
    mainAgentSkillsUpdateMutation: () => ({
      mutationFn: mocks.saveAssignments,
    }),
    // "Describe it" (US-71.2) is covered in skill-describe.test.tsx.
    skillDraftGetOneOptions: ({ path }: { path: object }) => ({
      queryKey: key("skillDraftGetOne", { path }),
      queryFn: vi.fn(),
    }),
    skillDraftCreateMutation: () => ({ mutationFn: vi.fn() }),
    chatMessageSendMutation: () => ({ mutationFn: vi.fn() }),
    chatSessionDeleteMutation: () => ({ mutationFn: vi.fn() }),
    chatModelsListOptions: () => ({
      queryKey: key("chatModelsList"),
      queryFn: async () => [],
    }),
  };
});
vi.mock("@/lib/auth-client", () => ({ authClient: { token: vi.fn() } }));

const source =
  "---\nname: review-code\ndescription: Review code.\n---\n# Review\nCheck the edge cases.";
const skill = {
  id: "s1",
  name: "review-code",
  description: "Review code.",
  content: source,
  revision: 1,
  created_at: 1,
  updated_at: 1,
};
let rows = [skill];
let cache: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={cache}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.owner = "a";
  rows = [skill];
  for (const fn of [
    mocks.list,
    mocks.detail,
    mocks.eligible,
    mocks.create,
    mocks.update,
    mocks.remove,
    mocks.assignments,
    mocks.saveAssignments,
  ])
    fn.mockReset();
  mocks.list.mockImplementation(async () => ({
    items: [...rows],
    total: rows.length,
    page: 1,
    page_size: 10,
  }));
  mocks.detail.mockResolvedValue(skill);
  mocks.eligible.mockResolvedValue({
    items: [],
    total: 0,
    policy_enabled: false,
  });
  mocks.assignments.mockResolvedValue({ skill_ids: ["s1"], revision: 4 });
  mocks.saveAssignments.mockImplementation(async ({ body }) => ({
    skill_ids: body.skill_ids,
    revision: 5,
  }));
  cache = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_d, _v, _c, mutation) =>
        handleMutationSuccess(cache, mutation),
    }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

it("shows initial failure instead of a false empty list and retries", async () => {
  mocks.list.mockRejectedValue({ detail: "Offline" });
  render(<SkillsSettings />, { wrapper: Wrapper });
  await screen.findByText("Could not load skills.");
  expect(screen.queryByText("No skills yet")).not.toBeInTheDocument();
  mocks.list.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 });
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("No skills yet");
});

it("creates from source, renders a safe preview, and refreshes through shared invalidation", async () => {
  rows = [];
  mocks.create.mockImplementation(async ({ body }) => {
    const made = { ...skill, content: body.content };
    rows = [made];
    return made;
  });
  render(<SkillsSettings />, { wrapper: Wrapper });
  await userEvent.click(screen.getByRole("button", { name: "New skill" }));
  const unsafe =
    source +
    "\n<script>evil()</script>\n![beacon](https://untrusted.test/beacon)\n[bad](javascript:evil())";
  fireEvent.change(screen.getByRole("textbox", { name: "SKILL.md source" }), {
    target: { value: unsafe },
  });
  await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
  const preview = screen.getByRole("region", { name: "Skill preview" });
  expect(preview.querySelector("script,img,iframe,style")).toBeNull();
  expect(preview.querySelector('[href^="javascript:"]')).toBeNull();
  expect(
    within(preview).getByRole("heading", { name: "Review" }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Save skill" }));
  await screen.findByRole("button", { name: "View or edit review-code" });
  expect(mocks.create).toHaveBeenCalledWith(
    { body: { content: unsafe } },
    expect.anything(),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("retains invalid source after a save failure", async () => {
  mocks.create.mockRejectedValue({ detail: "Skill name must be lowercase" });
  render(<SkillsSettings />, { wrapper: Wrapper });
  await userEvent.click(screen.getByRole("button", { name: "New skill" }));
  const invalid = source.replace("review-code", "Bad_Name");
  fireEvent.change(screen.getByRole("textbox", { name: "SKILL.md source" }), {
    target: { value: invalid },
  });
  await userEvent.click(screen.getByRole("button", { name: "Save skill" }));
  await screen.findByText("Skill name must be lowercase");
  expect(screen.getByRole("textbox", { name: "SKILL.md source" })).toHaveValue(
    invalid,
  );
});

it("preserves a draft through cached refresh failure and newer revisions until explicit reload", async () => {
  render(<SkillsSettings />, { wrapper: Wrapper });
  await userEvent.click(
    await screen.findByRole("button", { name: "View or edit review-code" }),
  );
  await userEvent.click(await screen.findByRole("tab", { name: "Source" }));
  const draft = source + "\nMy unsaved work";
  fireEvent.change(screen.getByRole("textbox", { name: "SKILL.md source" }), {
    target: { value: draft },
  });
  mocks.detail.mockRejectedValue({ detail: "Refresh offline" });
  await act(async () => {
    await cache.invalidateQueries({ queryKey: [{ _id: "skillGetOne" }] });
  });
  await screen.findByText(
    "Could not refresh this skill. Your draft is retained.",
  );
  expect(screen.getByRole("textbox", { name: "SKILL.md source" })).toHaveValue(
    draft,
  );
  const updated = {
    ...skill,
    revision: 2,
    content: source + "\nNew server content",
  };
  mocks.detail.mockResolvedValue(updated);
  await act(async () => {
    await cache.invalidateQueries({ queryKey: [{ _id: "skillGetOne" }] });
  });
  await screen.findByText(/A newer revision is available/);
  expect(screen.getByRole("button", { name: "Save skill" })).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Reload current skill" }),
  );
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Discard changes",
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "SKILL.md source" }),
    ).toHaveValue(updated.content),
  );
  mocks.update.mockResolvedValue({ ...updated, revision: 3 });
  fireEvent.change(screen.getByRole("textbox", { name: "SKILL.md source" }), {
    target: { value: updated.content + "\nEdited" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Save skill" }));
  await waitFor(() =>
    expect(mocks.update).toHaveBeenCalledWith(
      {
        path: { skill_id: "s1" },
        body: { content: updated.content + "\nEdited", expected_revision: 2 },
      },
      expect.anything(),
    ),
  );
});

it("requires deletion confirmation and uses the loaded revision", async () => {
  mocks.remove.mockImplementation(async () => {
    rows = [];
  });
  render(<SkillsSettings />, { wrapper: Wrapper });
  await userEvent.click(
    await screen.findByRole("button", { name: "View or edit review-code" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Delete skill" }),
  );
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Cancel",
    }),
  );
  expect(mocks.remove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Delete skill" }));
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Delete skill",
    }),
  );
  await screen.findByText("No skills yet");
  expect(mocks.remove).toHaveBeenCalledWith(
    { path: { skill_id: "s1" }, query: { expected_revision: 1 } },
    expect.anything(),
  );
});

it("keeps off-page assignments while policy is disabled and saves only the assignment contract", async () => {
  mocks.list.mockImplementation(async ({ page }) => ({
    items: [
      {
        ...skill,
        id: page === 1 ? "s1" : "s2",
        name: page === 1 ? "review-code" : "other-skill",
      },
    ],
    total: 11,
    page,
    page_size: 10,
  }));
  render(<MainAgentSkills owner="a" />, { wrapper: Wrapper });
  await userEvent.click(
    screen.getByRole("button", { name: "Manage main-agent skills" }),
  );
  await screen.findByText("Skill activation disabled by administrator");
  await userEvent.click(screen.getByRole("button", { name: "Next skills" }));
  await userEvent.click(
    await screen.findByRole("checkbox", { name: /other-skill/ }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save assignments" }),
  );
  await waitFor(() =>
    expect(mocks.saveAssignments).toHaveBeenCalledWith(
      { body: { skill_ids: ["s1", "s2"], expected_revision: 4 } },
      expect.anything(),
    ),
  );
});

it("retains pending assignment selections on conflict until reload is confirmed", async () => {
  mocks.assignments.mockResolvedValue({ skill_ids: [], revision: 4 });
  render(<MainAgentSkills owner="a" />, { wrapper: Wrapper });
  await userEvent.click(
    screen.getByRole("button", { name: "Manage main-agent skills" }),
  );
  await userEvent.click(
    await screen.findByRole("checkbox", { name: /review-code/ }),
  );
  mocks.assignments.mockResolvedValue({ skill_ids: [], revision: 5 });
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: [{ _id: "mainAgentSkillsGet" }],
    });
  });
  await screen.findByText(/Main-agent settings or assignments changed/);
  expect(screen.getByRole("checkbox", { name: /review-code/ })).toBeChecked();
  expect(
    screen.getByRole("button", { name: "Save assignments" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Reload current assignments" }),
  );
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Discard changes",
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: /review-code/ }),
    ).not.toBeChecked(),
  );
});

it("does not show a previous owner's cached skill list while the new owner is loading", async () => {
  const view = render(<SkillsSettings />, { wrapper: Wrapper });
  await screen.findByRole("button", { name: "View or edit review-code" });
  mocks.owner = "b";
  mocks.list.mockImplementation(() => new Promise(() => {}));
  view.rerender(<SkillsSettings />);
  expect(
    screen.queryByRole("button", { name: "View or edit review-code" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Loading skills…")).toBeInTheDocument();
});

it("adopts a newer detail revision in a pristine editor before deletion", async () => {
  render(<SkillsSettings />, { wrapper: Wrapper });
  await userEvent.click(
    await screen.findByRole("button", { name: "View or edit review-code" }),
  );
  await screen.findByRole("tab", { name: "Preview" });
  mocks.detail.mockResolvedValue({
    ...skill,
    revision: 2,
    name: "updated-name",
    content: source.replace("review-code", "updated-name"),
  });
  await act(async () => {
    await cache.invalidateQueries({ queryKey: [{ _id: "skillGetOne" }] });
  });
  await screen.findByRole("heading", { name: "updated-name" });
  mocks.remove.mockImplementation(async () => {
    rows = [];
  });
  await userEvent.click(screen.getByRole("button", { name: "Delete skill" }));
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Delete skill",
    }),
  );
  await screen.findByText("No skills yet");
  expect(mocks.remove).toHaveBeenCalledWith(
    { path: { skill_id: "s1" }, query: { expected_revision: 2 } },
    expect.anything(),
  );
});

it("closes an assignment draft when the authenticated owner changes", async () => {
  const view = render(<MainAgentSkills owner="a" />, { wrapper: Wrapper });
  await userEvent.click(
    screen.getByRole("button", { name: "Manage main-agent skills" }),
  );
  await userEvent.click(
    await screen.findByRole("checkbox", { name: /review-code/ }),
  );
  view.rerender(<MainAgentSkills owner="b" />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  mocks.assignments.mockResolvedValue({ skill_ids: [], revision: 1 });
  await userEvent.click(
    screen.getByRole("button", { name: "Manage main-agent skills" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: /review-code/ }),
    ).not.toBeChecked(),
  );
  expect(
    screen.getByRole("button", { name: "Save assignments" }),
  ).toBeDisabled();
});

it("assigns and unassigns from each skill row against the loaded revision, in sync with the Agents dialog (US-75.2)", async () => {
  rows = [skill, { ...skill, id: "s2", name: "write-tests" }];
  render(
    <>
      <SkillsSettings />
      <MainAgentSkills owner="a" />
    </>,
    { wrapper: Wrapper },
  );
  const reviewSwitch = await screen.findByRole("switch", {
    name: "review-code assigned to main agent",
  });
  await waitFor(() => expect(reviewSwitch).toBeChecked());
  expect(screen.getByText(/1 of 100 assigned/)).toBeVisible();
  const testsSwitch = screen.getByRole("switch", {
    name: "write-tests assigned to main agent",
  });
  expect(testsSwitch).not.toBeChecked();
  mocks.assignments.mockResolvedValue({ skill_ids: ["s1", "s2"], revision: 5 });
  await userEvent.click(testsSwitch);
  expect(mocks.saveAssignments).toHaveBeenCalledWith(
    { body: { skill_ids: ["s1", "s2"], expected_revision: 4 } },
    expect.anything(),
  );
  await waitFor(() => expect(testsSwitch).toBeChecked());
  expect(screen.getByText(/2 of 100 assigned/)).toBeVisible();

  // The Agents dialog reads the same assignments.
  await userEvent.click(
    screen.getByRole("button", { name: "Manage main-agent skills" }),
  );
  const dialog = await screen.findByRole("dialog");
  await waitFor(() =>
    expect(
      within(dialog).getByRole("checkbox", { name: /write-tests/ }),
    ).toBeChecked(),
  );
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

  // Unassigning sends the new set with the latest revision.
  await userEvent.click(reviewSwitch);
  expect(mocks.saveAssignments).toHaveBeenLastCalledWith(
    { body: { skill_ids: ["s2"], expected_revision: 5 } },
    expect.anything(),
  );
});

it("reloads current assignments when a row change conflicts (US-75.2)", async () => {
  render(<SkillsSettings />, { wrapper: Wrapper });
  const reviewSwitch = await screen.findByRole("switch", {
    name: "review-code assigned to main agent",
  });
  await waitFor(() => expect(reviewSwitch).toBeChecked());
  mocks.saveAssignments.mockRejectedValue({
    detail: "Main agent changed; reload before assigning skills",
  });
  mocks.assignments.mockResolvedValue({ skill_ids: ["s1"], revision: 9 });
  await userEvent.click(reviewSwitch);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Main agent changed",
  );
  await waitFor(() => expect(reviewSwitch).toBeChecked());
  expect(mocks.assignments).toHaveBeenCalledTimes(2);
  mocks.saveAssignments.mockResolvedValue({ skill_ids: [], revision: 10 });
  await userEvent.click(reviewSwitch);
  expect(mocks.saveAssignments).toHaveBeenLastCalledWith(
    { body: { skill_ids: [], expected_revision: 9 } },
    expect.anything(),
  );
});

it("pages through skills with a count and page size kept in the URL (US-75.2)", async () => {
  window.history.replaceState(
    null,
    "",
    "/settings?t=user&setting=skills&skills_q=re&skills_page=2",
  );
  mocks.list.mockImplementation(
    async ({ page, page_size }: { page: number; page_size: number }) => ({
      items: [{ ...skill, id: `s${page}`, name: `skill-${page}` }],
      total: 34,
      page,
      page_size,
    }),
  );
  render(<SkillsSettings />, { wrapper: Wrapper });
  expect(await screen.findByText("11–20 of 34")).toBeVisible();
  expect(screen.getByLabelText("Search skills")).toHaveValue("re");
  expect(mocks.list).toHaveBeenLastCalledWith({
    query: "re",
    page: 2,
    page_size: 10,
  });
  await userEvent.click(screen.getByRole("button", { name: "Next skills" }));
  expect(await screen.findByText("21–30 of 34")).toBeVisible();
  expect(new URLSearchParams(window.location.search).get("skills_page")).toBe(
    "3",
  );

  await userEvent.click(screen.getByRole("combobox", { name: "Per page" }));
  await userEvent.click(await screen.findByRole("option", { name: "25" }));
  expect(await screen.findByText("1–25 of 34")).toBeVisible();
  const params = new URLSearchParams(window.location.search);
  expect(params.get("skills_size")).toBe("25");
  expect(params.get("skills_page")).toBeNull();
  expect(params.get("setting")).toBe("skills");

  await userEvent.clear(screen.getByLabelText("Search skills"));
  expect(
    new URLSearchParams(window.location.search).get("skills_q"),
  ).toBeNull();
  window.history.replaceState(null, "", "/");
});
