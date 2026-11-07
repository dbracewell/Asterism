import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GroupSettings } from "./groups-settings";
import { ImageGenSettings } from "./image-gen-settings";
import { CodeExecutionSettings } from "./code-execution-settings";

describe("planned administration panes", () => {
  it.each([
    ["Groups", GroupSettings, "User group management"],
    ["Image generation", ImageGenSettings, "Image generation providers"],
    ["Code execution", CodeExecutionSettings, "Sandboxed code execution"],
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
});
