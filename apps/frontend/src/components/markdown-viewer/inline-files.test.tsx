import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { InlineFileReference } from "@/lib/client";
import MarkdownViewer from ".";
import { InlineFilesProvider, InlineFilesScope } from "./inline-files";
import { fileTokenId, markdownUrlTransform } from "./policy";

vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => ({ currentThemeType: "light", fontSize: "16px" }),
}));
vi.mock("@/components/api-download", () => ({
  APIDownload: ({ linkText }: { linkText: string }) => <span>{linkText}</span>,
}));
const downloads = vi.fn();
const previews = vi.fn();
const previewBodies: Record<string, object> = {};
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatFileDownloadOptions: ({
    path,
  }: {
    path: { chat_id: string; file_id: string };
  }) => ({
    queryKey: ["chatFileDownload", path],
    queryFn: async () => {
      downloads(path);
      return new Blob(["bytes"]);
    },
  }),
  chatFileGetPreviewOptions: ({
    path,
  }: {
    path: { chat_id: string; file_id: string };
  }) => ({
    queryKey: ["chatFileGetPreview", path],
    queryFn: async () => {
      previews(path);
      return previewBodies[path.file_id];
    },
  }),
}));

const IMAGE = "10000000-0000-4000-8000-000000000001";
const SVG = "10000000-0000-4000-8000-000000000002";
const DOC = "10000000-0000-4000-8000-000000000003";
const GONE = "10000000-0000-4000-8000-000000000004";
const FOREIGN = "10000000-0000-4000-8000-000000000005";
const BIG = "10000000-0000-4000-8000-000000000006";
const ref = (
  file_id: string,
  extra: Partial<InlineFileReference> = {},
): InlineFileReference => ({
  file_id,
  available: true,
  role: "produced",
  name: `${file_id.slice(-1)}.png`,
  mime_type: "image/png",
  kind: "image",
  size: 10,
  ...extra,
});
const files = [
  ref(IMAGE, { name: "chart.png" }),
  ref(SVG, { name: "drawing.svg", mime_type: "image/svg+xml", kind: "other" }),
  ref(DOC, {
    name: "deck.pptx",
    mime_type: "application/vnd.ms-powerpoint",
    kind: "document",
  }),
  ref(GONE, { available: false, name: "gone.png" }),
  ref(BIG, { name: "huge.png", size: 50 * 1024 * 1024 }),
];
const token = (id: string) => `asterism-file:${id}`;

const created: string[] = [];
beforeEach(() => {
  downloads.mockClear();
  previews.mockClear();
  created.length = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    created.push(blob.type);
    return `blob:test/${created.length}`;
  });
  URL.revokeObjectURL = vi.fn();
});

function view(
  content: string,
  value: { chatId: string | null; files: InlineFileReference[] | null } | null,
) {
  const viewer = <MarkdownViewer content={content} />;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      {value ? (
        <InlineFilesProvider value={value}>{viewer}</InlineFilesProvider>
      ) : (
        viewer
      )}
    </QueryClientProvider>,
  );
}

it("accepts only the exact lowercase token grammar", () => {
  expect(fileTokenId(token(IMAGE))).toBe(IMAGE);
  for (const near of [
    token(IMAGE).toUpperCase(),
    `asterism-file://${IMAGE}`,
    `${token(IMAGE)}?x=1`,
    `${token(IMAGE)}#x`,
    `${token(IMAGE)}/x`,
    ` ${token(IMAGE)}`,
    `https://example.test/${token(IMAGE)}`,
    "asterism-file:not-a-uuid",
  ])
    expect(fileTokenId(near)).toBeNull();
  const img = { tagName: "img" } as never;
  const a = { tagName: "a" } as never;
  expect(markdownUrlTransform(token(IMAGE), "src", img)).toBe(token(IMAGE));
  expect(markdownUrlTransform(token(IMAGE), "href", a)).toBe(token(IMAGE));
  expect(markdownUrlTransform(`${token(IMAGE)}?x`, "src", img)).toBeUndefined();
  expect(markdownUrlTransform(`${token(IMAGE)}?x`, "href", a)).toBeUndefined();
});

it("renders resolved images through the scoped route only, as typed blobs", async () => {
  const { container } = view(
    `![Quarterly chart](${token(IMAGE)}) and ![](${token(SVG)})`,
    { chatId: "chat-1", files },
  );
  const chart = await screen.findByRole("img", { name: "Quarterly chart" });
  expect(chart).toHaveAttribute("src", expect.stringMatching(/^blob:/));
  expect(
    await screen.findByRole("img", { name: "drawing.svg" }),
  ).toHaveAttribute("src", expect.stringMatching(/^blob:/));
  expect(downloads.mock.calls.map(([path]) => path)).toEqual([
    { chat_id: "chat-1", file_id: IMAGE },
    { chat_id: "chat-1", file_id: SVG },
  ]);
  expect(created.sort()).toEqual(["image/png", "image/svg+xml"]);
  // No token ever reaches a DOM href or src.
  expect(container.innerHTML).not.toContain("asterism-file:");
  expect(
    container.querySelector("svg script, object, embed, iframe"),
  ).toBeNull();
});

it("opens a lightbox with download from the inline image", async () => {
  view(`![Quarterly chart](${token(IMAGE)})`, { chatId: "chat-1", files });
  fireEvent.click(
    await screen.findByRole("button", { name: "Open image Quarterly chart" }),
  );
  expect(await screen.findByRole("dialog")).toHaveTextContent(
    "image/png · 10 B",
  );
  expect(screen.getByText("Download")).toBeInTheDocument();
  expect(downloads).toHaveBeenCalledTimes(1);
});

it("shows unresolved, unavailable, foreign and unscoped tokens inertly without requests", () => {
  const { container } = view(
    [
      `![missing](${token(GONE)})`,
      `![foreign](${token(FOREIGN)})`,
      `[link to foreign](${token(FOREIGN)})`,
      `![near](${token(IMAGE)}?download=1)`,
      `[near link](asterism-file://${IMAGE})`,
      `\`${token(IMAGE)}\``,
    ].join("\n\n"),
    { chatId: "chat-1", files },
  );
  expect(screen.getByText("File unavailable: missing")).toBeInTheDocument();
  expect(screen.getByText("File unavailable: foreign")).toBeInTheDocument();
  expect(
    screen.getByText("File unavailable: link to foreign"),
  ).toBeInTheDocument();
  expect(screen.getByText("[Image omitted: near]")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "near link" })).toBeNull();
  expect(screen.getByText(token(IMAGE))).toBeInTheDocument(); // literal code
  expect(screen.queryByRole("img")).toBeNull();
  expect(container.querySelectorAll("[href], [src]")).toHaveLength(0);
  expect(downloads).not.toHaveBeenCalled();
});

it("is inert without a provider and pending while streaming", () => {
  view(`![chart](${token(IMAGE)})`, null);
  expect(screen.getByText("File unavailable: chart")).toBeInTheDocument();
  view(`![chart](${token(IMAGE)})`, { chatId: "chat-1", files: null });
  expect(screen.getByText("File pending: chart")).toBeInTheDocument();
  expect(downloads).not.toHaveBeenCalled();
});

it("renders mentions, documents and oversized images as chips", async () => {
  view(
    `See [the deck](${token(DOC)}), ![](${token(BIG)}) and [chart](${token(IMAGE)}).`,
    { chatId: "chat-1", files },
  );
  expect(
    screen.getByRole("button", { name: "Open file the deck" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Open file huge.png" }),
  ).toBeInTheDocument();
  expect(downloads).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open file chart" }));
  expect(await screen.findByRole("img", { name: "chart" })).toBeInTheDocument();
  await waitFor(() => expect(downloads).toHaveBeenCalledTimes(1));
});

it("scopes a sub-agent's output to its own resolved list", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InlineFilesProvider value={{ chatId: "chat-1", files }}>
        <InlineFilesScope files={[]}>
          <MarkdownViewer content={`![chart](${token(IMAGE)})`} />
        </InlineFilesScope>
      </InlineFilesProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByText("File unavailable: chart")).toBeInTheDocument();
});

const OFFICE = "application/vnd.openxmlformats-officedocument";
const cards = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    name: "report.docx",
    mime: `${OFFICE}.wordprocessingml.document`,
    counts: { page_count: 3 },
    meta: "Word document · 2.0 KB · 3 pages",
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    name: "deck.pptx",
    mime: `${OFFICE}.presentationml.presentation`,
    counts: { slide_count: 1 },
    meta: "PowerPoint presentation · 2.0 KB · 1 slide",
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    name: "book.xlsx",
    mime: `${OFFICE}.spreadsheetml.sheet`,
    counts: { sheet_count: 2 },
    meta: "Excel workbook · 2.0 KB · 2 sheets",
  },
  {
    id: "30000000-0000-4000-8000-000000000004",
    name: "paper.pdf",
    mime: "application/pdf",
    counts: { page_count: 5 },
    meta: "PDF · 2.0 KB · 5 pages",
  },
];

it("renders a document card for each supported type with literal excerpts", async () => {
  const references = cards.map((card) =>
    ref(card.id, {
      name: card.name,
      mime_type: card.mime,
      kind: "document",
      size: 2048,
    }),
  );
  for (const card of cards)
    previewBodies[card.id] = {
      file_id: card.id,
      kind: "document",
      mime_type: card.mime,
      status: "ready",
      excerpt: `**${card.name}** <img src="/untrusted/${card.name}">`,
      truncated: card.name === "paper.pdf",
      page_count: null,
      slide_count: null,
      sheet_count: null,
      ...card.counts,
    };
  const { container } = view(
    cards.map((card) => `![](${token(card.id)})`).join("\n\n"),
    { chatId: "chat-1", files: references },
  );
  for (const card of cards) {
    const group = await screen.findByRole("group", {
      name: new RegExp(`${card.name}$`),
    });
    expect(group).toHaveTextContent(card.name);
    expect(await within(group).findByText(card.meta)).toBeInTheDocument();
    expect(group).toHaveTextContent(`**${card.name}** <img`);
    expect(
      within(group).getByRole("button", { name: `Open ${card.name}` }),
    ).toBeInTheDocument();
    expect(within(group).getByText("Download")).toBeInTheDocument();
  }
  // Excerpts are text: no element from the file content is ever installed.
  expect(container.querySelectorAll("img, strong")).toHaveLength(0);
  expect(downloads).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Open paper.pdf" }));
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByRole("region", { name: "Text preview" }),
  ).toHaveTextContent("**paper.pdf**");
  expect(dialog).toHaveTextContent("Showing the start of the file.");
  expect(dialog.querySelectorAll("img, strong")).toHaveLength(0);
});

it("opens a document mention's preview from its chip", async () => {
  const id = cards[0].id;
  previewBodies[id] = {
    file_id: id,
    kind: "document",
    mime_type: cards[0].mime,
    status: "pending",
    excerpt: null,
    truncated: false,
  };
  view(`See [the report](${token(id)}).`, {
    chatId: "chat-1",
    files: [
      ref(id, {
        name: "report.docx",
        mime_type: cards[0].mime,
        kind: "document",
      }),
    ],
  });
  expect(previews).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open file the report" }));
  expect(
    await screen.findByText("The preview is still being prepared."),
  ).toBeInTheDocument();
});
