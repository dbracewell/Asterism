import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import MarkdownViewer from ".";
import { markdownLink, markdownUrlTransform } from "./policy";
import {
  adversarialMarkdown,
  normalMarkdown,
  fencedCode,
} from "./test-content";

vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => ({ currentThemeType: "light", fontSize: "16px" }),
}));
const clipboard = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  clipboard.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
});
function view(content: string) {
  return render(
    <TooltipProvider>
      <MarkdownViewer content={content} />
    </TooltipProvider>,
  );
}

describe("shared Markdown trust boundary", () => {
  it("does not create raw HTML controls, overlays, frames or resource elements", () => {
    const { container } = view(adversarialMarkdown);
    expect(
      container.querySelector(
        "script,style,link,base,meta,iframe,object,embed,form,input,button,img,video,source,image",
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        "#untrusted-overlay,#untrusted-math-id,.untrusted-math-class,[style*='fixed'],[autofocus]",
      ),
    ).toBeNull();
    expect(
      container.querySelector("[src],[srcset],[poster],[onerror],[onload]"),
    ).toBeNull();
    expect(
      screen.getByText("[Image omitted: Remote tracker]"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("[Image omitted: Local tracker]"),
    ).toBeInTheDocument();
    expect(container.querySelector("a")).toBeNull();
  });
  it.each([
    "https://example.test/image.png",
    "/api/py/private",
    "//example.test/image.png",
    "data:image/png;base64,AA==",
    "blob:https://example.test/id",
  ])("never renders an image request for %s", (url) => {
    const { container } = view(`![Description](${url})`);
    expect(container.querySelector("img,[src],[srcset]")).toBeNull();
    expect(
      screen.getByText("[Image omitted: Description]"),
    ).toBeInTheDocument();
  });
  it("preserves GFM, ordinary links, footnotes, scoped-source links and math", () => {
    const { container } = view(normalMarkdown + "\n`inline code`\n");
    expect(
      screen.getByRole("heading", { name: "Approved Markdown" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("sample42");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("link", { name: "Documentation" })).toHaveAttribute(
      "href",
      "https://example.test/docs",
    );
    expect(screen.getByRole("link", { name: "Documentation" })).toHaveAttribute(
      "rel",
      "noreferrer noopener",
    );
    expect(screen.getByRole("link", { name: "Scoped source" })).toHaveAttribute(
      "href",
      "/c/example-chat/files/11111111-1111-4111-8111-111111111111",
    );
    expect(
      container.querySelector("a[data-footnote-ref]")?.getAttribute("href"),
    ).toMatch(/^#user-content-fn-/);
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(screen.getByText("inline code").tagName).toBe("CODE");
  });
  it("keeps fenced code literal, highlighted and copyable", () => {
    const { container } = view(fencedCode);
    expect(screen.getByText("typescript")).toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeNull();
    fireEvent.click(container.querySelector("button")!);
    expect(clipboard).toHaveBeenCalledWith(
      "const text = \"<iframe src='/untrusted-markdown/code'></iframe>\";",
    );
    expect(container.querySelector("code span[style*=color]")).not.toBeNull();
  });
  it("bounds math size and handles recursive macros without executing HTML", () => {
    const { container } = view(
      String.raw`$\rule{999em}{999em}$\n\n$\def\x{\x}\x$`,
    );
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.innerHTML).not.toContain("999em;");
    expect(container.querySelector(".katex-error")).not.toBeNull();
    expect(container.querySelector("script,img,a")).toBeNull();
  });
  it("applies the same math trust policy to math fences", () => {
    const { container } = view(
      "```math\n\\frac{1}{2}\n```\n\n```math\n\\includegraphics{https://example.test/image}\n```",
    );
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector("img,[src],a")).toBeNull();
  });
  it("remains inert while streamed raw HTML is incomplete or completed", () => {
    const content = '<img src="/untrusted-markdown/stream" onerror="alert(1)">';
    const output = view(content.slice(0, 35));
    expect(output.container.querySelector("img")).toBeNull();
    output.rerender(
      <TooltipProvider>
        <MarkdownViewer content={content} />
      </TooltipProvider>,
    );
    expect(output.container.querySelector("img")).toBeNull();
  });
});

describe("rich content navigation", () => {
  it("keeps plain and highlighted code literal, separately copyable and keyboard navigable", () => {
    const plain = "literal <input> & a very long token";
    const highlighted = "const value = 'unchanged';";
    const { container } = view(
      `\`\`\`\n${plain}\n\`\`\`\n\n\`\`\`javascript\n${highlighted}\n\`\`\``,
    );
    const regions = screen.getAllByRole("region", { name: "Scrollable code" });
    expect(regions).toHaveLength(2);
    for (const [index, text] of [plain, highlighted].entries()) {
      expect(regions[index]).toHaveAttribute("tabindex", "0");
      expect(regions[index].querySelector("pre code")).toHaveTextContent(text);
      fireEvent.click(
        within(regions[index].parentElement!).getByRole("button"),
      );
      expect(clipboard).toHaveBeenLastCalledWith(text);
    }
    expect(container.querySelector("input")).toBeNull();
  });
  it("exposes table and generated math scroll areas to the keyboard without enabling HTML", () => {
    const { container } = view(
      "| A | B |\n|---|---|\n| one | two |\n\n$$\nx^2 + y^2\n$$",
    );
    expect(
      screen.getByRole("region", { name: "Scrollable table" }),
    ).toHaveAttribute("tabindex", "0");
    expect(
      screen.getByRole("region", { name: "Scrollable math" }),
    ).toHaveAttribute("tabindex", "0");
    expect(container.querySelector(".katex")).not.toBeNull();
  });
});

describe("link and resource URL policy", () => {
  it.each([
    "https://example.test/a?b=1#part",
    "http://example.test",
    "HTTPS://example.test",
    "/c/chat/files/id",
    "#user-content-fn-1",
  ])("allows %s", (url) => expect(markdownLink(url)).toBe(url));
  it.each([
    "",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\nscript:alert(1)",
    "\u0000https://example.test",
    "https://example.test/a b",
    "//example.test/a",
    "\\\\example.test",
    "/\\example.test",
    "https://user:password@example.test",
    "data:text/html,hello",
    "blob:https://example.test/id",
    "file:///tmp/file",
    "ftp://example.test",
    "mailto:person@example.test",
    "relative.md",
    "?query=1",
  ])("blocks %s", (url) => expect(markdownLink(url)).toBeUndefined());
  it("only allows href on anchors, never a resource property", () => {
    expect(
      markdownUrlTransform("https://example.test", "href", {
        type: "element",
        tagName: "a",
        properties: {},
        children: [],
      }),
    ).toBe("https://example.test");
    for (const key of ["src", "srcSet", "poster", "data"]) {
      expect(
        markdownUrlTransform("https://example.test/resource", key, {
          type: "element",
          tagName: "img",
          properties: {},
          children: [],
        }),
      ).toBeUndefined();
    }
  });
});
