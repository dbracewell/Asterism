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
    alt: "The first-run sign-up form, with the four setup steps above it and the first current, asking for the administrator's name, email, password and the admin passkey",
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
  {
    stage: "first-run",
    name: "setup-ready",
    alt: "The setup card saying you're ready, with Review the remaining settings as the current step, and Continue setup and Start chatting buttons",
  },

  // --- Getting started -------------------------------------------------------------
  {
    name: "sign-in",
    alt: "The Asterism sign-in page, with boxes for your email and password and a Sign in button",
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
    alt: "The new chat screen with the sidebar open: New chat, Search, Files and Classes at the top, then General and Projects with their chats, and your name at the bottom",
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
      await page.getByRole("button", { name: "Toggle sidebar" }).click();
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
    name: "user-guide",
    alt: "The user guide inside Asterism, open on Your first chat, with links back to the Help center and the guide's contents",
    as: "student",
    path: () => "/help/guide/01-getting-started/your-first-chat",
    ready: ["Your first chat", "User guide contents"],
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
    name: "chat-source-page",
    alt: "The page a citation opens: the file name, the passage Asterism used with its place in the file, and Download source",
    as: "student",
    path: (ids) => `/c/${ids.chats.sourced}`,
    ready: ["According to your files"],
    steps: async (page) => {
      await page
        .getByRole("link", { name: /^Citation 1:/ })
        .first()
        .click();
      await page.getByText("The passage Asterism used").waitFor();
      await page.getByText(/ in this file\.$/).waitFor();
    },
  },
  {
    name: "chat-branches",
    alt: "A chat whose answer was regenerated, with the switcher under the answer showing 2 / 2",
    as: "student",
    path: (ids) => `/c/${ids.chats.branched}`,
    ready: ["three phases", "2 / 2"],
  },
  {
    name: "chat-branches-project",
    alt: "A project chat whose answer searched the files and was regenerated, with the switcher under the answer showing 2 / 2",
    as: "student",
    path: (ids) => `/c/${ids.chats.branchedProject}`,
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
    name: "chat-diagram",
    alt: "A reply with a diagram of photosynthesis: light and water feed the light-dependent reactions, which give oxygen and pass ATP and NADPH to the Calvin cycle, which turns carbon dioxide into glucose. Buttons above it show the code, expand, download and copy",
    as: "student",
    path: (ids) => `/c/${ids.chats.diagram}`,
    ready: ["Which arrow would you like"],
    steps: async (page) => {
      await page
        .getByRole("img", { name: "Photosynthesis in two stages" })
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
      await page.getByText("Chat content").first().waitFor();
    },
  },

  // --- Files and projects ----------------------------------------------------------
  {
    name: "files-library",
    alt: "The Files library: the student's notes, a PDF handout, a spreadsheet of results and a captioned leaf diagram, each ready, and a worksheet photo whose processing failed",
    as: "student",
    path: () => "/files",
    ready: ["photosynthesis-notes.md", "leaf-diagram.png", "Embedding: failed"],
  },

  {
    name: "project-overview",
    alt: "The Biology 101 project page with its goal, files and chats",
    as: "student",
    path: (ids) => `/projects/${ids.project}`,
    ready: ["Biology 101"],
  },

  {
    name: "file-page",
    alt: "The page for leaf-diagram.png: its caption describing the leaf, no extracted text, five similar files and the projects it's in",
    as: "student",
    path: () => "/files/leaf-diagram.png",
    ready: ["Similar files", "A simple diagram of a green leaf"],
  },
  {
    name: "files-delete",
    alt: "The Delete selected files? message, warning that the file is removed for good from every project and chat, with Cancel and Confirm",
    as: "student",
    path: () => "/files",
    ready: ["worksheet-photo.jpg"],
    steps: async (page) => {
      await page.getByText("worksheet-photo.jpg").first().click();
      await page.getByRole("button", { name: "Delete selected files" }).click();
      await page.getByText("Delete selected files?").waitFor();
    },
  },
  {
    name: "project-new",
    alt: "The first step of New project, Starting point: Study a course, Ask my documents, Agent workspace or Blank",
    as: "student",
    path: () => "/projects",
    ready: ["Biology 101"],
    steps: async (page) => {
      await page.getByRole("button", { name: "New project" }).click();
      await page.getByText("Step 1 of").waitFor();
    },
  },
  {
    name: "project-files",
    alt: "The Files tab of the Biology 101 project, with five files and the Add library files and Remove from project buttons",
    as: "student",
    path: (ids) => `/projects/${ids.project}?tab=files`,
    ready: ["Project files", "lab-report-draft.txt"],
  },
  {
    name: "project-add-files",
    alt: "The Add files to this project window, listing library files to choose from; files already in the project can't be chosen again",
    as: "student",
    path: (ids) => `/projects/${ids.project}?tab=files`,
    ready: ["Project files"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Add library files" }).click();
      await page
        .getByRole("dialog")
        .getByText("leaf-diagram.png")
        .first()
        .waitFor();
    },
  },
  {
    name: "project-remove-file",
    alt: "The Remove selected files from this project? message, saying the file stays in your library and other projects, with Cancel and Confirm",
    as: "student",
    path: (ids) => `/projects/${ids.project}?tab=files`,
    ready: ["lab-report-draft.txt"],
    steps: async (page) => {
      await page.getByText("lab-report-draft.txt").first().click();
      await page.getByRole("button", { name: "Remove from project" }).click();
      await page
        .getByText("Remove selected files from this project?")
        .waitFor();
    },
  },
  {
    name: "project-sub-agents",
    alt: "The Sub-agents tab of Biology 101, with Lab report checker selected and its fixed model shown",
    as: "student",
    path: (ids) => `/projects/${ids.project}?tab=sub-agents`,
    ready: ["Lab report checker", "Fixed model"],
  },
  {
    name: "pack-export",
    alt: "The Export team pack window: a pack name, a description, and boxes to tick for the project settings, the Lab report checker sub-agent and the lab-partner skill",
    as: "student",
    path: (ids) => `/projects/${ids.project}?tab=settings`,
    ready: ["Feature areas"],
    steps: async (page) => {
      await page
        .getByRole("button", { name: /Export team pack/ })
        .first()
        .click();
      await page.getByText("Pack name").waitFor();
    },
  },
  {
    name: "pack-import",
    alt: "The Import team pack page, with three starter packs to review and a box to choose a team pack file",
    as: "student",
    path: () => "/team-packs",
    ready: ["Starter packs", "Study Buddy"],
  },
  {
    name: "pack-review",
    alt: "The review of the Study Buddy starter pack: who wrote it, a note that nothing is created until you confirm, and the start of its sub-agents",
    as: "student",
    path: () => "/team-packs",
    ready: ["Study Buddy"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Review Study Buddy" }).click();
      const heading = page.getByText("Study Buddy 1.0.0");
      await heading.waitFor();
      await heading.evaluate((node) => node.scrollIntoView({ block: "start" }));
    },
  },

  // --- Learning --------------------------------------------------------------------
  {
    name: "learning-mode-menu",
    alt: "The learning mode menu open above the message box: Standard, Tutor, Explain-back, Review my work, Spot the error and Draft feedback, each with a one-line description",
    as: "student",
    path: () => "/",
    ready: ["What should we work on?"],
    steps: async (page) => {
      await page.locator('[data-tour="learning-mode"]').click();
      await page.getByText("Guides you with questions and hints").waitFor();
    },
  },
  {
    name: "tutor-nudge",
    alt: "A Tutor chat after asking for a Nudge: Asterism hints at roots, leaves and the Sun, and the help bar above the message box now says Help level: Nudge",
    as: "student",
    path: (ids) => `/c/${ids.chats.general}`,
    ready: ["what do you think a plant needs"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Nudge", exact: true }).click();
      await page.getByText("Here's a nudge").waitFor();
      await page.getByText("Help level:").waitFor();
    },
  },
  {
    name: "tutor-show-answer",
    alt: "The Show the full answer? message, suggesting a hint or worked example first, with Keep trying and Show answer buttons",
    as: "student",
    path: (ids) => `/c/${ids.chats.general}`,
    ready: ["what do you think a plant needs"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Show answer" }).click();
      await page.getByText("Show the full answer?").waitFor();
    },
  },
  {
    name: "mode-explain-back",
    alt: "An Explain-back chat: the student explains photosynthesis, and Asterism answers under What you got right, What was missing or wrong and Follow-up questions",
    as: "student",
    path: (ids) => `/c/${ids.modeChats.explainBack}`,
    ready: ["What you got right", "Follow-up questions"],
  },
  {
    name: "mode-review",
    alt: "A Review my work chat: the student's answer says the plant runs out of chlorophyll, and Asterism points out that first mistake and suggests a next step",
    as: "student",
    path: (ids) => `/c/${ids.modeChats.review}`,
    ready: ["Next step"],
  },
  {
    name: "mode-spot-the-error",
    alt: "A Spot the error chat: an explanation of cellular respiration with an Exercise box underneath, saying the answer contains one deliberate error, with Check selection and Reveal answer",
    as: "student",
    path: (ids) => `/c/${ids.modeChats.spotTheError}`,
    ready: ["one deliberate error", "Reveal answer"],
  },
  {
    name: "mode-draft-feedback",
    alt: "Draft feedback on a lab report against the Lab report rubric: each criterion with an estimated level and a quote from the draft, an Overall note, and a Review draft with comments button",
    as: "student",
    path: (ids) => `/c/${ids.modeChats.draftFeedback}`,
    ready: ["Review draft with comments"],
  },
  {
    name: "draft-review",
    alt: "Your draft with comments: the lab report draft on the left with the quoted passages highlighted, and a comment for each rubric criterion on the right, each with a Resolved box",
    as: "student",
    path: (ids) => `/c/${ids.modeChats.draftFeedback}`,
    ready: ["Review draft with comments"],
    steps: async (page) => {
      await page
        .getByRole("button", { name: /Review draft with comments/ })
        .click();
      await page.getByText("Your draft with comments").waitFor();
    },
  },
  {
    name: "mode-lock",
    alt: "The Lock Tutor mode? message, explaining that switching to Standard or revealing an answer will then ask you to confirm and wait, with Cancel and Lock mode",
    as: "student",
    path: (ids) => `/c/${ids.chats.general}`,
    ready: ["what do you think a plant needs"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Lock Tutor mode" }).click();
      await page.getByText("Lock Tutor mode?").waitFor();
    },
  },
  {
    name: "mode-course-menu",
    alt: "The learning mode menu in the class's course project: a line with the class's rules at the top, and Standard, Draft feedback and Research assistant greyed out as Not allowed in this course",
    as: "student",
    path: (ids) => `/?project_id=${ids.courseCopy}`,
    ready: ["What should we work on?"],
    steps: async (page) => {
      await page.locator('[data-tour="learning-mode"]').click();
      await page.getByText("Not allowed in this course").first().waitFor();
    },
  },
  {
    name: "mode-course-limits",
    alt: "The Lock Tutor mode? message in the class's course project, with a line saying Biology 101, Period 3 allows only the Tutor, Explain-back, Review my work or Spot the error modes and answers can't be revealed, set by Dana Okafor",
    as: "student",
    path: (ids) => `/c/${ids.courseChat}`,
    ready: ["Which of them feels hardest"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Lock Tutor mode" }).click();
      await page.getByLabel("Course policy").waitFor();
    },
  },
  {
    name: "reflect",
    alt: "The Reflect on this session window, with What did I learn? and What's still unclear? filled in by Suggest a draft, and a Save reflection button",
    as: "student",
    path: (ids) => `/c/${ids.chats.general}`,
    ready: ["what do you think a plant needs"],
    steps: async (page) => {
      // The Reflect button in the top bar (US-111.1).
      await page
        .locator("header")
        .getByRole("button", { name: "Reflect on this session" })
        .click();
      await page.getByRole("button", { name: "Suggest a draft" }).click();
      await page.getByText("Suggested from this chat").waitFor();
    },
  },
  {
    name: "reflections-list",
    alt: "The General page with a saved reflection under Reflections, showing what the student learned and what is still unclear",
    as: "student",
    path: () => "/general",
    ready: ["Reflections", "What the Calvin cycle does"],
    steps: async (page) => {
      await page
        .getByRole("heading", { name: "Reflections" })
        .evaluate((node) => node.scrollIntoView({ block: "start" }));
    },
  },
  {
    name: "ai-use-log-chats",
    alt: "The Export AI-use log window, listing the project's chats with a box to tick for each, and a Choose prompts button",
    as: "student",
    path: (ids) => `/projects/${ids.project}`,
    ready: ["Biology 101"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Export AI-use log" }).click();
      await page
        .getByRole("checkbox", { name: "Light-dependent reactions" })
        .check();
    },
  },
  {
    name: "ai-use-log-prompts",
    alt: "The Choose prompts step of the AI-use log: the chat's prompt with its mode and model, a preview of the log, and Save as PDF and Download Markdown buttons",
    as: "student",
    path: (ids) => `/projects/${ids.project}`,
    ready: ["Biology 101"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Export AI-use log" }).click();
      await page
        .getByRole("checkbox", { name: "Light-dependent reactions" })
        .check();
      await page.getByRole("button", { name: /Choose prompts/ }).click();
      await page.getByRole("button", { name: "Download Markdown" }).waitFor();
    },
  },
  {
    name: "rubrics-settings",
    alt: "Settings, Rubrics: the bundled Argumentative essay, Lab report and Personal narrative rubrics, each with a Duplicate button, and an empty Your rubrics list",
    as: "student",
    path: () => "/settings?setting=rubrics",
    ready: ["Bundled rubrics", "Lab report"],
  },
  {
    name: "rubric-editor",
    alt: "The Create rubric window, with a name, performance levels and criteria to fill in",
    as: "student",
    path: () => "/settings?setting=rubrics",
    ready: ["Bundled rubrics"],
    steps: async (page) => {
      await page.getByRole("button", { name: "New rubric" }).click();
      await page.getByText("Create rubric").first().waitFor();
    },
  },

  // --- Studying --------------------------------------------------------------------
  {
    name: "study-tab",
    alt: "The Study tab of Biology 101: the Photosynthesis deck with the cards due for review, and the Progress panel with two topics at Developing and two items that need practice",
    as: "student",
    path: (ids) => `/projects/${ids.project}?tab=study`,
    ready: ["Study decks", "Needs practice"],
  },
  {
    name: "study-drafts",
    alt: "Draft cards: suggested flashcards, each with a front, a back and the file it came from, and Discard, Edit and Accept buttons",
    as: "student",
    path: (ids) => `/projects/${ids.project}/study/${ids.deck}/drafts`,
    ready: ["Draft cards"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Draft cards" }).click();
      await page.getByRole("button", { name: /Accept all/ }).waitFor();
      await page
        .getByRole("heading", { name: "Drafts" })
        .evaluate((node) => node.scrollIntoView({ block: "start" }));
    },
  },
  {
    name: "study-review",
    alt: "A review session: the card What does the enzyme RuBisCO do? with its answer shown, and Again, Hard, Good and Easy buttons that say when the card comes back",
    as: "student",
    path: (ids) => `/projects/${ids.project}/study/${ids.deck}/review`,
    ready: ["cards left"],
    steps: async (page) => {
      await page.getByRole("button", { name: /Show answer/ }).click();
      await page.getByRole("button", { name: /Easy/ }).waitFor();
    },
  },
  {
    name: "quiz-new",
    alt: "The New practice quiz form: source files, question types, the number of questions, an optional title, a model and Generate quiz",
    as: "student",
    path: (ids) => `/projects/${ids.project}/study/quizzes/new`,
    ready: ["New practice quiz", "Generate quiz"],
  },
  {
    name: "quiz-take",
    alt: "Taking the Photosynthesis check quiz: numbered questions, each with options to choose from",
    as: "student",
    path: (ids) => `/projects/${ids.project}/study/quizzes/${ids.quiz}/take`,
    ready: ["Photosynthesis check", "1."],
  },
  {
    name: "quiz-results",
    alt: "Quiz results: 3 of 4 points (75%), then each answer marked Correct or Incorrect, with the correct answer, an explanation and the source file",
    as: "student",
    path: (ids) =>
      `/projects/${ids.project}/study/quizzes/${ids.quiz}/attempts/${ids.attempt}`,
    ready: ["points", "Answers"],
  },
  {
    name: "study-summary",
    alt: "Summarize files: the files used and the summary that was written, one section for each file with its source, ready to save as a note",
    as: "student",
    path: (ids) => `/projects/${ids.project}/study/summaries/new`,
    ready: ["Summarize files"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Summarize" }).click();
      await page
        .getByText(/Save as note/)
        .first()
        .waitFor();
      await page
        .getByRole("heading", { name: "Summary", exact: true })
        .evaluate((node) => node.scrollIntoView({ block: "start" }));
    },
  },
  {
    name: "study-guide",
    alt: "Plan for an exam: a study plan up to the exam, with each day's focus and links to the Photosynthesis deck",
    as: "student",
    path: (ids) => `/projects/${ids.project}/study/guides/new`,
    ready: ["Plan for an exam"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Plan study days" }).click();
      await page
        .getByText(/Save as note/)
        .first()
        .waitFor();
      await page
        .getByRole("heading", { name: "Study plan" })
        .evaluate((node) => node.scrollIntoView({ block: "start" }));
    },
  },
  {
    name: "progress-reflections",
    alt: "The lower part of the Progress panel: Needs practice with a missed quiz question and a card rated Again, and From your reflections with an unclear item ready to become a flashcard",
    as: "student",
    path: (ids) => `/projects/${ids.project}?tab=study`,
    ready: ["From your reflections"],
    steps: async (page) => {
      await page
        .getByRole("heading", { name: "Needs practice" })
        .evaluate((node) => node.scrollIntoView({ block: "start" }));
    },
  },
  {
    name: "study-deck",
    alt: "The Photosynthesis flashcard deck with its cards and the number due for review",
    as: "student",
    path: (ids) => `/projects/${ids.project}/study/${ids.deck}`,
    ready: ["Where do the light-dependent reactions take place?"],
  },
  {
    name: "study-quiz",
    alt: "The Photosynthesis check quiz page: its topics, best and last scores, one attempt, and Retake quiz, Edit details and Delete quiz buttons",
    as: "student",
    path: (ids) => `/projects/${ids.project}/study/quizzes/${ids.quiz}`,
    ready: ["Photosynthesis check"],
  },

  // --- Making Asterism yours -------------------------------------------------------
  {
    name: "settings-appearance",
    alt: "Settings, General: the light and dark themes to choose from, Font size, Show thinking, and the Chat section with Default model, Prompt coach and Canvas",
    as: "student",
    path: () => "/settings",
    ready: ["Appearance", "Default model"],
    steps: async (page) => {
      await page
        .getByText("Dark", { exact: true })
        .evaluate((node) => node.scrollIntoView({ block: "start" }));
    },
  },
  {
    name: "settings-about-you",
    alt: "Settings, Your Asterism: today's and this month's token use, and the About you box with a few facts about the student",
    as: "student",
    path: () => "/settings?setting=your-asterism",
    ready: ["About you", "Year 11"],
  },
  {
    name: "settings-agents",
    alt: "Settings, Agents: the main agent with Manage main-agent skills and an edit button, General chat sub-agents with none chosen, and the Lab report checker sub-agent",
    as: "student",
    path: () => "/settings?setting=agents",
    ready: ["Main agent", "Lab report checker"],
  },
  {
    name: "main-agent-config",
    alt: "The Main configuration window: Instructions, Maximum steps, generation settings and Allowed tools, with Save configuration",
    as: "student",
    path: () => "/settings?setting=agents",
    ready: ["Main agent"],
    steps: async (page) => {
      await page
        .getByRole("button", { name: "Edit main configuration" })
        .click();
      await page.getByText("Allowed tools").waitFor();
      await page.evaluate(() => document.activeElement?.blur?.());
    },
  },
  {
    name: "sub-agent-new",
    alt: "The Create sub-agent window: a warning that sub-agent tools run without asking, then Name, Description, Model and Instructions",
    as: "student",
    path: () => "/settings?setting=agents",
    ready: ["Sub-agents"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Create sub-agent" }).click();
      await page.getByText("Create sub-agent").first().waitFor();
      await page.evaluate(() => document.activeElement?.blur?.());
    },
  },
  {
    name: "general-chat-sub-agents",
    alt: "The General chat sub-agents window, with a box to tick beside Lab report checker, its fixed model and Available, and Save choices",
    as: "student",
    path: () => "/settings?setting=agents",
    ready: ["Main agent"],
    steps: async (page) => {
      await page
        .getByRole("button", { name: "Choose General chat sub-agents" })
        .click();
      await page.getByRole("button", { name: "Save choices" }).waitFor();
    },
  },
  {
    name: "settings-skills",
    alt: "Settings, Skills: the lab-partner skill with Assigned to main agent switched on and a View or edit button, and New skill at the top",
    as: "student",
    path: () => "/settings?setting=skills",
    ready: ["lab-partner", "Assigned to main agent"],
  },
  {
    name: "skill-describe",
    alt: "The Describe it tab of Create skill: a description of the skill in What should the skill do?, optional examples, a writer model and Write draft",
    as: "student",
    path: () => "/settings?setting=skills",
    ready: ["lab-partner"],
    steps: async (page) => {
      await page.getByRole("button", { name: "New skill" }).click();
      await page.getByRole("tab", { name: "Describe it" }).click();
      await page
        .getByLabel("What should the skill do?")
        .fill(
          "Quiz me on a topic, one question at a time, and tell me if I'm right.",
        );
      await page.evaluate(() => document.activeElement?.blur?.());
    },
  },
  {
    name: "skill-draft",
    alt: "The draft skill Quiz me in the Write it tab's preview, with Ask for changes, Discard draft and Save skill",
    as: "student",
    path: () => "/settings?setting=skills",
    ready: ["lab-partner"],
    steps: async (page) => {
      await page.getByRole("button", { name: "New skill" }).click();
      await page.getByRole("tab", { name: "Describe it" }).click();
      await page
        .getByLabel("What should the skill do?")
        .fill(
          "Quiz me on a topic, one question at a time, and tell me if I'm right.",
        );
      await page.getByRole("button", { name: "Write draft" }).click();
      await page.getByRole("button", { name: "Save skill" }).waitFor();
      await page.getByText("After five questions").waitFor();
    },
  },
  {
    name: "settings-templates",
    alt: "Settings, Templates: the RTF, CO-STAR, CRAFT, Few-shot and Step-by-step frameworks, each with Duplicate, and New template at the top",
    as: "student",
    path: () => "/settings?setting=templates",
    ready: ["Frameworks", "CO-STAR"],
  },
  {
    name: "settings-chatgpt",
    alt: "Settings, ChatGPT: a Continue with ChatGPT button, a note that the browser must run on the same machine as Asterism, and Not connected",
    as: "student",
    path: () => "/settings?setting=chatgpt",
    ready: ["Continue with ChatGPT", "Not connected"],
  },
  {
    name: "settings-your-data",
    alt: "Settings, General: Your data, with a message that the archive is ready, its size and when it will be deleted, a Download button and Prepare a new archive",
    as: "student",
    path: () => "/settings",
    ready: ["Prepare my data"],
    steps: async (page) => {
      await page.getByRole("button", { name: "Prepare my data" }).click();
      await page
        .getByText("Your archive is ready")
        .waitFor({ timeout: 120_000 });
    },
  },
  {
    name: "settings-delete-request",
    alt: "The Ask to delete your account? message: an administrator decides, everything is deleted for good if they do, and the request can be withdrawn, with Cancel and Send request",
    as: "student",
    path: () => "/settings",
    ready: ["Ask to delete my account"],
    steps: async (page) => {
      await page
        .getByRole("button", { name: "Ask to delete my account" })
        .click();
      await page.getByText("Ask to delete your account?").waitFor();
    },
  },

  // --- Educators -------------------------------------------------------------------
  {
    name: "educator-classes",
    alt: "The Classes page for an educator: under Teaching, the Biology 101, Period 3 class with 2 students, and a form with Class name, Description and Create class",
    as: "educator",
    path: () => "/classes",
    ready: ["Teaching", "Create class"],
    steps: async (page) => {
      await page
        .getByRole("heading", { name: "Teaching" })
        .evaluate((node) => node.scrollIntoView({ block: "start" }));
    },
  },
  {
    name: "class-invites",
    alt: "Invites for new students after Create invites: a new link for each name typed, with a button to copy each one, and a note that the links aren't shown again",
    as: "educator",
    path: (ids) => `/classes/${ids.classroom}`,
    ready: ["Invites for new students"],
    steps: async (page) => {
      await page
        .getByLabel("Student names, one per line")
        .fill("Priya Natarajan\nTom Okonkwo");
      await page.getByRole("button", { name: "Create invites" }).click();
      const links = page.locator('[aria-label="New invite links"]');
      await links.waitFor();
      await links.evaluate((node) => node.scrollIntoView({ block: "center" }));
    },
  },
  {
    name: "class-course",
    alt: "The Course section of a class: Project to publish, What's new, Publish version 3, and the two published versions with their notes",
    as: "educator",
    path: (ids) => `/classes/${ids.classroom}`,
    ready: ["Project to publish"],
    steps: async (page) => {
      await page
        .getByRole("heading", { name: "Course" })
        .evaluate((node) => node.scrollIntoView({ block: "start" }));
    },
  },
  {
    name: "class-mode-policy",
    alt: "The Learning mode policy of a class: Tutor, Explain-back, Review my work and Spot the error ticked, Let students reveal answers and solutions switched off, and Save policy",
    as: "educator",
    path: (ids) => `/classes/${ids.classroom}`,
    ready: ["Learning mode policy"],
    steps: async (page) => {
      await page
        .getByRole("heading", { name: "Learning mode policy" })
        .evaluate((node) => node.scrollIntoView({ block: "start" }));
    },
  },
  {
    name: "class-insights",
    alt: "Where the class struggles: an explanation of the totals, and a note that insights appear once at least 5 students share their results, with 2 sharing so far",
    as: "educator",
    path: (ids) => `/classes/${ids.classroom}`,
    ready: ["Where the class struggles"],
    steps: async (page) => {
      await page
        .getByRole("heading", { name: "Where the class struggles" })
        .evaluate((node) => node.scrollIntoView({ block: "center" }));
    },
  },
  {
    name: "student-classes",
    alt: "A student's Classes page: Biology 101, Period 3 run by Dana Okafor, with Version 2 is available, the change it makes, Update to version 2, and Share my practice results in class totals switched on",
    as: "student",
    path: () => "/classes",
    ready: ["Your classes", "Update to version 2"],
  },
  {
    name: "course-managed",
    alt: "A student's copy of the course: the project's Settings tab, marked Managed by Biology 101, Period 3, with every field greyed out and a note that only course updates can change it",
    as: "student",
    path: (ids) => `/projects/${ids.courseCopy}?tab=settings`,
    ready: ["only course updates can change it"],
  },
  {
    name: "class-overview",
    alt: "The educator's page for Biology 101, Period 3: the class code with Copy join link and Replace code, Invites for new students with one unused invite, and the two students",
    as: "educator",
    path: (ids) => `/classes/${ids.classroom}`,
    ready: ["Period 3"],
  },

  // --- Administrators --------------------------------------------------------------
  {
    name: "admin-users",
    alt: "Admin Settings, Users: the administrator, an educator and two students with their groups, a menu button for each account, and Leo Martins marked as having asked for deletion",
    as: "admin",
    path: () => "/settings?t=admin&setting=user-permissions",
    ready: ["Dana Okafor", "Maya Chen", "Asked for deletion"],
  },
  {
    name: "admin-account-menu",
    alt: "The account menu for Leo Martins in Admin Settings, Users, with Suspend, Create password reset link and Delete account",
    as: "admin",
    path: () => "/settings?t=admin&setting=user-permissions",
    ready: ["Leo Martins"],
    steps: async (page) => {
      await page
        .getByRole("button", { name: "Account actions for Leo Martins" })
        .click();
      await page.getByRole("menuitem", { name: "Delete account" }).waitFor();
    },
  },
  {
    name: "admin-reset-link",
    alt: "The Password reset link for Leo Martins window: a link to send them yourself, when it stops working, and Copy link and Done",
    as: "admin",
    path: () => "/settings?t=admin&setting=user-permissions",
    ready: ["Leo Martins"],
    steps: async (page) => {
      await page
        .getByRole("button", { name: "Account actions for Leo Martins" })
        .click();
      await page
        .getByRole("menuitem", { name: "Create password reset link" })
        .click();
      await page.getByRole("button", { name: "Copy link" }).waitFor();
      await page.evaluate(() => document.activeElement?.blur?.());
    },
  },
  {
    name: "admin-providers",
    alt: "Admin Settings, Providers: the Demo models provider with its type, name, base URL and key, and its models listed with context window, input and output prices, vision input, tool calls and Set draft",
    as: "admin",
    path: () => "/settings?t=admin&setting=providers",
    ready: ["Demo models", "Browse 2 models"],
    steps: async (page) => {
      await page.getByRole("button", { name: /Browse 2 models/ }).click();
      await page.getByText("Input $ / 1M tokens").first().waitFor();
    },
  },
  {
    name: "admin-groups",
    alt: "Admin Settings, Groups: the built-in Admin, Educator and Student groups, with Student's access open to choose which models and tools it may use, and a box to create a new group",
    as: "admin",
    path: () => "/settings?t=admin&setting=group-settings",
    ready: ["Edit access for Student"],
    steps: async (page) => {
      await page.getByText("Edit access for Student").click();
      await page
        .getByRole("button", { name: "Save access for Student" })
        .waitFor();
    },
  },
  {
    name: "admin-budget",
    alt: "The usage budget for the Student group: tokens per member per day and per month, both empty, meaning no budget",
    as: "admin",
    path: () => "/settings?t=admin&setting=group-settings",
    ready: ["Edit usage budget for Student"],
    steps: async (page) => {
      await page.getByText("Edit usage budget for Student").click();
      const day = page.getByText("Tokens per member per day");
      await day.waitFor();
      await day.evaluate((node) => node.scrollIntoView({ block: "center" }));
    },
  },
  {
    name: "admin-usage",
    alt: "Admin Settings, Usage: tokens and estimated cost per group and per person and model this month, and the Budget day time zone",
    as: "admin",
    path: () => "/settings?t=admin&setting=usage",
    ready: ["Budget day", "Estimated cost"],
  },
  {
    name: "admin-status",
    alt: "Admin Settings, Status: the instance is Ready, its version, the replies running and chat connections open against their limits, storage, and No backup has been recorded",
    as: "admin",
    path: () => "/settings?t=admin&setting=status",
    ready: ["Replies running", "Backups"],
  },
  {
    name: "admin-tools",
    alt: "Admin Settings, Tools: each tool with a box to turn it on, its description, and a provider to choose for the web and image search tools",
    as: "admin",
    path: () => "/settings?t=admin&setting=tools",
    ready: ["web_fetch", "Only Active Tools"],
  },
  {
    name: "admin-image-generation",
    alt: "Admin Settings, Image generation: the ComfyUI generator with its server address and checkpoint, and Save generator",
    as: "admin",
    path: () => "/settings?t=admin&setting=image-generation",
    ready: ["Generator", "Checkpoint"],
  },
  {
    name: "admin-educators",
    alt: "Admin Settings, Educators: Dana Okafor marked Educator, with a Revoke button",
    as: "admin",
    path: () => "/settings?t=admin&setting=educators",
    ready: ["Revoke"],
  },
  {
    name: "admin-setup-step",
    alt: "Admin Settings, Setup: the list of setup steps with Providers and models reviewed, and the Image captioning step explaining that search can't find pictures while captioning is off, with Next, Skip for now and the captioning settings below",
    as: "admin",
    path: () => "/settings?t=admin&setting=setup&step=image-captioning",
    ready: ["Step 5 of", "search can't find them"],
  },
  {
    name: "admin-setup-summary",
    alt: "The setup summary, listing the steps not reviewed and the steps reviewed, each a button that opens it, and Start chatting",
    as: "admin",
    path: () => "/settings?t=admin&setting=setup&step=summary",
    ready: ["Setup summary", "Not reviewed"],
  },
  {
    name: "admin-theme-editor",
    alt: "Admin Settings, Theme editor: the light and dark themes, each with a copy button, and New theme",
    as: "admin",
    path: () => "/settings?t=admin&setting=theme_editor",
    ready: ["Theme editor", "Night Atlas"],
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
