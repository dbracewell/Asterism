import { helpCenterHref } from "@/features/help/center";
import { helpEntries, type HelpId } from "@/features/help/registry";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HelpAudienceProvider } from "./help-audience";
import { HelpCenter } from "./help-center";

function renderCenter(isAdmin = false) {
  return render(
    <HelpAudienceProvider isAdmin={isAdmin}>
      <HelpCenter />
    </HelpAudienceProvider>,
  );
}

const ids = Object.keys(helpEntries) as HelpId[];

describe("HelpCenter", () => {
  it("renders an anchor for every visible entry, titled for its entry", () => {
    const { container } = renderCenter(true);
    for (const id of ids) {
      const anchor = container.ownerDocument.getElementById(
        helpCenterHref(id).split("#")[1],
      );
      expect(anchor, id).not.toBeNull();
      expect(anchor).toHaveAccessibleName(helpEntries[id].title);
      expect(anchor).toHaveAttribute("tabindex", "-1");
    }
  });

  it("hides admin-only help from other users", () => {
    renderCenter(false);
    expect(document.getElementById("admin.tools")).toBeNull();
    expect(document.getElementById("page-admin.tools")).toBeNull();
    expect(screen.queryByText("Admins only")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Tool policy" }),
    ).not.toBeInTheDocument();
  });

  it("filters as the learner types and offers to clear an empty search", async () => {
    const user = userEvent.setup();
    renderCenter();
    const search = screen.getByRole("searchbox", { name: "Search help" });

    await user.type(search, "persona");
    expect(document.getElementById("concept.persona")).not.toBeNull();
    expect(document.getElementById("concept.citation")).toBeNull();
    expect(screen.getByText(/^\d+ results?$/)).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "qqqqzzzz");
    expect(screen.getByText("No help matches your search")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(document.getElementById("concept.citation")).not.toBeNull();
  });

  it("links related terms to their anchors and clears a search that hides them", async () => {
    const user = userEvent.setup();
    renderCenter();
    await user.type(
      screen.getByRole("searchbox", { name: "Search help" }),
      "isn't a memory",
    );
    const persona = document.getElementById("concept.persona")!;
    const related = within(persona).getByRole("navigation", {
      name: "Related",
    });
    const skill = within(related).getByRole("link", { name: "Skill" });
    expect(skill).toHaveAttribute("href", "#concept.skill");
    expect(document.getElementById("concept.skill")).toBeNull();

    await user.click(skill);
    expect(document.getElementById("concept.skill")).not.toBeNull();
  });

  it("links each page guide's terms to glossary anchors", () => {
    renderCenter();
    const guide = document.getElementById("page-new-chat")!;
    const terms = within(guide).getByRole("navigation", {
      name: "Terms used here",
    });
    expect(
      within(terms).getByRole("link", { name: "Persona" }),
    ).toHaveAttribute("href", "#concept.persona");
  });
});
