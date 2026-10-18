import { render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const { state, setTheme, refresh } = vi.hoisted(() => ({
  state: { saved: "broken-custom", current: "light" },
  setTheme: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ settings: { theme: state.saved, font_size: "16px" } }),
}));
vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => ({
    currentTheme: state.current,
    allThemes: [{ filename: "light" }, { filename: "valid-custom" }],
    setTheme,
    fontSize: "16px",
    setFontSize: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { ThemeCheck } from "./theme-check";
beforeEach(() => {
  vi.clearAllMocks();
  state.current = "light";
  state.saved = "broken-custom";
});
it("does not refresh repeatedly when the saved custom theme is unavailable", () => {
  const view = render(<ThemeCheck />);
  view.rerender(<ThemeCheck />);
  expect(setTheme).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
it("applies valid saved custom themes and restores Light when an override disappears", () => {
  state.saved = "valid-custom";
  const view = render(<ThemeCheck />);
  expect(setTheme).toHaveBeenLastCalledWith("valid-custom");
  state.current = "valid-custom";
  state.saved = "removed-custom";
  view.rerender(<ThemeCheck />);
  expect(setTheme).toHaveBeenLastCalledWith("light");
});
