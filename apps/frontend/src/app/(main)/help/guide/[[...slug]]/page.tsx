import { GuideMarkdown } from "@/features/guide/components/guide-markdown";
import { readGuidePage } from "@/features/guide/server/guide-files";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ slug?: string[] }> };

/** The user guide, served from `docs/guide` for the installed version (US-90.9). */
export default async function GuidePage({ params }: Props) {
  const { slug } = await params;
  const page = await readGuidePage(slug);
  if (!page) notFound();
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <nav aria-label="User guide" className="flex gap-4 text-sm">
        <Link className="underline" href="/help">
          Help center
        </Link>
        {slug?.length ? (
          <Link className="underline" href="/help/guide">
            User guide contents
          </Link>
        ) : null}
      </nav>
      <GuideMarkdown file={page.file} markdown={page.markdown} />
    </main>
  );
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const page = await readGuidePage(slug);
  const title = page?.markdown.match(/^#\s+(.+)$/m)?.[1];
  return { title: title ? `${title} · User guide` : "User guide" };
}
