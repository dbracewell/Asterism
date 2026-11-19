// The user guide's screenshot list (US-89.1).
//
// Each entry names its image, says what it shows (the alt text the guide uses),
// and how to reach the screen:
//
//   name      image file name without extension, under docs/guide/images/
//   alt       what the image shows, for the guide's alt text
//   as        whose browser: admin, educator, student, classmate, or visitor
//             (signed out)
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

  // --- Getting started -------------------------------------------------------------
  {
    name: "sign-in",
    alt: "The Asterism sign-in page, with boxes for your email and password and a Login button",
    as: "visitor",
    path: () => "/sign-in",
    ready: ["Where will your curiosity lead you today?"],
  },
  {
    name: "invite-sign-up",
    alt: "The invite page: You're invited to join Biology 101, Period 3 with Dana Okafor, with boxes for your name, email and a new password",
    as: "visitor",
    path: (ids) => `/invite/${ids.invite}`,
    ready: ["You're invited to join", "Create account and join"],
  },
  {
    name: "reset-password",
    alt: "The page a password reset link opens, asking for a new password twice",
    as: "visitor",
    path: () => "/reset-password?token=demo-reset-link",
    ready: ["Choose a new password."],
  },
  {
    name: "account-menu",
    alt: "The menu under your name at the bottom of the sidebar, with Settings, Help center and Sign out",
    as: "student",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      await page.getByRole("button", { name: /Maya Chen/ }).click();
      await page.getByRole("menuitem", { name: "Sign out" }).waitFor();
    },
  },
  {
    name: "settings-sign-out-everywhere",
    alt: "Settings, General: the Sign-in and account section with the Sign out everywhere and Ask to delete my account buttons",
    as: "student",
    path: () => "/settings",
    ready: ["Sign out everywhere"],
  },
  {
    name: "home-screen",
    alt: "The new chat screen with the sidebar open: New Chat, Search, Files and Classes at the top, then General and Projects with their chats, and your name at the bottom",
    as: "student",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      for (const name of ["Toggle General", "Toggle Projects"])
        await page.getByRole("button", { name, exact: true }).click();
      await page
        .getByRole("link", { name: "Biology 101", exact: true })
        .waitFor();
    },
  },
  {
    name: "sidebar-phone",
    viewport: "phone",
    alt: "The sidebar open over the screen on a phone, with the same links as on a computer",
    as: "student",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
      for (const name of ["Toggle General", "Toggle Projects"])
        await page.getByRole("button", { name, exact: true }).click();
      await page
        .getByRole("link", { name: "Biology 101", exact: true })
        .waitFor();
    },
  },
  {
    name: "chat-model-menu",
    alt: "The model menu open above the message box, listing Demo Tutor and Demo Writer with a tick beside the one chosen",
    as: "student",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      await page.locator('[data-tour="model"]').click();
      await page.getByRole("option", { name: /Demo Writer/ }).waitFor();
    },
  },
  {
    name: "chat-reply-running",
    alt: "A reply about mitosis and meiosis still being written, with the red Stop generating button where the send button was",
    as: "classmate",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      await page
        .locator('[data-tour="message"]')
        .fill("What is the difference between mitosis and meiosis?");
      await page.keyboard.press("Enter");
      await page.getByText("identical to the parent cell").waitFor();
      await page.getByRole("button", { name: "Stop generating" }).waitFor();
    },
  },
  {
    name: "chat-steps",
    alt: "A reply with its steps opened: one search of the student's files, marked Done, above the sources and the answer",
    as: "student",
    path: (ids) => `/c/${ids.chats.sourced}`,
    ready: ["According to your files"],
    steps: async (page) => {
      await page.getByText("1 tool call").click();
      await page.getByText("search_knowledge").waitFor();
    },
  },
  {
    name: "tour-offer",
    alt: "The New here? card above the message box, with Start tour and No thanks buttons",
    as: "classmate",
    path: () => "/",
    ready: ["New here?"],
  },
  {
    name: "tour-step",
    alt: "The first step of the chat tour, Write your message, pointing at the message box, with Skip tour, Back and Next buttons",
    as: "student",
    path: () => "/?tour=first-chat",
    ready: ["Step 1 of"],
  },
  {
    name: "help-center",
    alt: "The Help center, with a search box, links to the Glossary, Controls and settings and Page guides, and the first glossary entries",
    as: "student",
    path: () => "/help",
    ready: ["Help center", "Glossary"],
  },
  {
    name: "page-help",
    alt: "The help panel for the New chat page, open on the right, explaining each part of the page",
    as: "student",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Help for this page" }).click();
      await page.getByText("On this page").waitFor();
    },
  },
  {
    name: "help-topic",
    alt: "A small help box opened from the question-mark icon beside Group in Settings, with a Learn more link",
    as: "student",
    path: () => "/settings",
    ready: ["Group:"],
    steps: async (page) => {
      await page
        .getByRole("button", { name: /^Help: / })
        .first()
        .click();
      await page.getByRole("dialog").waitFor();
    },
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

  {
    name: "chat-plus-menu",
    alt: "The + menu beside the message box, with Upload files, From library, Paste from clipboard, Take screenshot and Files in context under Attach",
    as: "student",
    path: (ids) => `/?project_id=${ids.project}`,
    ready: ["New chat in"],
    steps: async (page) => {
      await page.locator('[data-tour="options"]').click();
      await page.getByRole("menuitem", { name: "Files in context" }).waitFor();
    },
  },
  {
    name: "chat-files-in-context",
    alt: "The Files in context window for a Biology 101 chat: five project files, each ready, and no chat attachments",
    as: "student",
    path: (ids) => `/c/${ids.chats.sourced}`,
    ready: ["According to your files"],
    steps: async (page) => {
      await page.locator('[data-tour="options"]').click();
      await page.getByRole("menuitem", { name: "Files in context" }).click();
      await page.getByText("Project files (").waitFor();
    },
  },
  {
    name: "chat-source-preview",
    alt: "The pointer resting on the first source, chloroplast-handout.pdf, showing the passage Asterism used",
    as: "student",
    path: (ids) => `/c/${ids.chats.sourced}`,
    ready: ["According to your files"],
    steps: async (page) => {
      await page.getByRole("link", { name: /^Source 1/ }).hover();
      await page.getByRole("tooltip").waitFor();
    },
  },
  {
    name: "chat-compare-choose",
    alt: "The Compare models box above the message box, with Demo Tutor and Demo Writer both ticked",
    as: "student",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      await page.locator('[data-tour="options"]').click();
      await page.getByRole("menuitem", { name: "Compare models" }).click();
      for (const name of ["Demo Tutor", "Demo Writer"])
        await page.getByRole("checkbox", { name }).check();
    },
  },
  {
    name: "chat-compare-answers",
    alt: "Two answers to What is chlorophyll? side by side, from Demo Tutor and Demo Writer, with Continue from Demo Writer under the second",
    as: "student",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      await page.locator('[data-tour="options"]').click();
      await page.getByRole("menuitem", { name: "Compare models" }).click();
      for (const name of ["Demo Tutor", "Demo Writer"])
        await page.getByRole("checkbox", { name }).check();
      await page.keyboard.press("Escape");
      await page.locator('[data-tour="message"]').fill("What is chlorophyll?");
      await page.keyboard.press("Enter");
      await page.getByText("solar panel").waitFor();
      await page.getByRole("button", { name: /^Continue from/ }).waitFor();
    },
  },
  {
    name: "chat-tool-approval",
    alt: "A request to read a web page waiting for approval: Allow web_fetch?, the address it wants to read, and Deny and Approve buttons",
    as: "student",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      await page
        .locator('[data-tour="message"]')
        .fill(
          "Can you read https://example.org/leaf-structure and summarize it?",
        );
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: /^Approve/ }).waitFor();
    },
  },
  {
    name: "chat-image-chip",
    alt: "The message box with an Image chip above it and the words Describe the image to create",
    as: "classmate",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      // Leo may still be offered the tour; it would push the box down.
      const offer = page.getByRole("button", { name: "No thanks" });
      if (await offer.isVisible()) await offer.click();
      await page.locator('[data-tour="options"]').click();
      await page.getByRole("menuitem", { name: "Create image" }).click();
      await page.getByPlaceholder("Describe the image to create").waitFor();
    },
  },
  {
    name: "chat-image",
    alt: "A chat where Asterism made a picture of a plant cell with green chloroplasts from the description",
    as: "classmate",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      await page.locator('[data-tour="options"]').click();
      await page.getByRole("menuitem", { name: "Create image" }).click();
      await page
        .locator('[data-tour="message"]')
        .fill("A simple drawing of a plant cell with chloroplasts");
      await page.keyboard.press("Enter");
      await page.getByText("Here's your picture").waitFor();
      await page.locator("main img").first().waitFor();
      await page.waitForFunction(() =>
        [...document.querySelectorAll("main img")].every((img) => img.complete),
      );
    },
  },
  {
    name: "chat-slash-menu",
    alt: "The list that opens when you type / in the message box: the lab-partner skill, then /template and the prompt templates",
    as: "student",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      await page.locator('[data-tour="message"]').click();
      await page.keyboard.type("/");
      await page.getByText("/lab-partner").first().waitFor();
    },
  },
  {
    name: "chat-templates",
    alt: "The Prompt templates window, with the RTF, CO-STAR, CRAFT, Few-shot and Step-by-step frameworks",
    as: "student",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      await page.locator('[data-tour="options"]').click();
      await page.getByRole("menuitem", { name: "Prompt templates" }).click();
      await page.getByRole("dialog", { name: /Prompt templates/ }).waitFor();
      await page.getByText("CO-STAR").first().waitFor();
    },
  },
  {
    name: "chat-prompt-coach",
    alt: "A Prompt review above the draft Explain osmosis, suggesting to say who the answer is for and what shape it should take, each with an Apply button",
    as: "student",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      await page.locator('[data-tour="message"]').fill("Explain osmosis");
      await page.locator('[data-tour="options"]').click();
      await page.getByRole("menuitem", { name: "Review prompt" }).click();
      await page.getByText("Prompt review").waitFor();
      await page.getByRole("button", { name: /Apply/ }).first().waitFor();
    },
  },
  {
    name: "chat-status",
    alt: "The Chat status box opened from the ring beside the send button: how full the context is, a Compact now button, and the connection",
    as: "student",
    path: (ids) => `/c/${ids.chats.revision}`,
    ready: ["practise first"],
    steps: async (page) => {
      await page
        .getByRole("button", { name: /^(Context usage|Chat status)/ })
        .click();
      await page.getByRole("button", { name: "Compact now" }).waitFor();
    },
  },
  {
    name: "chat-compacted",
    alt: "A long chat after Compact now, with a line reading Conversation compacted: 2 earlier messages summarized between the messages",
    as: "student",
    path: (ids) => `/c/${ids.chats.revision}`,
    ready: ["practise first"],
    steps: async (page) => {
      await page
        .getByRole("button", { name: /^(Context usage|Chat status)/ })
        .click();
      await page.getByRole("button", { name: "Compact now" }).click();
      const divider = page.getByText(/messages? summarized/).first();
      await divider.waitFor();
      await page.keyboard.press("Escape");
      await divider.scrollIntoViewIfNeeded();
    },
  },
  {
    name: "search-results",
    alt: "The Search page with calvin typed in, finding The Calvin cycle by its title and Light-dependent reactions by its content",
    as: "student",
    path: () => "/search",
    ready: ["Find chats and projects"],
    steps: async (page) => {
      await page.getByPlaceholder("Search chats and projects").fill("calvin");
      await page.getByText("Chat content").waitFor();
    },
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
    if (
      !["admin", "educator", "student", "classmate", "visitor"].includes(
        shot.as,
      )
    )
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
