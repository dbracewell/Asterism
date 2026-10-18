import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";
import { MobileSidebarTrigger } from "./mobile-sidebar-trigger";

const route = vi.hoisted(() => ({ pathname: "/projects" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => route.pathname,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));

function Shell() {
  return (
    <SidebarProvider>
      <Sidebar>
        <Link href="/files">Files</Link>
      </Sidebar>
      <MobileSidebarTrigger />
    </SidebarProvider>
  );
}
describe("mobile sidebar interactions", () => {
  beforeEach(() => {
    route.pathname = "/projects";
  });
  it("toggles once when a touch is followed by the synthesized click", async () => {
    render(<Shell />);
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    fireEvent.touchEnd(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Sidebar" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });
  it("opens with the keyboard and closes after navigation", async () => {
    const view = render(<Shell />);
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Sidebar" })).toBeVisible();
    route.pathname = "/files";
    view.rerender(<Shell />);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
