import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiClient, type ToolResult } from "@/lib/client";
import {
  RetrievalCitations,
  citedSources,
  previewExcerpt,
} from "./retrieval-citations";

const { api } = vi.hoisted(() => ({ api: { chatFileGetInfo: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
}));

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const longName = `${"constellation-".repeat(12)}catalogue.pdf`;
const names: Record<string, string> = {
  [id(1)]: "gaia.md",
  [id(2)]: longName,
};

const hit = (n: number, extra: object = {}) => ({
  file_id: id(n),
  sources: ["project", "chat"],
  artifact_generation: 3,
  chunk_id: `chunk-${n}`,
  score: 0.8,
  match_kind: "text",
  excerpt: `Excerpt ${n} <img src=x onerror=alert(1)>`,
  ...extra,
});

const search = (hits: object[]): ToolResult =>
  ({
    tool_call: { function: { name: "search_knowledge" } },
    raw_result: { results: hits },
  }) as ToolResult;

function setup(results: ToolResult[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <RetrievalCitations chatId="chat" results={results} />
        </TooltipProvider>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ApiClient.__registry.set(api as never);
  api.chatFileGetInfo.mockImplementation(({ path }) =>
    Promise.resolve({
      data: {
        id: path.file_id,
        original_name: names[path.file_id] ?? `${path.file_id}.txt`,
      },
    }),
  );
});

describe("citedSources", () => {
  it("groups passages by file in first-retrieval order and ignores other tools", () => {
    const sources = citedSources([
      search([hit(2), hit(1), hit(2, { chunk_id: "again" })]),
      {
        tool_call: { function: { name: "web_search" } },
        raw_result: { results: [hit(3)] },
      } as ToolResult,
      search([hit(1, { artifact_generation: 4 })]),
    ]);
    expect(sources.map(({ hit, passages }) => [hit.file_id, passages])).toEqual(
      [
        [id(2), 2],
        [id(1), 2],
      ],
    );
  });

  it("drops malformed results", () => {
    expect(citedSources([search([{ file_id: "not-a-uuid" }])])).toEqual([]);
  });
});

describe("previewExcerpt", () => {
  it("collapses whitespace and bounds the preview", () => {
    expect(previewExcerpt("  a\n\n b  ")).toBe("a b");
    expect(previewExcerpt(" ")).toBeNull();
    expect(previewExcerpt(undefined)).toBeNull();
    const long = previewExcerpt("x".repeat(400))!;
    expect(long).toHaveLength(280);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("RetrievalCitations", () => {
  it("renders nothing without retrieval hits", () => {
    const { container } = setup([search([])]);
    expect(container).toBeEmptyDOMElement();
  });

  it("numbers chips that link to the scoped file view under full names", async () => {
    setup([search([hit(1), hit(2), hit(1)])]);
    const region = screen.getByRole("region", { name: "Retrieved sources" });
    const first = await within(region).findByRole("link", {
      name: "Source 1: gaia.md",
    });
    expect(first).toHaveAttribute("href", `/c/chat/files/${id(1)}`);
    const second = await within(region).findByRole("link", {
      name: `Source 2: ${longName}`,
    });
    expect(second).toHaveAttribute("href", `/c/chat/files/${id(2)}`);
    // Long names truncate visually; the accessible name keeps them whole.
    expect(within(second).getByText(longName)).toHaveClass("truncate");
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
  });

  it("previews the excerpt and provenance as text on keyboard focus", async () => {
    const user = userEvent.setup();
    setup([search([hit(1), hit(1, { chunk_id: "second" })])]);
    const chip = await screen.findByRole("link", { name: "Source 1: gaia.md" });
    await user.tab();
    expect(chip).toHaveFocus();
    const preview = await screen.findByRole("tooltip");
    expect(preview).toHaveTextContent("Excerpt 1 <img src=x onerror=alert(1)>");
    expect(preview).toHaveTextContent(
      "Project + This chat · generation 3 · text · 2 passages",
    );
    expect(document.querySelector("img")).toBeNull();
    await waitFor(() => expect(chip).toHaveAccessibleDescription(/Excerpt 1/));
  });

  it("previews on hover", async () => {
    const user = userEvent.setup();
    setup([search([hit(2)])]);
    await user.hover(await screen.findByRole("link", { name: /^Source 1/ }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Excerpt 2");
  });

  it("fails closed without a link when the source leaves scope, and can retry", async () => {
    const user = userEvent.setup();
    api.chatFileGetInfo.mockRejectedValueOnce({ detail: "Revoked" });
    setup([search([hit(1)])]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Source unavailable in this chat",
    );
    expect(screen.queryByRole("link")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry source 1" }));
    expect(
      await screen.findByRole("link", { name: "Source 1: gaia.md" }),
    ).toBeVisible();
  });

  it("revokes an existing link when a refetch is denied", async () => {
    const { qc } = setup([search([hit(1)])]);
    await screen.findByRole("link", { name: "Source 1: gaia.md" });
    api.chatFileGetInfo.mockRejectedValue({ detail: "Revoked" });
    await qc.invalidateQueries();
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("pages long source lists", async () => {
    const user = userEvent.setup();
    setup([search(Array.from({ length: 25 }, (_, n) => hit(n + 10)))]);
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    await user.click(
      screen.getByRole("button", { name: "Show 5 more sources" }),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(25);
    expect(screen.queryByRole("button", { name: /more sources/ })).toBeNull();
  });
});
