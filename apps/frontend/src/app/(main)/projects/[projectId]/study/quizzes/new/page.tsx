import { QuizGenerate } from "@/features/study/components/quiz-generate";

export default async function NewQuizPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <QuizGenerate projectId={projectId} />;
}
