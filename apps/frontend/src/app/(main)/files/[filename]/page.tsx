import { notFound } from "next/navigation";
import { FileView } from "@/features/files/file-view";
import { safeDecodeURIComponent } from "@/lib/safe-decode";

type FilePageProps = { params: Promise<{ filename: string }> };

export default async function FilePage({ params }: FilePageProps) {
  const { filename } = await params;
  // A malformed escape such as %ZZ is not a file name: show not found (US-117.2).
  const name = safeDecodeURIComponent(filename);
  if (name === null) notFound();
  return <FileView filename={name} />;
}
