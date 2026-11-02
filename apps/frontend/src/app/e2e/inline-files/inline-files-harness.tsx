"use client";
import MarkdownViewer from "@/components/markdown-viewer";
import { InlineFilesProvider } from "@/components/markdown-viewer/inline-files";
import type { InlineFileReference } from "@/lib/client";

export const INLINE_CHAT = "e2e-inline-chat";
export const PNG_ID = "20000000-0000-4000-8000-000000000001";
export const SVG_ID = "20000000-0000-4000-8000-000000000002";
export const FOREIGN_ID = "20000000-0000-4000-8000-000000000003";
export const GONE_ID = "20000000-0000-4000-8000-000000000004";
export const DOCX_ID = "20000000-0000-4000-8000-000000000005";

const files: InlineFileReference[] = [
  {
    file_id: PNG_ID,
    available: true,
    role: "produced",
    name: "chart.png",
    mime_type: "image/png",
    kind: "image",
    size: 68,
  },
  {
    file_id: SVG_ID,
    available: true,
    role: "produced",
    name: "drawing.svg",
    mime_type: "image/svg+xml",
    kind: "other",
    size: 300,
  },
  { file_id: GONE_ID, available: false },
  {
    file_id: DOCX_ID,
    available: true,
    role: "produced",
    name: "report.docx",
    mime_type:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document",
    size: 2048,
  },
];

const token = (id: string) => `asterism-file:${id}`;
const content = [
  `Here is the chart: ![Quarterly chart](${token(PNG_ID)})`,
  `And the drawing: ![Script drawing](${token(SVG_ID)})`,
  `Foreign: ![Foreign image](${token(FOREIGN_ID)}) and [foreign link](${token(FOREIGN_ID)})`,
  `Deleted: ![Deleted image](${token(GONE_ID)})`,
  `URL-shaped: ![Shaped](/api/py/chat/${INLINE_CHAT}/files/${PNG_ID}) [shaped link](asterism-file://${PNG_ID}) ![query](${token(PNG_ID)}?x=1) ![remote](https://untrusted.test/${token(PNG_ID)})`,
  `Literal: \`${token(PNG_ID)}\``,
  `Mention: see [the chart](${token(PNG_ID)}) for details.`,
  `![](${token(DOCX_ID)})`,
].join("\n\n");

export function InlineFilesHarness() {
  return (
    <main className="flex h-dvh flex-col gap-6 overflow-auto p-6">
      <h1>Inline file verification</h1>
      <section aria-label="Resolved reply">
        <InlineFilesProvider value={{ chatId: INLINE_CHAT, files }}>
          <MarkdownViewer content={content} />
        </InlineFilesProvider>
      </section>
      <section aria-label="Unresolved reply">
        <MarkdownViewer content={`![Quarterly chart](${token(PNG_ID)})`} />
      </section>
    </main>
  );
}
