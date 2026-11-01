import { QuizResults } from "@/features/study/components/quiz-results";

export default async function QuizAttemptPage({
  params,
}: {
  params: Promise<{ projectId: string; quizId: string; attemptId: string }>;
}) {
  const { projectId, quizId, attemptId } = await params;
  return (
    <QuizResults projectId={projectId} quizId={quizId} attemptId={attemptId} />
  );
}
