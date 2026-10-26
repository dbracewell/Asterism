"use client";
import { CopyButton } from "@/components/copy-button";
import { useTheme } from "@/features/theme/components/theme-context";
import { cn } from "@/lib/utils";
import "katex/dist/katex.min.css";
import { isValidElement, type HTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import SyntaxHighlighter from "react-syntax-highlighter";
import { syntaxTheme } from "./syntax-theme";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { markdownMathOptions, markdownUrlTransform } from "./policy";

const scrollRegion =
  "min-w-0 max-w-full overflow-x-auto overscroll-x-contain scroll-p-2 focus-visible:outline-2 focus-visible:outline-ring";

const MarkdownViewer = ({
  content,
  className,
  codeFontSize,
}: {
  content: string;
  className?: string;
  codeFontSize?: string;
}) => {
  const globalTheme = useTheme();
  const codeTheme = syntaxTheme(
    globalTheme.currentTheme,
    globalTheme.currentThemeType,
  );
  return (
    <div
      className={cn(
        "prose prose-asterism max-w-full min-w-0 [overflow-wrap:anywhere]",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        skipHtml
        urlTransform={markdownUrlTransform}
        rehypePlugins={[[rehypeKatex, markdownMathOptions]]}
        components={{
          a({ href, children, node, ...props }) {
            void node;
            if (!href) return <span>{children}</span>;
            return (
              <a {...props} href={href} rel="noreferrer noopener">
                {children}
              </a>
            );
          },
          img({ alt }) {
            return (
              <span className="text-muted-foreground">
                [Image omitted{alt ? `: ${alt}` : ""}]
              </span>
            );
          },
          table({ children, node, ...props }) {
            void node;
            return (
              <div
                role="region"
                aria-label="Scrollable table"
                tabIndex={0}
                className={scrollRegion}
              >
                <table {...props} className="w-max min-w-full">
                  {children}
                </table>
              </div>
            );
          },
          span({ children, className, node, ...props }) {
            void node;
            // Only the fixed KaTeX plugin can create these spans; raw HTML stays disabled.
            const math = className?.split(" ").includes("katex");
            return (
              <span
                {...props}
                className={cn(
                  className,
                  math &&
                    `${scrollRegion} inline-block overflow-y-hidden align-middle`,
                )}
                style={
                  math ? { ...props.style, textAlign: "start" } : props.style
                }
                {...(math
                  ? {
                      role: "region",
                      "aria-label": "Scrollable math",
                      tabIndex: 0,
                    }
                  : {})}
              >
                {children}
              </span>
            );
          },
          pre({ children }) {
            const code = isValidElement<HTMLAttributes<HTMLElement>>(children)
              ? children.props
              : null;
            const text = String(code?.children ?? "").replace(/\n$/, "");
            const language = /language-([\w-]+)/.exec(
              code?.className ?? "",
            )?.[1];
            return (
              <div className="not-prose max-w-full min-w-0 rounded-md border">
                <div className="flex items-center justify-between gap-2 px-2 pt-1 text-xs font-normal">
                  <span>{language ?? "Code"}</span>
                  <CopyButton text={text} />
                </div>
                <div
                  role="region"
                  aria-label="Scrollable code"
                  tabIndex={0}
                  className={scrollRegion}
                >
                  <SyntaxHighlighter
                    suppressHydrationWarning
                    style={codeTheme}
                    language={language ?? "text"}
                    PreTag="pre"
                    codeTagProps={{ style: { fontFamily: "inherit" } }}
                    customStyle={{
                      fontFamily: "var(--font-mono)",
                      margin: 0,
                      fontSize: codeFontSize ?? globalTheme.fontSize,
                      borderTopLeftRadius: 0,
                      borderTopRightRadius: 0,
                      width: "max-content",
                      minWidth: "100%",
                    }}
                  >
                    {text}
                  </SyntaxHighlighter>
                </div>
              </div>
            );
          },
          code({ children, node, ...props }) {
            void node;
            return (
              <code
                {...props}
                className="px-1.5 py-0.5 font-mono text-sm whitespace-pre-wrap before:content-none after:content-none"
              >
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
export default MarkdownViewer;
