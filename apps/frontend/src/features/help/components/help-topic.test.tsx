import { HelpIcon } from "@/components/help-icon";
import { helpEntries } from "@/features/help/registry";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HelpAudienceProvider } from "./help-audience";
import { HelpTopic } from "./help-topic";

const persona = helpEntries["concept.persona"];

describe("HelpTopic", () => {
  it("opens from the keyboard and returns focus on Escape", async () => {
    const user = userEvent.setup();
    render(<HelpTopic id="concept.persona" />);

    await user.tab();
    const trigger = screen.getByRole("button", { name: "Help: Persona" });
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");

    const dialog = screen.getByRole("dialog", { name: "Help: Persona" });
    expect(dialog).toHaveTextContent(persona.summary);
    expect(dialog).not.toHaveTextContent(persona.details[0]);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("opens with a tap or click and expands details on Learn more", async () => {
    const user = userEvent.setup();
    render(<HelpTopic id="concept.persona" />);

    await user.click(screen.getByRole("button", { name: "Help: Persona" }));
    const more = screen.getByRole("button", { name: "Learn more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);

    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    for (const paragraph of persona.details) {
      expect(screen.getByText(paragraph)).toBeInTheDocument();
    }
  });

  it("links the current entry to the help center and closes on follow", async () => {
    const user = userEvent.setup();
    render(<HelpTopic id="concept.persona" />);
    await user.click(screen.getByRole("button", { name: "Help: Persona" }));
    const link = screen.getByRole("link", { name: "Open in help center" });
    expect(link).toHaveAttribute("href", "/help#concept.persona");

    // The link follows related navigation inside the popover.
    await user.click(screen.getByRole("button", { name: "Skill" }));
    const skillLink = screen.getByRole("link", { name: "Open in help center" });
    expect(skillLink).toHaveAttribute("href", "/help#concept.skill");
    await user.click(skillLink);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("follows related terms and comes back", async () => {
    const user = userEvent.setup();
    render(<HelpTopic id="concept.persona" />);
    await user.click(screen.getByRole("button", { name: "Help: Persona" }));

    await user.click(
      screen.getByRole("button", { name: helpEntries["concept.skill"].title }),
    );
    expect(screen.getByRole("heading", { name: "Skill" })).toBeInTheDocument();
    expect(
      screen.getByText(helpEntries["concept.skill"].summary),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("heading", { name: "Persona" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("restarts at its own entry when reopened", async () => {
    const user = userEvent.setup();
    render(<HelpTopic id="concept.persona" />);
    const trigger = screen.getByRole("button", { name: "Help: Persona" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Skill" }));
    await user.keyboard("{Escape}");
    await user.click(trigger);
    expect(
      screen.getByRole("heading", { name: "Persona" }),
    ).toBeInTheDocument();
  });

  it("hides admin-only entries and links from non-admins", async () => {
    const user = userEvent.setup();
    const { container } = render(<HelpTopic id="admin.tools" />);
    expect(container).toBeEmptyDOMElement();

    render(<HelpTopic id="concept.tool-approval" />);
    await user.click(
      screen.getByRole("button", { name: "Help: Tool approval" }),
    );
    expect(
      screen.queryByRole("button", { name: "Tool policy" }),
    ).not.toBeInTheDocument();
  });

  it("shows admin-only entries to admins", async () => {
    const user = userEvent.setup();
    render(
      <HelpAudienceProvider isAdmin>
        <HelpTopic id="admin.tools" />
      </HelpAudienceProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Help: Tool policy" }));
    expect(
      screen.getByText(helpEntries["admin.tools"].summary),
    ).toBeInTheDocument();
  });
});

describe("HelpIcon", () => {
  it("is a focusable button that shows its text without hover", async () => {
    const user = userEvent.setup();
    render(<HelpIcon label="About clock" text="Reads the current time." />);
    await user.tab();
    const trigger = screen.getByRole("button", { name: "About clock" });
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Reads the current time.")).toBeVisible();
  });
});
