import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SpanCitation } from "@/lib/client";
import MarkdownViewer from ".";
import { copyableText } from "./copy-text";
import { InlineFilesProvider, InlineFilesScope } from "./inline-files";
import { citationKeys, markdownUrlTransform } from "./policy";

vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => ({ currentThemeType: "light", fontSize: "16px" }),
}));

const FILE = "10000000-0000-4000-8000-000000000001";
const A = "0123456789ab";
const B = "abcdef012345";
const C = "fedcba987654";
const cite = (...keys: string[]) => `asterism-cite:${keys.join(",")}`;
const available: SpanCitation = {
  key: A,
  available: true,
  file_id: FILE,
  chunk_id: "chunk",
  artifact_generation: 2,
  match_kind: "text",
  name: "notes.md",
  excerpt: "The sky is blue <img src=x onerror=alert(1)>",
};
const gone: SpanCitation = { key: B, available: false };

function renderWith(
  content: string,
  citations: SpanCitation[] | null | undefined,
  chatId: string | null = "chat",
) {
  return render(
    <TooltipProvider>
      <InlineFilesProvider value={{ chatId, files: [], citations }}>
        <MarkdownViewer content={content} />
      </InlineFilesProvider>
    </TooltipProvider>,
  );
}

describe("citation grammar", () => {
  it("accepts one to four lowercase keys and nothing else", () => {
    expect(citationKeys(cite(A))).toEqual([A]);
    expect(citationKeys(cite(A, B, C, A))).toEqual([A, B, C, A]);
    for (const url of [
      cite(A, B, C, A, B),
      cite(A.toUpperCase()),
      `${cite(A)}?x=1`,
      `${cite(A)},`,
      "asterism-cite:short",
      `https://example.test/${cite(A)}`,
    ])
      expect(citationKeys(url)).toBeNull();
  });

  it("lets a citation through only as a link destination", () => {
    const node = (tagName: string) => ({ tagName }) as never;
    expect(markdownUrlTransform(cite(A), "href", node("a"))).toBe(cite(A));
    expect(markdownUrlTransform(cite(A), "src", node("img"))).toBeUndefined();
  });
});

describe("CitedClaim", () => {
  it("marks the claim span and links an available citation to the scoped file", async () => {
    const user = userEvent.setup();
    renderWith(`Intro. [The sky is blue.](${cite(A)}) Outro.`, [available]);
    const claim = document.querySelector("[data-citation-claim]")!;
    expect(claim).toHaveTextContent("The sky is blue.1");
    const marker = within(claim as HTMLElement).getByRole("link", {
      name: "Citation 1: notes.md",
    });
    expect(marker).toHaveAttribute("href", `/c/chat/files/${FILE}`);
    expect(marker.getAttribute("href")).not.toContain("asterism-cite");

    await user.tab();
    expect(marker).toHaveFocus();
    const preview = await screen.findByRole("tooltip");
    expect(preview).toHaveTextContent("notes.md");
    expect(preview).toHaveTextContent(
      "The sky is blue <img src=x onerror=alert(1)>",
    );
    expect(preview).toHaveTextContent("generation 2 · text");
    expect(document.querySelector("img")).toBeNull();
  });

  it("numbers markers by resolved order and marks unavailable or unknown keys", async () => {
    const user = userEvent.setup();
    renderWith(`[Claim](${cite(B, A, C)})`, [available, gone]);
    const markers = [...document.querySelectorAll("[data-citation]")];
    expect(markers.map((m) => m.getAttribute("data-citation"))).toEqual([
      "unavailable",
      "available",
      "unavailable",
    ]);
    expect(markers.map((m) => m.textContent)).toEqual(["2", "1", "?"]);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    const unavailable = screen.getByRole("note", {
      name: "Citation 2 unavailable",
    });
    expect(unavailable).toHaveAttribute("tabindex", "0");
    await user.hover(unavailable);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Source unavailable in this chat",
    );
  });

  it("stays inert while streaming, without a chat, or outside a resolved scope", () => {
    const { unmount } = renderWith(`[Claim](${cite(A)})`, null);
    expect(document.querySelector("[data-citation]")).toHaveAttribute(
      "data-citation",
      "pending",
    );
    expect(screen.queryByRole("link")).toBeNull();
    unmount();

    renderWith(`[Claim](${cite(A)})`, [available], null).unmount();
    expect(screen.queryByRole("link")).toBeNull();

    // Surfaces without a provider (study tools, notes) render every key inert.
    render(
      <TooltipProvider>
        <MarkdownViewer content={`[Claim](${cite(A)})`} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Claim")).toBeVisible();
  });

  it("scopes a sub-agent's output to its own citations", () => {
    render(
      <TooltipProvider>
        <InlineFilesProvider
          value={{ chatId: "chat", files: [], citations: [available] }}
        >
          <InlineFilesScope files={[]} citations={[]}>
            <MarkdownViewer content={`[Claim](${cite(A)})`} />
          </InlineFilesScope>
        </InlineFilesProvider>
      </TooltipProvider>,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps a near-miss as an ordinary blocked link", () => {
    renderWith(`[Claim](${cite(A)}?x=1)`, [available]);
    expect(document.querySelector("[data-citation-claim]")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Claim")).toBeVisible();
  });
});

it("copies cited claims as plain text", () => {
  expect(
    copyableText(`[The sky is blue.](${cite(A, B)}) [x](${cite(A)}?x=1)`),
  ).toBe(`The sky is blue. [x](${cite(A)}?x=1)`);
});
