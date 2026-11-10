import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/lib/client";
import { CanvasProvider, type CanvasContextValue } from "./canvas-context";
import { CanvasCards } from "./canvas-cards";
import { CanvasPanel } from "./canvas-panel";

const { api } = vi.hoisted(() => ({
  api: {
    canvasItemGetOne: vi.fn(),
    canvasVersionGetOne: vi.fn(),
    canvasVersionCreate: vi.fn(),
    canvasVersionRestore: vi.fn(),
    canvasVersionSaveToLibrary: vi.fn(),
    canvasVersionExport: vi.fn(),
    canvasExportZip: vi.fn(),
  },
}));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
  api,
}));
vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => ({ currentTheme: "light", currentThemeType: "light" }),
}));
// CodeMirror needs layout APIs jsdom lacks; a textarea stands in for it.
vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeEditor(props: {
      value: string;
      onChange: (value: string) => void;
      label: string;
      readOnly: boolean;
      onSelection: (text: string) => void;
    }) {
      return (
        <textarea
          aria-label={props.label}
          value={props.value}
          readOnly={props.readOnly}
          onChange={(event) => props.onChange(event.target.value)}
          onSelect={(event) => {
            const target = event.currentTarget;
            props.onSelection(
              target.value.slice(target.selectionStart, target.selectionEnd),
            );
          }}
        />
      );
    },
}));

const ITEM = "00000000-0000-4000-8000-000000000001";
type Kind = "document" | "code" | "html";
const versions = [
  {
    number: 1,
    title: "Notes",
    author: "agent",
    message_id: "m1",
    size: 3,
    created_at: 1,
  },
  {
    number: 2,
    title: "Notes",
    author: "user",
    message_id: "m2",
    size: 3,
    created_at: 2,
  },
];
const contents: Record<number, string> = {
  1: "first draft",
  2: "second draft",
};

function serve(kind: Kind = "document") {
  api.canvasItemGetOne.mockResolvedValue({
    data: {
      id: ITEM,
      kind,
      language: kind === "code" ? "python" : "",
      versions,
    },
  });
  api.canvasVersionGetOne.mockImplementation(({ path }) =>
    Promise.resolve({
      data: {
        ...versions[path.number - 1],
        item_id: ITEM,
        kind,
        language: kind === "code" ? "python" : "",
        content: contents[path.number],
      },
    }),
  );
}

function setup(overrides: Partial<CanvasContextValue> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const value: CanvasContextValue = {
    openItemId: ITEM,
    open: vi.fn(),
    close: vi.fn(),
    transcriptKey: "k",
    ask: vi.fn().mockResolvedValue(undefined),
    canEdit: true,
    ...overrides,
  };
  render(
    <QueryClientProvider client={qc}>
      <CanvasProvider value={value}>
        <CanvasPanel chatId="chat" itemId={ITEM} />
      </CanvasProvider>
    </QueryClientProvider>,
  );
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  ApiClient.__registry.set(api as never);
  serve();
});

describe("CanvasPanel", () => {
  it("saves the user's edit as a new version on top of the latest", async () => {
    api.canvasVersionCreate.mockResolvedValue({ data: {} });
    setup();
    const editor = await screen.findByRole("textbox", {
      name: "Notes, version 2",
    });
    expect(editor).toHaveValue("second draft");
    const save = screen.getByRole("button", { name: "Save version" });
    expect(save).toBeDisabled();
    await userEvent.type(editor, "!");
    await userEvent.click(save);
    expect(api.canvasVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { chat_id: "chat", item_id: ITEM },
        body: { base_version: 2, content: "second draft!" },
      }),
    );
  });

  it("views an older version read-only and restores it", async () => {
    api.canvasVersionRestore.mockResolvedValue({ data: {} });
    setup();
    await screen.findByRole("textbox", { name: "Notes, version 2" });
    await userEvent.click(screen.getByRole("combobox", { name: "Version" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "Version 1 · Agent" }),
    );
    const older = await screen.findByRole("textbox", {
      name: "Notes, version 1 (read only)",
    });
    expect(older).toHaveValue("first draft");
    expect(screen.queryByRole("button", { name: "Save version" })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Restore this version" }),
    );
    expect(api.canvasVersionRestore).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { chat_id: "chat", item_id: ITEM, number: 1 },
        body: { base_version: 2 },
      }),
    );
  });

  it("is read-only with canvas switched off", async () => {
    setup({ canEdit: false });
    await screen.findByRole("textbox", {
      name: "Notes, version 2 (read only)",
    });
    expect(
      screen.getByText("Turn on canvas in your settings to edit."),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save version" })).toBeNull();
  });

  it("asks the agent about the selected text", async () => {
    const canvas = setup();
    const editor = await screen.findByRole("textbox", {
      name: "Notes, version 2",
    });
    const ask = screen.getByRole("button", { name: /Ask about selection/ });
    expect(ask).toBeDisabled();
    editor.focus();
    (editor as HTMLTextAreaElement).setSelectionRange(0, 6);
    fireEvent.mouseUp(editor);
    await waitFor(() => expect(ask).toBeEnabled());
    await userEvent.click(ask);
    await userEvent.type(
      await screen.findByLabelText("What should change in the selected text?"),
      "Say third",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Send to agent" }),
    );
    expect(canvas.ask).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(canvas.ask!).mock.calls[0][0];
    expect(prompt).toMatch(/^Say third\n/);
    expect(prompt).toContain(`(id ${ITEM}, version 2)`);
    expect(prompt).toContain("```\nsecond\n```");
  });

  it("previews HTML in a sandboxed frame without same-origin access", async () => {
    serve("html");
    setup();
    const frame = await screen.findByTitle("Preview of Notes");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame.getAttribute("srcdoc")).toMatch(
      /^<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'/,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Source" }));
    expect(
      await screen.findByRole("textbox", { name: "Notes, version 2" }),
    ).toHaveValue("second draft");
  });

  it("explains an item that isn't on the branch being viewed", async () => {
    api.canvasItemGetOne.mockRejectedValue({
      code: 404,
      detail: "Canvas item not found in this conversation",
    });
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Canvas item not found in this conversation",
    );
  });
});

describe("CanvasDownloads", () => {
  it("downloads the viewed version and saves it to the library", async () => {
    const created = vi.fn(() => "blob:canvas");
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: created,
        revokeObjectURL: vi.fn(),
      }),
    );
    api.canvasVersionExport.mockResolvedValue({
      data: new Blob(["docx"]),
      response: new Response(null, {
        headers: {
          "content-disposition":
            "attachment; filename=\"Notes.docx\"; filename*=UTF-8''Notes.docx",
        },
      }),
    });
    api.canvasVersionSaveToLibrary.mockResolvedValue({
      data: { filename: "Notes.pdf" },
    });
    setup();
    await screen.findByRole("textbox", { name: "Notes, version 2" });
    const menu = screen.getByRole("button", { name: "Download or save" });
    await userEvent.click(menu);
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual([
      "Markdown (.md)",
      "Plain text (.txt)",
      "Word document (.docx)",
      "PDF (.pdf)",
      "Markdown (.md)",
      "Plain text (.txt)",
      "Word document (.docx)",
      "PDF (.pdf)",
      "All canvas items in this chat (.zip)",
    ]);
    await userEvent.click(
      screen.getAllByRole("menuitem", { name: "Word document (.docx)" })[0],
    );
    await waitFor(() =>
      expect(api.canvasVersionExport).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { chat_id: "chat", item_id: ITEM, number: 2 },
          query: { format: "docx" },
          parseAs: "blob",
        }),
      ),
    );
    await waitFor(() => expect(created).toHaveBeenCalled());
    await userEvent.click(menu);
    await userEvent.click(
      screen.getAllByRole("menuitem", { name: "PDF (.pdf)" })[1],
    );
    await waitFor(() =>
      expect(api.canvasVersionSaveToLibrary).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { chat_id: "chat", item_id: ITEM, number: 2 },
          body: { format: "pdf" },
        }),
      ),
    );
    vi.unstubAllGlobals();
  });
});

describe("CanvasCards", () => {
  it("opens the item a message wrote", async () => {
    const open = vi.fn();
    render(
      <CanvasProvider
        value={{
          openItemId: null,
          open,
          close: vi.fn(),
          transcriptKey: "",
          ask: null,
          canEdit: true,
        }}
      >
        <CanvasCards
          results={[
            {
              content: "",
              is_empty: false,
              tool_call: {
                id: "c",
                function: { name: "canvas_create", arguments: "{}" },
              },
              raw_result: { item_id: ITEM, version: 1, title: "Notes" },
            },
          ]}
        />
      </CanvasProvider>,
    );
    const list = screen.getByRole("list", { name: "Canvas items" });
    expect(within(list).getByText("Created · version 1")).toBeVisible();
    await userEvent.click(
      within(list).getByRole("button", { name: "Open canvas Notes" }),
    );
    expect(open).toHaveBeenCalledWith(ITEM);
  });
});
