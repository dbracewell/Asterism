import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GroupSettings } from "./groups-settings";
import { UserPermissionsSettings } from "./user-permissions-settings";
import { ImageGenSettings } from "./image-gen-settings";
import { CodeExecutionSettings } from "./code-execution-settings";
import { ExportSettings } from "./export-settings";

describe("planned administration panes", () => {
  it.each([
    ["Groups", GroupSettings, "User group management"],
    ["Users", UserPermissionsSettings, "user management screens"],
    ["Image generation", ImageGenSettings, "Image generation providers"],
    ["Code execution", CodeExecutionSettings, "Sandboxed code execution"],
    ["Export", ExportSettings, "Data and conversation export"],
  ])(
    "%s explains its future scope without offering configuration controls",
    (title, Pane, scope) => {
      const { container } = render(<Pane />);
      expect(screen.getByText(title)).toBeVisible();
      expect(
        screen.getByText(/planned for a future release/),
      ).toHaveTextContent(scope);
      expect(
        container.querySelector("button, input, select, textarea, form, a"),
      ).toBeNull();
    },
  );

  it("distinguishes existing access checks from future Users administration", () => {
    render(<UserPermissionsSettings />);
    expect(
      screen.getByText(/Admin and user access checks are already enforced/),
    ).toBeVisible();
    expect(
      screen.queryByText(/Role-based access control.*planned/),
    ).not.toBeInTheDocument();
  });
});
