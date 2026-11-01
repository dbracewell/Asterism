import { QuizTake } from "@/features/study/components/quiz-take";

export default async function TakeQuizPage({
  params,
}: {
  params: Promise<{ projectId: string; quizId: string }>;
}) {
  const { projectId, quizId } = await params;
  return <QuizTake projectId={projectId} quizId={quizId} />;
}
