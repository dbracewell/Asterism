import { QuizPage } from "@/features/study/components/quiz-page";

export default async function StudyQuizPage({
  params,
}: {
  params: Promise<{ projectId: string; quizId: string }>;
}) {
  const { projectId, quizId } = await params;
  return <QuizPage projectId={projectId} quizId={quizId} />;
}
