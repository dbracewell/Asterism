"use client";
import { CopyButton } from "@/components/copy-button";
import { useTheme } from "@/features/theme/components/theme-context";
import { cn } from "@/lib/utils";
import "katex/dist/katex.min.css";
import { ClassAttributes, HTMLAttributes } from "react";
import ReactMarkdown, { ExtraProps } from "react-markdown";
import SyntaxHighlighter from "react-syntax-highlighter";
import { vs, vs2015 } from "react-syntax-highlighter/dist/esm/styles/hljs";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export interface MarkdownCodeProps
  extends
    HTMLAttributes<HTMLElement>,
    ClassAttributes<HTMLElement>,
    ExtraProps {
  inline?: boolean;
}

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
  const syntaxTheme = globalTheme.currentMode === "dark" ? vs2015 : vs;

  return (
    <div className={cn("prose prose-asterism max-w-none", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          [
            rehypeKatex,
            {
              output: "html",
              trust: (context: { command: string }) =>
                ["\\htmlId", "\\href", "\\label"].includes(context.command),
              strict: false,
              throwOnError: false,
            },
          ],
        ]}
        components={{
          code({
            inline,
            className,
            children,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            ref,
            ...props
          }: MarkdownCodeProps) {
            const contentString = String(children).replace(/\n$/, "");
            const match = /language-(\w+)/.exec(className || "");
            const language = match ? match[1] : "";

            if (!inline && match) {
              return (
                <div
                  className="flex flex-col overflow-auto"
                  style={{
                    backgroundColor:
                      (syntaxTheme.hljs.background as string) || "transparent",
                  }}
                >
                  <div className="flex items-center justify-between px-2 pt-1 text-xs font-normal">
                    <div>{language}</div>
                    <CopyButton text={contentString} />
                  </div>
                  <SyntaxHighlighter
                    suppressHydrationWarning
                    {...props}
                    style={syntaxTheme}
                    language={language}
                    PreTag="div"
                    customStyle={{
                      flex: 1,
                      margin: 0,
                      fontSize: codeFontSize ?? globalTheme.fontSize,
                      borderTopLeftRadius: 0,
                      borderTopRightRadius: 0,
                    }}
                  >
                    {contentString}
                  </SyntaxHighlighter>
                </div>
              );
            }

            return (
              <code
                className="px-1.5 py-0.5 text-sm whitespace-pre-wrap before:content-none after:content-none"
                {...props}
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
