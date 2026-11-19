import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveGuideHref, slugify } from "../links";

/**
 * The user guide's own Markdown renderer (US-90.9). The guide is trusted,
 * checked-in documentation, so this is separate from the chat viewer
 * (`components/markdown-viewer`), whose URL policy for untrusted model output
 * is unchanged. Raw HTML is still not rendered.
 */

type Node = {
  type: string;
  value?: string;
  children?: Node[];
  data?: { hProperties?: Record<string, unknown> };
};

const text = (node: Node): string =>
  node.value ?? (node.children ?? []).map(text).join("");

/** Heading ids as GitHub and `pnpm docs:check` make them, so anchors resolve. */
function headingIds() {
  return (tree: Node) => {
    const seen = new Map<string, number>();
    const visit = (node: Node) => {
      if (node.type === "heading") {
        const base = slugify(text(node));
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            id: count === 0 ? base : `${base}-${count}`,
          },
        };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function components(file: string): Components {
  return {
    a: ({ href = "", children }) => {
      const target = resolveGuideHref(file, href);
      if (!target) return <a href={href}>{children}</a>;
      return target.kind === "internal" ? (
        <Link href={target.href}>{children}</Link>
      ) : (
        <a href={target.href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
    img: ({ src, alt }) => {
      const target =
        typeof src === "string" ? resolveGuideHref(file, src) : null;
      if (!target || target.kind !== "internal") return null;
      return (
        // Screenshots of unknown size from the guide's own folder.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={target.href}
          alt={alt ?? ""}
          loading="lazy"
          className="rounded-surface border"
        />
      );
    },
  };
}

export function GuideMarkdown({
  file,
  markdown,
}: {
  /** The page's path in the guide, such as `02-chatting/canvas.md`. */
  file: string;
  markdown: string;
}) {
  return (
    <div className="prose prose-asterism max-w-3xl min-w-0 wrap-anywhere">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, headingIds]}
        components={components(file)}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
