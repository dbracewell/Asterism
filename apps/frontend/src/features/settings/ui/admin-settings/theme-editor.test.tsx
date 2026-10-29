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
import atlas from "@/features/theme/bundled/atlas.json";
import { TooltipProvider } from "@/components/ui/tooltip";

const { saveTheme, refresh, catalog } = vi.hoisted(() => ({
  saveTheme: vi.fn(),
  refresh: vi.fn(),
  catalog: { theme: null as Theme | null },
}));
vi.mock("@/features/theme/server/actions", () => ({ saveTheme }));
vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => ({
    lightThemes: [{ ...atlas, filename: "atlas" }],
    darkThemes: [],
    getTheme: () => catalog.theme ?? { ...atlas, filename: "atlas" },
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
beforeEach(() => {
  vi.clearAllMocks();
  catalog.theme = null;
});

describe("theme save feedback", () => {
  it("names creation and duplication actions and opens a named copy draft", () => {
    show();
    expect(screen.getByRole("button", { name: "New theme" })).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: `Duplicate ${atlas.name}` }),
    );
    expect(screen.getByLabelText("Name")).toHaveValue(`${atlas.name} Copy`);
  });
  it("names standalone color controls and their hex inputs", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: atlas.name }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Border color" }));
    expect(
      screen.getByRole("textbox", { name: "Border hex color" }),
    ).toHaveValue(atlas.colors.border);
  });
  it("retains failed edits, disables switching during retry, and refreshes only after success", async () => {
    const { invalidated } = show();
    fireEvent.click(screen.getByRole("button", { name: atlas.name }));
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
    expect(screen.getByRole("button", { name: atlas.name })).toBeDisabled();
    await act(async () =>
      finish({
        ok: true,
        theme: {
          ...(atlas as Theme),
          name: "Kept draft",
          filename: "atlas",
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
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Theme saved."),
    );
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
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Theme saved."),
    );
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
    fireEvent.click(screen.getByRole("button", { name: atlas.name }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue(atlas.name);
  });
});

describe("theme shape controls", () => {
  it("shows Atlas shape values for a theme that omits them", () => {
    const { radius, shadow, density, ...colorsOnly } = atlas as Theme;
    void [radius, shadow, density];
    catalog.theme = { ...colorsOnly, filename: "atlas" };
    show();
    fireEvent.click(screen.getByRole("button", { name: atlas.name }));
    expect(screen.getByLabelText("Corner radius (rem)")).toHaveValue(0.45);
    expect(screen.getByLabelText("Shadows")).toHaveTextContent("Soft");
    expect(screen.getByLabelText("Density")).toHaveTextContent("Comfortable");
    expect(
      screen.getByTestId("theme-preview").style.getPropertyValue("--radius"),
    ).toBe("0.45rem");
  });
  it("previews draft radius and colors live, scoped to the preview", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: atlas.name }));
    fireEvent.change(screen.getByLabelText("Corner radius (rem)"), {
      target: { value: "1" },
    });
    const preview = screen.getByTestId("theme-preview");
    expect(preview.style.getPropertyValue("--radius")).toBe("1rem");
    expect(preview.style.getPropertyValue("--background")).toBe(
      atlas.colors.background,
    );
    expect(preview.style.getPropertyValue("--elevation")).toBe("1");
    expect(preview.style.getPropertyValue("--spacing")).toBe("0.25rem");
    expect(document.documentElement.style.getPropertyValue("--radius")).toBe(
      "",
    );
  });
  it("rejects an out-of-range radius without saving", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: atlas.name }));
    fireEvent.change(screen.getByLabelText("Corner radius (rem)"), {
      target: { value: "3" },
    });
    expect(screen.queryByTestId("theme-preview")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // The native range constraint and the Zod schema both block the save.
    expect(screen.getByLabelText("Corner radius (rem)")).toBeInvalid();
    await act(async () => {});
    expect(saveTheme).not.toHaveBeenCalled();
  });
  it("saves the edited shape values", async () => {
    saveTheme.mockResolvedValue({
      ok: true,
      theme: { ...atlas, filename: "atlas", radius: 0.2 },
    });
    show();
    fireEvent.click(screen.getByRole("button", { name: atlas.name }));
    fireEvent.change(screen.getByLabelText("Corner radius (rem)"), {
      target: { value: "0.2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveTheme).toHaveBeenCalled());
    expect(saveTheme.mock.calls[0][0]).toMatchObject({
      radius: 0.2,
      shadow: "soft",
      density: "comfortable",
    });
  });
});
