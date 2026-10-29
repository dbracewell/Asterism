import { SidebarProvider } from "@/components/ui/sidebar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { NavWorkspaces } from "./nav-workspaces";

const mocks = vi.hoisted(() => ({ pathname: "/projects/p1" }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/features/dashboard/components/nav-chat-sessions", () => ({
  NavChatSessions: () => null,
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatSessionGetOneOptions: () => ({ queryKey: ["chat"], queryFn: vi.fn() }),
  projectGetManyOptions: () => ({
    queryKey: ["projects"],
    queryFn: async () => ({
      projects: [
        { id: "p1", name: "Research", accent: "teal" },
        { id: "p2", name: "Plain", accent: null },
      ],
      total: 2,
    }),
  }),
}));

beforeEach(() => {
  mocks.pathname = "/projects/p1";
});

function setup() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <NavWorkspaces defaultProjectsOpen />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

it("marks the active project and shows its accent beside the name", async () => {
  setup();
  const active = await screen.findByRole("link", { name: "Research" });
  expect(active).toHaveAttribute("data-active", "true");
  expect(active).toHaveAttribute("aria-current", "page");
  expect(active.querySelector('[data-accent="teal"]')).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  const plain = screen.getByRole("link", { name: "Plain" });
  expect(plain).toHaveAttribute("data-active", "false");
  expect(plain).not.toHaveAttribute("aria-current");
  expect(plain.querySelector("[data-accent]")).toBeNull();
});

it("keeps the Projects row unselected while a project is active", async () => {
  setup();
  await screen.findByRole("link", { name: "Research" });
  const row = screen.getByRole("link", { name: "Projects" }).parentElement!;
  expect(row).toHaveAttribute("data-active", "false");
});

it("selects the Projects row on the project list", async () => {
  mocks.pathname = "/projects";
  setup();
  const projects = within(
    screen.getByRole("link", { name: "Projects" }).parentElement!,
  );
  expect(projects.getByRole("link", { name: "Projects" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(
    (await screen.findByRole("link", { name: "Research" })).dataset.active,
  ).toBe("false");
});
