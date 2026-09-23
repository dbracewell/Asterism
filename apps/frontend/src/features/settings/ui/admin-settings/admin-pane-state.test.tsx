import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdminPaneErrorBoundary,
  AdminPaneLoading,
} from "./admin-pane-state";

const BrokenPane = () => {
  throw new Error("broken pane");
};

describe("admin pane states", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("announces lazy-pane loading", () => {
    render(<AdminPaneLoading />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading settings pane…",
    );
  });

  it("shows an accessible pane-specific failure", () => {
    render(
      <AdminPaneErrorBoundary paneLabel="Theme Editor">
        <BrokenPane />
      </AdminPaneErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Theme Editor settings could not be loaded.",
    );
  });
});
