import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@/features/theme/types";
import light from "@/features/theme/bundled/light.json";
import { TooltipProvider } from "@/components/ui/tooltip";

const { saveTheme, refresh } = vi.hoisted(() => ({
  saveTheme: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/features/theme/server/actions", () => ({ saveTheme }));
vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => ({
    lightThemes: [{ ...light, filename: "light" }],
    darkThemes: [],
    getTheme: () => ({ ...light, filename: "light" }),
    refresh,
  }),
}));
import { ThemeEditor } from "./theme-editor";

function show() {
  const invalidated = vi.fn();
  const cache = new QueryClient({
    mutationCache: new MutationCache({ onSuccess: invalidated }),
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <TooltipProvider>
        <ThemeEditor />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { invalidated };
}
beforeEach(() => vi.clearAllMocks());

describe("theme save feedback", () => {
  it("names creation and duplication actions and opens a named copy draft", () => {
    show();
    expect(screen.getByRole("button", { name: "New theme" })).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: `Duplicate ${light.name}` }),
    );
    expect(screen.getByLabelText("Name")).toHaveValue(`${light.name} Copy`);
  });
  it("names standalone color controls and their hex inputs", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: light.name }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Border color" }));
    expect(
      screen.getByRole("textbox", { name: "Border hex color" }),
    ).toHaveValue(light.colors.border);
  });
  it("retains failed edits, disables switching during retry, and refreshes only after success", async () => {
    const { invalidated } = show();
    fireEvent.click(screen.getByRole("button", { name: light.name }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Kept draft" },
    });
    saveTheme.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "STORAGE_ERROR",
        message: "Storage unavailable. Try again.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Storage unavailable",
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Kept draft");
    expect(screen.queryByText("Theme saved.")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(invalidated).not.toHaveBeenCalled();
    let finish!: (value: { ok: true; theme: Theme }) => void;
    saveTheme.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled(),
    );
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "New theme" })).toBeDisabled();
    expect(screen.getByRole("button", { name: light.name })).toBeDisabled();
    await act(async () =>
      finish({
        ok: true,
        theme: {
          ...light,
          type: "light",
          name: "Kept draft",
          filename: "light",
        },
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Theme saved."),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
    expect(invalidated).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
  it("uses the server-generated ID for subsequent edits to a new theme", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "New theme" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Created" },
    });
    const id = "f3eb9444-48c7-4b31-92a2-6ddfa06bdb0f";
    saveTheme.mockImplementation(async (input) => ({
      ok: true,
      theme: { ...input, filename: id },
    }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Theme saved.");
    expect(saveTheme.mock.calls[0][0].filename).toBe("");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Edited" },
    });
    expect(screen.queryByText("Theme saved.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveTheme).toHaveBeenCalledTimes(2));
    expect(saveTheme.mock.calls[1][0]).toMatchObject({
      filename: id,
      name: "Edited",
    });
    await screen.findByRole("status");
  });
  it("retains drafts on transport failure and clears errors when choosing another theme", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "New theme" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Transport draft" },
    });
    saveTheme.mockRejectedValueOnce(new Error("private server details"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your edits are still here",
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Transport draft");
    expect(
      screen.queryByText("private server details"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: light.name }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue(light.name);
  });
});
