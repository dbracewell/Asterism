import { FileView } from "@/features/files/file-view";

type FilePageProps = { params: Promise<{ filename: string }> };

export default async function FilePage({ params }: FilePageProps) {
  const { filename } = await params;
  return <FileView filename={decodeURIComponent(filename)} />;
}
