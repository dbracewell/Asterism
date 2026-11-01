import { NotePage } from "@/features/study/components/note-page";

export default async function StudyNotePage({
  params,
}: {
  params: Promise<{ projectId: string; noteId: string }>;
}) {
  const { projectId, noteId } = await params;
  return <NotePage projectId={projectId} noteId={noteId} />;
}
