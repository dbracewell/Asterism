"use client";
import MarkdownViewer from "@/components/markdown-viewer";
import { proseSample } from "@/components/markdown-viewer/test-content";
import { TooltipProvider } from "@/components/ui/tooltip";

// Prose on the two surfaces chat renders it on: the page (assistant replies)
// and a card (user bubbles, previews). Uses the cookie-selected theme.
export function ProseHarness() {
  return (
    <TooltipProvider>
      <main className="bg-background text-foreground grid min-h-dvh gap-6 p-6 lg:grid-cols-2">
        <section aria-label="Prose on background" className="min-w-0">
          <MarkdownViewer content={proseSample} />
        </section>
        <section
          aria-label="Prose on card"
          className="bg-card text-card-foreground border-border rounded-surface min-w-0 border p-4"
        >
          <MarkdownViewer content={proseSample} />
        </section>
      </main>
    </TooltipProvider>
  );
}
