import type { StudyQuizResult } from "@/lib/client";

export type StudyVerdict = StudyQuizResult["verdict"];

export const MAX_QUIZ_QUESTIONS = 20;
export const QUIZ_TITLE_MAX = 120;
export const QUIZ_RESPONSE_MAX = 2000;

/** "2.5 of 4" — points, where a partial short answer counts half. */
export function pointsLabel(score: number, questionCount: number) {
  const points = Number.isInteger(score) ? `${score}` : score.toFixed(1);
  return `${points} of ${questionCount}`;
}

/** A 0–1 fraction as a whole percentage, such as "63%". */
export function percentLabel(fraction: number) {
  return `${Math.round(fraction * 100)}%`;
}

export function questionCountLabel(count: number) {
  return count === 1 ? "1 question" : `${count} questions`;
}

export const VERDICT_LABELS: Record<StudyVerdict, string> = {
  correct: "Correct",
  partial: "Partly correct",
  incorrect: "Incorrect",
  ungraded: "Not graded",
};

/** Option letters as shown to the learner: A, B, C… */
export function optionLetter(index: number) {
  return String.fromCharCode(65 + index);
}
