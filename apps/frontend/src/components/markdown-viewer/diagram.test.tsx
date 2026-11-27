import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import MarkdownViewer from ".";
import { contrastRatio } from "@/features/theme/contrast";
import type { Theme } from "@/features/theme/types";
import atlas from "@/features/theme/bundled/atlas.json";
import policy from "@asterism/diagram-policy/policy.json";
import printTheme from "@asterism/diagram-policy/print-theme.json";

const bundledThemes = import.meta.glob<Theme>(
  "../../features/theme/bundled/*.json",
  { eager: true, import: "default" },
);
import { diagramTheme, diagramThemeVariables } from "./diagram-theme";
import {
  clearDiagramCacheForTests,
  diagramFileName,
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
const themeState = vi.hoisted(() => ({
  current: { currentThemeType: "light", fontSize: "16px" } as Record<
    string,
    unknown
  >,
}));
vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => themeState.current,
}));
const saveBlob = vi.hoisted(() => vi.fn());
vi.mock("@/lib/save-blob", () => ({ saveBlob }));

const light = { key: "light", dark: false };
const dark = { key: "dark", dark: true };

const svg = (body: string, attrs = 'viewBox="0 0 120 40"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width: 120px;" ${attrs} aria-roledescription="flowchart-v2">${body}</svg>`;

beforeEach(() => {
  clearDiagramCacheForTests();
  saveBlob.mockReset();
  themeState.current = { currentThemeType: "light", fontSize: "16px" };
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
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
  it("leaves no stylesheet or url() reference outside the diagram (US-116.2)", () => {
    const result = sanitizeDiagramSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
        "<style>@import url('https://tracker.example/a.css');" +
        "@font-face{src:url(https://tracker.example/f.woff)}" +
        ".node{fill:url(#gradient)}</style>" +
        '<rect class="node" style="fill:url(https://tracker.example/p)" width="10" height="10"/></svg>',
    );
    expect(result?.svg).toBeTruthy();
    expect(result!.svg).not.toMatch(/tracker\.example|@import/);
    // References within the diagram itself still work.
    expect(result!.svg).toContain("url(#gradient)");
  });

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
    expect(sanitizeDiagramSvg(svg("<g/>"))!.label).toBe("Diagram: flowchart");
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
      renderDiagram("flowchart LR\na-->b", dark),
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
    await expect(renderDiagram("nope", light)).resolves.toEqual({
      ok: false,
    });
    // The queue keeps working after a failure.
    await expect(
      renderDiagram("flowchart LR\na-->b", light),
    ).resolves.toMatchObject({ ok: true });
  });

  it("gives up on a diagram that takes too long", async () => {
    vi.useFakeTimers();
    mermaid.render.mockReturnValueOnce(new Promise(() => {}));
    const result = renderDiagram("flowchart LR\na-->b", light);
    await vi.advanceTimersByTimeAsync(MERMAID_RENDER_TIMEOUT_MS + 1);
    await expect(result).resolves.toEqual({ ok: false });
  });
});

it("cannot be reconfigured by callers", () => {
  expect(Object.isFrozen(markdownMermaidConfig)).toBe(true);
  expect(Object.isFrozen(markdownMermaidConfig.flowchart)).toBe(true);
});

it("keeps words whole and edge labels opaque", async () => {
  await renderDiagram("flowchart LR\na-->b", light);
  const config = mermaid.initialize.mock.calls[0][0];
  expect(config.flowchart.wrappingWidth).toBe(200);
  expect(config.state.wrappingWidth).toBe(200);
  expect(config.themeCSS).toContain(".edgeLabel rect { opacity: 1");
  // A copy, so mermaid can merge into it.
  expect(Object.isFrozen(config.flowchart)).toBe(false);
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
      name: "Diagram: flowchart",
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

describe("diagram themes", () => {
  it("draws with the app palette through mermaid's base theme", async () => {
    const theme = diagramTheme("atlas", atlas.colors, false);
    await renderDiagram("flowchart LR\na-->b", theme);
    const config = mermaid.initialize.mock.calls[0][0];
    expect(config.theme).toBe("base");
    expect(config.themeVariables).toMatchObject({
      primaryColor: atlas.colors.secondary,
      primaryTextColor: atlas.colors["secondary-foreground"],
      background: atlas.colors.card,
    });
  });

  it.each(Object.entries(bundledThemes))(
    "%s: every diagram text color reads on its surface",
    (_name, theme) => {
      const v = diagramThemeVariables(theme.colors, theme.type === "dark");
      for (const [text, surface] of [
        ["primaryTextColor", "primaryColor"],
        ["nodeTextColor", "mainBkg"],
        ["actorTextColor", "actorBkg"],
        ["noteTextColor", "noteBkgColor"],
        ["labelTextColor", "labelBoxBkgColor"],
        ["secondaryTextColor", "secondaryColor"],
        ["tertiaryTextColor", "tertiaryColor"],
        ["textColor", "background"],
        ["signalTextColor", "background"],
        ["pieTitleTextColor", "background"],
        ["cScaleLabel0", "cScale0"],
        ["cScaleLabel1", "cScale1"],
        ["cScaleLabel2", "cScale2"],
        ["cScaleLabel3", "cScale3"],
      ])
        expect(
          contrastRatio(String(v[text]), String(v[surface])),
          `${text} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("falls back to mermaid's own theme without a palette", () => {
    expect(diagramTheme(undefined, undefined, true)).toEqual({
      key: "mermaid-dark",
      dark: true,
    });
  });
});

it.each([
  ["Water cycle", "svg", "water-cycle.svg"],
  ["Diagram: flowchart", "png", "flowchart.png"],
  ["Ünïcode  ✓ title!", "svg", "unicode-title.svg"],
  ["✓✓", "png", "diagram.png"],
] as const)("names the download for %j", (label, format, name) =>
  expect(diagramFileName(label, format)).toBe(name),
);

describe("the diagram block", () => {
  const view = (content: string) =>
    render(
      <TooltipProvider>
        <MarkdownViewer content={content} />
      </TooltipProvider>,
    );
  const block = "```mermaid\nflowchart LR\n  a --> b\n```\n";

  it("opens as the diagram, and the toggle shows the code and back", async () => {
    const user = userEvent.setup();
    view(block);
    await screen.findByRole("img", { name: "Diagram: flowchart" });
    await user.click(screen.getByRole("button", { name: "Show code" }));
    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.getByRole("group", { name: "Code: mermaid" }).textContent,
    ).toContain("flowchart LR");
    const back = screen.getByRole("button", { name: "Show diagram" });
    expect(back).toBe(document.activeElement);
    await user.click(back);
    expect(
      screen.getByRole("img", { name: "Diagram: flowchart" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show code" })).toBe(
      document.activeElement,
    );
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });

  it("copies the source and shows the diagram at full size", async () => {
    const user = userEvent.setup();
    view(block);
    await screen.findByRole("img");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(
      "flowchart LR\n  a --> b",
    );
    await user.click(screen.getByRole("button", { name: "Expand diagram" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Diagram: flowchart",
    });
    expect(dialog.querySelector("img")?.getAttribute("width")).toBe("120");
  });

  it("downloads the SVG under the diagram's name", async () => {
    mermaid.render.mockResolvedValueOnce({
      svg: svg("<title>Water cycle</title><g/>"),
    });
    const user = userEvent.setup();
    view(block);
    await screen.findByRole("img", { name: "Water cycle" });
    await user.click(screen.getByRole("button", { name: "Download diagram" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "SVG image" }),
    );
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), "water-cycle.svg");
    const blob = saveBlob.mock.calls[0][0] as Blob;
    expect(blob.type).toMatch(/^image\/svg\+xml/);
    expect(await blob.text()).toContain("<title>Water cycle</title>");
  });

  it("draws again when the theme changes", async () => {
    themeState.current = {
      currentThemeType: "light",
      currentTheme: "atlas",
      fontSize: "16px",
      getTheme: () => atlas,
    };
    const { rerender } = view(block);
    await screen.findByRole("img");
    themeState.current = {
      currentThemeType: "dark",
      currentTheme: "night",
      fontSize: "16px",
      getTheme: () => ({
        ...atlas,
        colors: { ...atlas.colors, card: "#101010" },
      }),
    };
    rerender(
      <TooltipProvider>
        <MarkdownViewer content={block} />
      </TooltipProvider>,
    );
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
    expect(mermaid.initialize.mock.calls[1][0].themeVariables.background).toBe(
      "#101010",
    );
  });
});

describe("the shared diagram policy (ADR-0082)", () => {
  it("is what the viewer draws and sanitizes with", async () => {
    await renderDiagram("flowchart LR\na-->b", light);
    const config = mermaid.initialize.mock.calls[0][0];
    const { secure, ...rest } = policy.mermaid;
    expect(config).toMatchObject(rest);
    expect(config.secure).toEqual(secure);
    expect(MERMAID_RENDER_TIMEOUT_MS).toBe(policy.renderTimeoutMs);
    // Every forbidden tag from the shared settings is removed.
    const forbidden = policy.sanitizer.forbidTags
      .map((tag) => `<${tag}></${tag}>`)
      .join("");
    const clean = sanitizeDiagramSvg(svg(forbidden + "<g/>"))!.svg;
    for (const tag of policy.sanitizer.forbidTags)
      expect(clean.toLowerCase()).not.toContain(`<${tag.toLowerCase()}`);
  });

  it("exports with the app's own Atlas mapping", () => {
    expect(printTheme).toEqual({
      palette: "atlas",
      theme: "base",
      themeVariables: diagramThemeVariables(atlas.colors, false),
    });
  });
});
