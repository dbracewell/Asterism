import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/lib/client";
import { CanvasProvider, type CanvasContextValue } from "./canvas-context";
import { CanvasChip } from "./canvas-chip";

const { api } = vi.hoisted(() => ({
  api: { canvasItemGetMany: vi.fn(), canvasItemCreate: vi.fn() },
}));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
}));

const ITEM = "00000000-0000-4000-8000-000000000001";
const item = {
  id: ITEM,
  kind: "code",
  language: "python",
  title: "Parser",
  version: 3,
  author: "agent",
  size: 10,
  updated_at: 1,
};

function setup(
  overrides: Partial<CanvasContextValue> = {},
  hasMessages = true,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const value: CanvasContextValue = {
    openItemId: null,
    open: vi.fn(),
    close: vi.fn(),
    transcriptKey: "k",
    ask: null,
    canEdit: true,
    ...overrides,
  };
  render(
    <QueryClientProvider client={qc}>
      <CanvasProvider value={value}>
        <CanvasChip chatId="chat" hasMessages={hasMessages} />
      </CanvasProvider>
    </QueryClientProvider>,
  );
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  ApiClient.__registry.set(api as never);
  api.canvasItemGetMany.mockResolvedValue({ data: [item] });
});

describe("CanvasChip", () => {
  it("lists the branch's items and opens one", async () => {
    const canvas = setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Canvas, 1 item" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Parser/ }));
    expect(canvas.open).toHaveBeenCalledWith(ITEM);
  });

  it("creates an item with a language for code, then opens it", async () => {
    api.canvasItemCreate.mockResolvedValue({ data: { item_id: "new" } });
    const canvas = setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Canvas, 1 item" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "New canvas item" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "New canvas item",
    });
    await userEvent.type(screen.getByLabelText("Title"), "Script");
    await userEvent.click(screen.getByRole("radio", { name: "Code" }));
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Language"), "python");
    await userEvent.click(create);
    await waitFor(() => expect(canvas.open).toHaveBeenCalledWith("new"));
    expect(api.canvasItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { chat_id: "chat" },
        body: { kind: "code", title: "Script", language: "python" },
      }),
    );
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it("needs a message to anchor a new item to", async () => {
    setup({}, false);
    await userEvent.click(
      await screen.findByRole("button", { name: "Canvas, 1 item" }),
    );
    expect(
      screen.getByRole("button", { name: "New canvas item" }),
    ).toBeDisabled();
    expect(screen.getByText(/Send a message first/)).toBeVisible();
  });

  it("stays hidden with canvas off and no items", async () => {
    api.canvasItemGetMany.mockResolvedValue({ data: [] });
    setup({ canEdit: false });
    await waitFor(() => expect(api.canvasItemGetMany).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Canvas/ })).toBeNull();
  });
});
