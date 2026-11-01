import { CardDraftReview } from "@/features/study/components/card-draft-review";

export default async function DraftsPage({
  params,
}: {
  params: Promise<{ projectId: string; deckId: string }>;
}) {
  const { projectId, deckId } = await params;
  return <CardDraftReview projectId={projectId} deckId={deckId} />;
}
