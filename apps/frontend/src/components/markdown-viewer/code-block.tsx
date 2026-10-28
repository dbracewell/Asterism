"use client";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { WrapTextIcon } from "lucide-react";
import { useState, type CSSProperties } from "react";
import SyntaxHighlighter from "react-syntax-highlighter";

/**
 * A fenced code block: a header with the language, a line-wrap toggle and a
 * copy action, above a keyboard-scrollable, highlighted body. The code is
 * untrusted and is only ever rendered as text.
 */
export function CodeBlock({
  text,
  language,
  theme,
  fontSize,
  scrollClassName,
}: {
  text: string;
  language?: string;
  theme: Record<string, CSSProperties>;
  fontSize: string;
  scrollClassName: string;
}) {
  const [wrap, setWrap] = useState(false);
  const wrapLabel = wrap ? "Scroll long lines" : "Wrap long lines";

  return (
    <div
      data-slot="code-block"
      data-wrap={wrap}
      className="not-prose rounded-surface border-border bg-card mb-5 max-w-full min-w-0 overflow-hidden border last:mb-0"
    >
      <div className="bg-muted text-muted-foreground border-border flex h-8 items-center gap-0.5 border-b pr-1 pl-3 text-xs">
        <span className="min-w-0 flex-1 truncate font-mono">
          {language ?? "text"}
        </span>
        <Hint asChild hint={wrapLabel}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Wrap long lines"
            aria-pressed={wrap}
            className="aria-pressed:bg-background aria-pressed:text-foreground"
            onClick={() => setWrap((value) => !value)}
          >
            <WrapTextIcon />
          </Button>
        </Hint>
        <CopyButton text={text} />
      </div>
      <div
        role="region"
        aria-label="Scrollable code"
        tabIndex={0}
        className={cn(scrollClassName, wrap && "overflow-x-hidden")}
      >
        <SyntaxHighlighter
          suppressHydrationWarning
          style={theme}
          language={language ?? "text"}
          PreTag="pre"
          wrapLongLines={wrap}
          codeTagProps={{
            style: {
              fontFamily: "inherit",
              ...(wrap && { overflowWrap: "anywhere" as const }),
            },
          }}
          customStyle={{
            fontFamily: "var(--font-mono)",
            margin: 0,
            borderRadius: 0,
            fontSize,
            padding: "0.75rem",
            width: wrap ? "100%" : "max-content",
            minWidth: "100%",
          }}
        >
          {text}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
