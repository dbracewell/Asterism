import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import MarkdownViewer from ".";
import {
  clearDiagramCacheForTests,
  isClosedFence,
  renderDiagram,
  sanitizeDiagramSvg,
} from "./diagram";
import { markdownMermaidConfig, MERMAID_RENDER_TIMEOUT_MS } from "./policy";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));
vi.mock("mermaid", () => ({ default: mermaid }));
vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => ({ currentThemeType: "light", fontSize: "16px" }),
}));

const svg = (body: string, attrs = 'viewBox="0 0 120 40"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width: 120px;" ${attrs} aria-roledescription="flowchart-v2">${body}</svg>`;

beforeEach(() => {
  clearDiagramCacheForTests();
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
  mermaid.render.mockResolvedValue({
    svg: svg('<g><text x="0" y="20">Start</text></g>'),
  });
});
afterEach(() => vi.useRealTimers());

describe("isClosedFence", () => {
  it.each([
    ["```mermaid\nflowchart LR\n  a --> b\n```", true],
    ["~~~mermaid\na\n~~~~", true],
    ["> ```mermaid\n> a --> b\n> ```", true],
    ["  ```mermaid\n  a\n  ```\n", true],
    ["```mermaid\nflowchart LR\n  a --> b", false],
    ["```mermaid\na\n~~~", false],
    ["````mermaid\na\n```", false],
    ["```mermaid", false],
  ])("%j → %s", (raw, closed) => expect(isClosedFence(raw)).toBe(closed));
});

describe("sanitizeDiagramSvg", () => {
  it("removes scripts, handlers, foreign HTML, images and outside links", () => {
    const result = sanitizeDiagramSvg(
      svg(
        [
          "<script>alert(1)</script>",
          '<g onload="alert(1)" onclick="alert(1)"><text>A</text></g>',
          "<foreignObject><div>html</div></foreignObject>",
          '<image href="https://example.test/x.png"/>',
          '<a href="javascript:alert(1)"><text>link</text></a>',
          '<use href="https://example.test/sprite.svg#x"/>',
          '<linearGradient id="g"/><rect fill="url(#g)"/>',
          '<path marker-end="url(#arrow)" href="#arrow"/>',
        ].join(""),
      ),
    )!;
    expect(result.svg).not.toMatch(
      /<script|onload|onclick|foreignObject|<image|<a\b|<use|javascript:|example\.test/i,
    );
    expect(result.svg).toContain('href="#arrow"');
    expect(result.svg).toContain("url(#g)");
  });

  it("gives the image its own size and a name from the diagram", () => {
    const result = sanitizeDiagramSvg(
      svg(
        "<title>Water cycle</title><desc>How water moves</desc><g/>",
        'viewBox="0 0 120.4 40"',
      ),
    )!;
    expect(result).toMatchObject({
      width: 121,
      height: 40,
      label: "Water cycle",
      description: "How water moves",
    });
    expect(result.svg).toContain('width="121"');
    expect(result.svg).not.toContain("max-width");
  });

  it("names a diagram without a title by its type", () => {
    expect(sanitizeDiagramSvg(svg("<g/>"))!.label).toBe(
      "Diagram: flowchart-v2",
    );
  });

  it("refuses markup that is not a sized SVG", () => {
    expect(sanitizeDiagramSvg("<div>no</div>")).toBeNull();
    expect(sanitizeDiagramSvg(svg("<g/>", ""))).toBeNull();
    expect(sanitizeDiagramSvg(svg("<g/>", 'viewBox="0 0 0 10"'))).toBeNull();
  });
});

describe("renderDiagram", () => {
  it("draws with the locked configuration and the chat theme", async () => {
    await expect(
      renderDiagram("flowchart LR\na-->b", "dark"),
    ).resolves.toMatchObject({ ok: true });
    const config = mermaid.initialize.mock.calls[0][0];
    expect(config).toMatchObject({
      securityLevel: "strict",
      htmlLabels: false,
      startOnLoad: false,
      theme: "dark",
    });
    for (const key of [
      "securityLevel",
      "htmlLabels",
      "theme",
      "themeCSS",
      "themeVariables",
      "fontFamily",
    ])
      expect(config.secure).toContain(key);
  });

  it("returns a failure for invalid diagrams instead of throwing", async () => {
    mermaid.render.mockRejectedValueOnce(new Error("Parse error <b>x</b>"));
    await expect(renderDiagram("nope", "light")).resolves.toEqual({
      ok: false,
    });
    // The queue keeps working after a failure.
    await expect(
      renderDiagram("flowchart LR\na-->b", "light"),
    ).resolves.toMatchObject({ ok: true });
  });

  it("gives up on a diagram that takes too long", async () => {
    vi.useFakeTimers();
    mermaid.render.mockReturnValueOnce(new Promise(() => {}));
    const result = renderDiagram("flowchart LR\na-->b", "light");
    await vi.advanceTimersByTimeAsync(MERMAID_RENDER_TIMEOUT_MS + 1);
    await expect(result).resolves.toEqual({ ok: false });
  });
});

it("cannot be reconfigured by callers", () => {
  expect(Object.isFrozen(markdownMermaidConfig)).toBe(true);
});

describe("MarkdownViewer diagrams", () => {
  const view = (content: string) =>
    render(
      <TooltipProvider>
        <MarkdownViewer content={content} />
      </TooltipProvider>,
    );

  it("draws a finished mermaid block as an image", async () => {
    view("Here:\n\n```mermaid\nflowchart LR\n  a --> b\n```\n");
    const image = await screen.findByRole("img", {
      name: "Diagram: flowchart-v2",
    });
    expect(image.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(mermaid.render).toHaveBeenCalledWith(
      expect.stringMatching(/^asterism-diagram-/),
      "flowchart LR\n  a --> b",
    );
  });

  it("keeps an unfinished block as code while it streams", () => {
    view("```mermaid\nflowchart LR\n  a -->");
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("mermaid")).toBeTruthy();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("shows the code with a note when the diagram can't be drawn", async () => {
    mermaid.render.mockRejectedValueOnce(
      new Error("<img src=x onerror=alert(1)>"),
    );
    const { container } = view("```mermaid\nnot a diagram\n```");
    expect(await screen.findByText("Couldn't draw this diagram")).toBeTruthy();
    expect(container.textContent).toContain("not a diagram");
    expect(container.querySelector("img")).toBeNull();
  });

  it("leaves other code blocks alone", () => {
    view("```python\nprint(1)\n```");
    expect(mermaid.render).not.toHaveBeenCalled();
  });
});
