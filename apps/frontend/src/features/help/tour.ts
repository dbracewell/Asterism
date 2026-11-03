/**
 * The guided first-chat tour (US-61.4).
 *
 * Each step highlights one composer control, found by its `data-tour`
 * attribute. Step text follows the help registry's accuracy rules (ADR-0032).
 * Steps whose control is not on the page, such as skills while the admin
 * policy is off, are skipped.
 */

export type TourStepId =
  | "composer"
  | "persona"
  | "skills"
  | "learning-mode"
  | "model"
  | "attachments";

export interface TourStep {
  id: TourStepId;
  /** The `data-tour` value of the highlighted control. */
  target: string;
  title: string;
  body: string;
  /** Shown only when the skill slash menu can offer skills. */
  needsSkills?: boolean;
}

export const firstChatTourSteps: readonly TourStep[] = [
  {
    id: "composer",
    target: "composer",
    title: "Write your message",
    body: "Type your question or task here. Press Enter to send, or Shift+Enter for a new line. The buttons below the box change how the assistant answers.",
  },
  {
    id: "persona",
    target: "persona",
    title: "Persona",
    body: "Pick which description of you the assistant keeps in mind, such as your level and goals. It shapes how replies are written; it doesn't give the assistant extra tools or files.",
  },
  {
    id: "skills",
    target: "message",
    title: "Skills",
    body: "Type / in the message box to add one of your skills. Active skills appear as chips above the box. A skill only adds instructions.",
    needsSkills: true,
  },
  {
    id: "learning-mode",
    target: "learning-mode",
    title: "Learning mode",
    body: "Standard gives direct answers. The other modes, such as Tutor, Explain-back and Draft feedback, help you work things out yourself.",
  },
  {
    id: "model",
    target: "model",
    title: "Model",
    body: "Choose the AI model that writes the replies. Models differ in speed, cost and abilities, such as reading images.",
  },
  {
    id: "attachments",
    target: "attachments",
    title: "Attachments",
    body: "Add files such as notes, code or images so the assistant can read them. Select the ? button in this toolbar any time to learn what each control does.",
  },
];

/** The URL that starts the tour on the new-chat page. */
export const FIRST_CHAT_TOUR_PARAM = "tour";
export const FIRST_CHAT_TOUR_VALUE = "first-chat";
export const firstChatTourHref = `/?${FIRST_CHAT_TOUR_PARAM}=${FIRST_CHAT_TOUR_VALUE}`;

/** The tour link from `pathname`; on the new-chat page it keeps the project. */
export function tourHrefFrom(pathname: string, search: URLSearchParams) {
  if (pathname !== "/") return firstChatTourHref;
  const params = new URLSearchParams(search);
  params.set(FIRST_CHAT_TOUR_PARAM, FIRST_CHAT_TOUR_VALUE);
  return `/?${params.toString()}`;
}

/** The rendered, visible control for a step, if any. */
export function tourTarget(
  step: TourStep,
  root: ParentNode = document,
): HTMLElement | null {
  const element = root.querySelector<HTMLElement>(
    `[data-tour="${step.target}"]`,
  );
  // Controls inside a hidden region (for example a collapsed toolbar) don't count.
  if (!element || element.closest("[hidden], [inert]")) return null;
  return element;
}

/** The steps that can be shown now, in order. */
export function availableTourSteps(
  skillsEnabled: boolean,
  root: ParentNode = document,
): TourStep[] {
  return firstChatTourSteps.filter(
    (step) =>
      (!step.needsSkills || skillsEnabled) && tourTarget(step, root) !== null,
  );
}
