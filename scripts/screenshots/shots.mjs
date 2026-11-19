// The user guide's screenshot list (US-89.1).
//
// Each entry names its image, says what it shows (the alt text the guide uses),
// and how to reach the screen:
//
//   name      image file name without extension, under docs/guide/images/
//   alt       what the image shows, for the guide's alt text
//   as        whose browser: admin, educator, student or classmate
//   path      the page, given the ids the seed returned
//   viewport  "desktop" (default) or "phone"
//   ready     text that must be on screen before the picture is taken
//   steps     optional: async (page, ids) => {} to open a menu, fill a form…
//   target    optional: a CSS selector to photograph one part of the screen
//   file      optional: a path from the repository root instead of docs/guide/images/
//
// First-run entries (stage "first-run") are taken while the administrator sets
// the instance up in the browser, before any other data exists; their order is
// fixed by that flow.
//
// A shot that cannot be taken fails the run.

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
};

export const shots = [
  // --- First-run setup (taken during the setup flow) -------------------------------
  {
    stage: "first-run",
    name: "setup-admin-account",
    alt: "The first-run sign-up form, asking for the administrator's name, email, password and the admin passkey",
  },
  {
    stage: "first-run",
    name: "setup-connect-provider",
    alt: "The setup card for connecting a model provider, with OpenAI-compatible selected and a base URL filled in",
  },
  {
    stage: "first-run",
    name: "setup-enable-models",
    alt: "The setup card listing the models the provider offers, with a default model and a draft model chosen",
  },

  // --- Chatting --------------------------------------------------------------------
  {
    name: "chat-tutor",
    file: "docs/images/asterism-chat.png",
    alt: "A chat in Tutor mode: the student asks how photosynthesis works and Asterism answers with a question back",
    as: "student",
    path: (ids) => `/c/${ids.chats.general}`,
    ready: ["what do you think a plant needs"],
  },
  {
    name: "chat-sources",
    alt: "An answer about the light-dependent reactions, with a row of source chips naming the student's files and numbered citations in the text",
    as: "student",
    path: (ids) => `/c/${ids.chats.sourced}`,
    ready: ["According to your files"],
  },
  {
    name: "chat-branches",
    alt: "A chat whose answer was regenerated, with the switcher under the answer showing 2 / 2",
    as: "student",
    path: (ids) => `/c/${ids.chats.branched}`,
    ready: ["three phases", "2 / 2"],
  },
  {
    name: "chat-canvas",
    alt: "A chat with the canvas open beside it, showing a lab report outline",
    as: "student",
    path: (ids) => `/c/${ids.chats.lab}`,
    ready: ["started an outline"],
    steps: async (page) => {
      await page
        .getByRole("button", { name: /^Canvas/ })
        .first()
        .click();
      await page.getByText("Document · version 1").click();
      await page
        .getByText("The effect of light on photosynthesis")
        .first()
        .waitFor();
    },
  },
  {
    name: "chat-new-phone",
    viewport: "phone",
    alt: "The new chat screen on a phone, with the message box at the bottom",
    as: "student",
    path: () => "/",
    ready: ["Demo Tutor"],
  },

  // --- Files and projects ----------------------------------------------------------
  {
    name: "files-library",
    alt: "The Files library listing the student's notes, a PDF handout, a spreadsheet of results and a leaf diagram",
    as: "student",
    path: () => "/files",
    ready: ["photosynthesis-notes.md", "leaf-diagram.png"],
  },
  {
    name: "project-overview",
    alt: "The Biology 101 project page with its goal, files and chats",
    as: "student",
    path: (ids) => `/projects/${ids.project}`,
    ready: ["Biology 101"],
  },

  // --- Studying --------------------------------------------------------------------
  {
    name: "study-deck",
    alt: "The Photosynthesis flashcard deck with its cards and the number due for review",
    as: "student",
    path: (ids) => `/projects/${ids.project}/study/${ids.deck}`,
    ready: ["Where do the light-dependent reactions take place?"],
  },
  {
    name: "study-quiz",
    alt: "The Photosynthesis check practice quiz, ready to take",
    as: "student",
    path: (ids) => `/projects/${ids.project}/study/quizzes/${ids.quiz}`,
    ready: ["Photosynthesis check"],
  },

  // --- Educators -------------------------------------------------------------------
  {
    name: "class-overview",
    alt: "The educator's class page for Biology 101, Period 3, with two students and the published course",
    as: "educator",
    path: (ids) => `/classes/${ids.classroom}`,
    ready: ["Period 3"],
  },

  // --- Administrators --------------------------------------------------------------
  {
    name: "admin-users",
    alt: "Admin Settings, Users: the administrator, an educator and two students with their groups",
    as: "admin",
    path: () => "/settings?t=admin&setting=user-permissions",
    ready: ["Dana Okafor", "Maya Chen"],
  },
];

/** Check the list: unique names, known stages, viewports and personas. Returns the problems found. */
export function validateShots(list) {
  const problems = [];
  const names = new Set();
  for (const [index, shot] of list.entries()) {
    const label = shot.name ?? `entry ${index}`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shot.name ?? ""))
      problems.push(`${label}: name must be kebab-case`);
    if (names.has(shot.name)) problems.push(`${label}: duplicate name`);
    names.add(shot.name);
    if (!shot.alt?.trim()) problems.push(`${label}: alt text is required`);
    if (shot.stage === "first-run") continue;
    if (shot.stage !== undefined)
      problems.push(`${label}: unknown stage ${shot.stage}`);
    if (!["admin", "educator", "student", "classmate"].includes(shot.as))
      problems.push(`${label}: unknown persona`);
    if (typeof shot.path !== "function")
      problems.push(`${label}: path must be a function of the seeded ids`);
    if (!VIEWPORTS[shot.viewport ?? "desktop"])
      problems.push(`${label}: unknown viewport ${shot.viewport}`);
    if (!Array.isArray(shot.ready))
      problems.push(`${label}: ready must be a list of text`);
  }
  return problems;
}
