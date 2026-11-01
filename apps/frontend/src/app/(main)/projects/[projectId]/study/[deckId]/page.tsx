import { StudyDeckPage } from "@/features/study/components/study-deck-page";

export default async function DeckPage({
  params,
}: {
  params: Promise<{ projectId: string; deckId: string }>;
}) {
  const { projectId, deckId } = await params;
  return <StudyDeckPage projectId={projectId} deckId={deckId} />;
}
