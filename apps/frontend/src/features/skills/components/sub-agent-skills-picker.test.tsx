import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { turnOff } from "@/test/availability";
import { SubAgentSkillsPicker } from "./sub-agent-skills-picker";

// EPIC-97: while the admin has skills off, the picker shows only for a
// sub-agent that already has skills.
vi.mock("@/features/availability/queries", () => import("@/test/availability"));
vi.mock("@/features/help/components/help-topic", () => ({
  HelpTopic: () => null,
}));
vi.mock("../queries", () => ({
  skillsListOptions: () => ({
    queryKey: ["skills"],
    queryFn: async () => ({
      items: [
        {
          id: "s1",
          name: "review",
          description: "Review carefully",
          revision: 1,
          created_at: 1,
          updated_at: 1,
        },
      ],
      total: 1,
      page: 1,
      page_size: 10,
    }),
  }),
}));

function show(selected: string[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SubAgentSkillsPicker owner="a" selected={selected} onChange={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => turnOff());

it("offers skills while the admin allows them", async () => {
  show([]);
  expect(await screen.findByText("Find skills")).toBeInTheDocument();
  expect(screen.queryByRole("note")).toBeNull();
});

it("is hidden while skills are off and the sub-agent has none", () => {
  turnOff("skills");
  show([]);
  expect(screen.queryByText("Find skills")).toBeNull();
});

it("keeps a sub-agent's skills reachable while skills are off", () => {
  turnOff("skills");
  show(["s1"]);
  expect(screen.getByRole("note")).toHaveTextContent(
    "An administrator has turned skills off",
  );
});
