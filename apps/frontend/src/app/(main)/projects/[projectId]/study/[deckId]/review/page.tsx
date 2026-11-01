import { ReviewSession } from "@/features/study/components/review-session";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ projectId: string; deckId: string }>;
}) {
  const { projectId, deckId } = await params;
  return <ReviewSession projectId={projectId} deckId={deckId} />;
}
