import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { useUserSettingsSections } from "./index";

// EPIC-97: User Settings leaves out a section whose feature is off for this
// person, unless they have something saved there.
const mocks = vi.hoisted(() => ({
  features: { skills: false, chatgpt_plans: false } as Record<string, boolean>,
  savedSkills: 0,
  connection: null as string | null,
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: "a" }),
}));
vi.mock("@/features/availability/queries", () => ({
  useFeature: (feature: string) => ({
    available: mocks.features[feature] ?? false,
    reason: "",
  }),
}));
vi.mock("@/features/skills/queries", () => ({
  skillsListOptions: () => ({
    queryKey: ["skills"],
    queryFn: async () => ({ items: [], total: mocks.savedSkills }),
  }),
}));
vi.mock("@/features/chatgpt/queries", () => ({
  chatgptConnectionOptions: () => ({
    queryKey: ["chatgpt"],
    queryFn: async () => ({ policy_enabled: false, status: mocks.connection }),
  }),
}));
// The panes themselves are not rendered by the hook.
vi.mock("@/features/settings/ui/user-settings/agents-settings", () => ({
  AgentsSettings: () => null,
}));
vi.mock("@/features/settings/ui/user-settings/general-settings", () => ({
  GeneralSettings: () => null,
}));
vi.mock("@/features/chatgpt/components/chatgpt-connection-settings", () => ({
  ChatGptConnectionSettings: () => null,
}));
vi.mock("@/features/skills/components/skills-settings", () => ({
  SkillsSettings: () => null,
}));
vi.mock("@/features/templates/components/templates-settings", () => ({
  TemplatesSettings: () => null,
}));
vi.mock("@/features/templates/components/rubrics-settings", () => ({
  RubricsSettings: () => null,
}));
vi.mock("./your-asterism-settings", () => ({
  YourAsterismSettings: () => null,
}));

function sections() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useUserSettingsSections().flatMap((section) =>
        section.type === "section" ? [section.value] : [],
      ),
    { wrapper },
  );
}

beforeEach(() => {
  mocks.features = { skills: false, chatgpt_plans: false };
  mocks.savedSkills = 0;
  mocks.connection = null;
});

it("leaves out Skills and ChatGPT while they are off and nothing is saved", async () => {
  const { result } = sections();
  await waitFor(() =>
    expect(result.current).toEqual([
      "general",
      "your-asterism",
      "templates",
      "rubrics",
      "agents",
    ]),
  );
});

it("shows each section the admin allows", () => {
  mocks.features = { skills: true, chatgpt_plans: true };
  const { result } = sections();
  expect(result.current).toContain("skills");
  expect(result.current).toContain("chatgpt");
});

it("keeps a section the person has something saved in", async () => {
  mocks.savedSkills = 2;
  mocks.connection = "connected";
  const { result } = sections();
  await waitFor(() => expect(result.current).toContain("skills"));
  expect(result.current).toContain("chatgpt");
});
