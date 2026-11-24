/**
 * The guided setup's steps (EPIC-101): the Admin Settings sections in the order
 * a new installation needs them, each with what it does, its default and what
 * people see while it is off. Every Admin Settings section is either a step or
 * listed in NOT_STEPS with a reason; a test keeps that true.
 */

export interface SetupStep {
  /** Stored in setup progress; also the Admin Settings section shown. */
  id: string;
  title: string;
  /** What it does, and its default. */
  explanation: string;
  /** What people see while it is off or unset, when that matters. */
  whenOff?: string;
}

export const SETUP_STEPS: readonly SetupStep[] = [
  {
    id: "providers",
    title: "Providers and models",
    explanation:
      "Connect the services your models come from and choose which models people can use. Moving from another installation? Import its settings file under Export instead.",
    whenOff: "Without an enabled model, nobody can chat.",
  },
  {
    id: "group-settings",
    title: "Groups and budgets",
    explanation:
      "Everyone is in one group: Student, Educator, Admin or one you add. Each group can be limited to some models and tools, and given daily and monthly token budgets.",
    whenOff:
      "By default every group may use every enabled model and tool, with no budget.",
  },
  {
    id: "usage",
    title: "Usage time zone",
    explanation:
      "Daily budgets reset at midnight and monthly ones on the 1st, in this time zone. Use your school's.",
    whenOff: "Until you change it, days follow UTC.",
  },
  {
    id: "tools",
    title: "Tools and search",
    explanation:
      "Choose the actions agents may take, such as searching or reading the web, and the search provider they use. Each person then picks tools for their own agent.",
    whenOff: "No tools are on until you turn them on.",
  },
  {
    id: "image-captioning",
    title: "Image captioning",
    explanation:
      "Captions describe the pictures in uploaded files. Search finds a picture only by its caption.",
    whenOff:
      "Captioning is off by default. While it is off, pictures are kept and can be attached to chats, but search can't find them.",
  },
  {
    id: "skills",
    title: "Skills",
    explanation:
      "Let people use their own skills, reusable instructions added to a chat with /. Skills only add instructions; they grant nothing.",
    whenOff: "Off by default. While off, people don't see skills at all.",
  },
  {
    id: "canvas",
    title: "Canvas",
    explanation:
      "Let Asterism write long documents, code and web pages in a panel beside the chat, where people can edit and download them.",
    whenOff: "Off by default. While off, the canvas setting is hidden.",
  },
  {
    id: "memory",
    title: "Memory",
    explanation:
      "Let Asterism keep in mind what helps it work with each person, such as how they learn best. Only the person sees their memories, never educators or administrators.",
    whenOff: "Off by default. While off, people don't see memory settings.",
  },
  {
    id: "study-chat",
    title: "Study in chat",
    explanation:
      "Let the assistant draft flashcard decks and practice quizzes in project chats. People review each draft and choose whether to save it.",
    whenOff:
      "On by default. Turned off, the assistant won't offer to draft them.",
  },
  {
    id: "image-generation",
    title: "Image generation",
    explanation:
      "Let people create images in chats, with a provider you choose or a model on this server, optionally for some groups only.",
    whenOff: "Off by default. While off, there is no Create image option.",
  },
  {
    id: "chatgpt",
    title: "ChatGPT plans",
    explanation:
      "Let people connect their own ChatGPT plan and run chats on its models. This only works when the browser is on the computer that runs Asterism.",
    whenOff: "Off by default. While off, people don't see the ChatGPT section.",
  },
  {
    id: "context-compaction",
    title: "Context compaction",
    explanation:
      "When a long chat nears its model's limit, Asterism summarises the earlier part so the conversation can continue. Set when that happens and which model writes the summary.",
  },
  {
    id: "theme_editor",
    title: "Theme",
    explanation:
      "Make a color theme in your school's colors, or adjust a built-in one. People choose their theme in their own settings.",
  },
  {
    id: "educators",
    title: "Educators",
    explanation:
      "Approve the people who may run classes. Educators can share course projects and see class totals, never students' chats or memories.",
  },
];

/** Admin Settings sections that are not setup steps, and why. */
export const NOT_STEPS: Record<string, string> = {
  setup: "This walkthrough.",
  "user-permissions": "People join on their own; manage them when they do.",
  status: "Read-only.",
  export: "Offered in the providers step, to import another installation.",
};

export type StepState = "done" | "skipped" | undefined;

/** The first step not done or skipped, or null when every step was reviewed. */
export function nextStep(
  states: Record<string, { state: string } | undefined>,
): SetupStep | null {
  return SETUP_STEPS.find((step) => !states[step.id]) ?? null;
}

export function setupHref(step?: string) {
  const query = new URLSearchParams({ t: "admin", setting: "setup" });
  if (step) query.set("step", step);
  return `/settings?${query}`;
}
