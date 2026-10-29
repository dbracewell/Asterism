import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SettingsPane,
  SettingsSaveBar,
  SettingsSection,
} from "./settings-section";

describe("settings layout", () => {
  it("gives the pane one h1 and names each section region by its heading", () => {
    render(
      <SettingsPane
        title="General"
        description="Account defaults."
        actions={<button>Add</button>}
      >
        <SettingsSection title="Appearance" description="Theme and type.">
          <p>Theme</p>
        </SettingsSection>
        <SettingsSection title="Chat" actions={<button>Edit chat</button>} />
      </SettingsPane>,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "General",
    );
    const appearance = screen.getByRole("region", { name: "Appearance" });
    expect(appearance).toHaveTextContent("Theme and type.");
    expect(screen.getByRole("region", { name: "Chat" })).toContainElement(
      screen.getByRole("button", { name: "Edit chat" }),
    );
  });
});

describe("settings save bar", () => {
  it("is a quiet sticky footer reporting status while the form is clean", () => {
    render(
      <SettingsSaveBar dirty={false} status="Theme saved.">
        <button disabled>Save</button>
      </SettingsSaveBar>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Theme saved.");
    const bar = status.closest('[data-slot="settings-save-bar"]');
    expect(bar).toHaveClass("sticky", "bottom-0");
    expect(bar).not.toHaveAttribute("data-dirty");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("raises and announces unsaved changes while the form is dirty", () => {
    const { rerender } = render(
      <SettingsSaveBar dirty status="Theme saved.">
        <button>Save</button>
      </SettingsSaveBar>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Unsaved changes");
    expect(status).not.toHaveTextContent("Theme saved.");
    expect(status.closest('[data-slot="settings-save-bar"]')).toHaveAttribute(
      "data-dirty",
    );

    rerender(
      <SettingsSaveBar dirty={false}>
        <button>Save</button>
      </SettingsSaveBar>,
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(
      screen.getByRole("status").closest('[data-slot="settings-save-bar"]'),
    ).not.toHaveAttribute("data-dirty");
  });
});
