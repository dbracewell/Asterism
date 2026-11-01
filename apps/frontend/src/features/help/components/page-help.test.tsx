import { pageGuides } from "@/features/help/pages";
import { helpEntries } from "@/features/help/registry";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HelpAudienceProvider } from "./help-audience";
import { PageHelp } from "./page-help";

const route = vi.hoisted(() => ({ pathname: "/", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
}));

beforeEach(() => {
  route.pathname = "/";
  route.search = "";
});

function renderAt(
  pathname: string,
  search = "",
  {
    isAdmin = false,
    extra,
  }: { isAdmin?: boolean; extra?: React.ReactNode } = {},
) {
  route.pathname = pathname;
  route.search = search;
  return render(
    <HelpAudienceProvider isAdmin={isAdmin}>
      {extra}
      <PageHelp />
    </HelpAudienceProvider>,
  );
}

describe("PageHelp", () => {
  it("opens the current page's guide from the header button", async () => {
    const user = userEvent.setup();
    renderAt("/");
    const button = screen.getByRole("button", { name: "Help for this page" });
    expect(button).toHaveAttribute("aria-keyshortcuts", "?");
    await user.click(button);

    const sheet = screen.getByRole("dialog", { name: "Help: New chat" });
    const guide = pageGuides["new-chat"];
    expect(sheet).toHaveAccessibleDescription(guide.purpose);
    for (const area of guide.areas)
      expect(sheet).toHaveTextContent(area.description);
    expect(
      screen.getByRole("heading", { name: "Terms used here" }),
    ).toBeInTheDocument();
    expect(sheet).toHaveTextContent(helpEntries["concept.persona"].summary);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("links each term and the page guide into the help center", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(
      screen.getByRole("button", { name: "Help for this page" }),
    );
    for (const id of pageGuides["new-chat"].terms) {
      expect(
        screen.getByRole("link", {
          name: `Open ${helpEntries[id].title} in the help center`,
        }),
      ).toHaveAttribute("href", `/help#${id}`);
    }
    const center = screen.getByRole("link", { name: "Open the help center" });
    expect(center).toHaveAttribute("href", "/help#page-new-chat");
    await user.click(center);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("expands a term's details in place", async () => {
    const user = userEvent.setup();
    renderAt("/settings", "t=user&setting=personas");
    await user.click(
      screen.getByRole("button", { name: "Help for this page" }),
    );
    const more = screen.getByRole("button", {
      name: "Learn more about Persona",
    });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(helpEntries["concept.persona"].details[0]),
    ).toBeVisible();
  });

  it("opens with ? outside text fields", async () => {
    const user = userEvent.setup();
    renderAt("/projects");
    await user.keyboard("?");
    expect(
      screen.getByRole("dialog", { name: "Help: Projects" }),
    ).toBeInTheDocument();
  });

  it("leaves ? to text fields and comboboxes", async () => {
    const user = userEvent.setup();
    renderAt("/", "", {
      extra: (
        <>
          <textarea aria-label="Message" />
          <div
            role="combobox"
            aria-label="Model"
            aria-controls="model-list"
            aria-expanded={false}
            tabIndex={0}
          />
        </>
      ),
    });
    const message = screen.getByRole("textbox", { name: "Message" });
    await user.click(message);
    await user.keyboard("?");
    expect(message).toHaveValue("?");
    screen.getByRole("combobox", { name: "Model" }).focus();
    await user.keyboard("?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores ? with modifier keys", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.keyboard("{Control>}?{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nothing on pages without a guide", () => {
    renderAt("/e2e/help");
    expect(
      screen.queryByRole("button", { name: "Help for this page" }),
    ).not.toBeInTheDocument();
  });

  it("shows admin section guides to admins only", async () => {
    const user = userEvent.setup();
    renderAt("/settings", "t=admin&setting=tools", { isAdmin: true });
    await user.click(
      screen.getByRole("button", { name: "Help for this page" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Help: Tools" }),
    ).toHaveTextContent(helpEntries["admin.tools"].summary);
  });

  it("falls back to user guidance for non-admins on admin URLs", async () => {
    const user = userEvent.setup();
    renderAt("/settings", "t=admin&setting=tools");
    await user.click(
      screen.getByRole("button", { name: "Help for this page" }),
    );
    const sheet = screen.getByRole("dialog", {
      name: "Help: General settings",
    });
    expect(sheet).not.toHaveTextContent(helpEntries["admin.tools"].summary);
  });

  it.each([
    ["/", "project_id=p1", "/?project_id=p1&tour=first-chat"],
    ["/files", "", "/?tour=first-chat"],
  ])(
    "links %s to the chat tour and closes the sheet",
    async (pathname, search, href) => {
      const user = userEvent.setup();
      renderAt(pathname, search);
      await user.click(
        screen.getByRole("button", { name: "Help for this page" }),
      );
      const link = screen.getByRole("link", { name: "Take the chat tour" });
      expect(link).toHaveAttribute("href", href);
      await user.click(link);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );
});
