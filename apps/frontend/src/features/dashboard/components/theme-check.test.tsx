import { render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const { state, setTheme, setFontSize, refresh } = vi.hoisted(() => ({
  state: {
    saved: "broken-custom",
    current: "atlas",
    savedFontSize: undefined as string | undefined,
  },
  setTheme: vi.fn(),
  setFontSize: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({
    settings: { theme: state.saved, font_size: state.savedFontSize },
  }),
}));
vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => ({
    currentTheme: state.current,
    allThemes: [{ filename: "atlas" }, { filename: "valid-custom" }],
    setTheme,
    fontSize: "16px",
    setFontSize,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { ThemeCheck } from "./theme-check";
beforeEach(() => {
  vi.clearAllMocks();
  state.current = "atlas";
  state.saved = "broken-custom";
  state.savedFontSize = undefined;
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
  expect(setTheme).toHaveBeenLastCalledWith("atlas");
});

it("does not trigger a refresh loop when user.settings.font_size is undefined", () => {
  state.saved = "atlas";
  state.savedFontSize = undefined;
  const view = render(<ThemeCheck />);
  view.rerender(<ThemeCheck />);
  expect(setFontSize).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
