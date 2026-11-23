/**
 * Page guides for the page help panel (US-61.3, ADR-0032). Each guide explains
 * a page's purpose, its main areas and common tasks, and links to glossary
 * entries. The same accuracy rules as the help registry apply.
 */
import type { HelpAudience, HelpId } from "./registry";

export type PageGuideId =
  | "new-chat"
  | "chat"
  | "file"
  | "general"
  | "projects"
  | "project"
  | "files"
  | "search"
  | "help"
  | "classes"
  | "class"
  | "team-packs"
  | "study.deck"
  | "study.drafts"
  | "study.review"
  | "study.quiz-new"
  | "study.quiz"
  | "study.quiz-take"
  | "study.quiz-attempt"
  | "study.summary-new"
  | "study.guide-new"
  | "study.note"
  | "settings.general"
  | "settings.your-asterism"
  | "settings.skills"
  | "settings.templates"
  | "settings.rubrics"
  | "settings.agents"
  | "settings.chatgpt"
  | "admin.providers"
  | "admin.theme-editor"
  | "admin.tools"
  | "admin.skills"
  | "admin.canvas"
  | "admin.chatgpt"
  | "admin.context-compaction"
  | "admin.image-captioning"
  | "admin.image-generation"
  | "admin.groups"
  | "admin.usage"
  | "admin.status"
  | "admin.users"
  | "admin.educators"
  | "admin.export";

export interface PageGuide {
  title: string;
  /**
   * The user guide page that walks through this page, as a path under
   * `docs/guide` without `.md`, optionally with `#anchor` (US-90.9).
   */
  walkthrough?: string;
  /** One or two sentences: what this page is for. */
  purpose: string;
  areas: readonly { name: string; description: string }[];
  tasks: readonly string[];
  terms: readonly HelpId[];
  audience: HelpAudience;
}

export const pageGuides: Record<PageGuideId, PageGuide> = {
  "new-chat": {
    title: "New chat",
    walkthrough: "01-getting-started/your-first-chat",
    purpose:
      "Start a conversation. Choose where it lives, how the assistant should help, then write your first message.",
    areas: [
      {
        name: "Workspace",
        description:
          "Shows whether the chat will be in General or in a project. Project chats can use the project's shared files.",
      },
      {
        name: "Suggested prompts",
        description:
          "Ideas based on the project description and your skills. Pick one to fill the message box.",
      },
      {
        name: "Message box",
        description:
          "Write your message here. The chips above it choose the model and learning mode. The + menu adds files, templates, skills and model comparison.",
      },
    ],
    tasks: [
      "To practice rather than get answers, set the learning mode to Tutor before you send.",
      "Type / in the message box to add a skill or a prompt template.",
      "Use the + menu to attach your notes or work.",
    ],
    terms: [
      "composer.controls",
      "concept.learning-mode",
      "concept.about-you",
      "concept.model",
      "concept.general-chat",
      "concept.project",
    ],
    audience: "everyone",
  },
  chat: {
    title: "Chat",
    walkthrough: "01-getting-started/your-first-chat",
    purpose:
      "A conversation with the assistant. Read the replies, keep the conversation going, and change how the assistant helps at any time.",
    areas: [
      {
        name: "Header",
        description:
          "Shows where the chat lives, its model, the mode restrictions control (your lock, and any course limits), and a menu to rename or move the chat, reflect on the session, export an AI-use log or delete the chat.",
      },
      {
        name: "Conversation",
        description:
          "Your messages and the replies. Messages show the model and learning mode used, and replies show any tools they used and the sources they relied on.",
      },
      {
        name: "Hint controls",
        description:
          "In Tutor or Review my work mode, ask for stronger hints or reveal the answer here.",
      },
      {
        name: "Message box",
        description:
          "Write your next message. Select a chip above the box to change the model or mode; changes apply from your next message.",
      },
    ],
    tasks: [
      "Regenerate a reply to get another version, then use the arrows to switch between versions.",
      "Use Compare with other models under a reply to see how different models answer.",
      "Lock the learning mode from the header to stop yourself skipping ahead; the same control shows any limits your course sets.",
      "Open the status ring beside the send button and choose Compact now to summarize earlier turns of a long chat.",
      "Choose Create image in the + menu, then describe the picture you want.",
    ],
    terms: [
      "concept.chat",
      "concept.context-compaction",
      "composer.controls",
      "concept.hint-levels",
      "concept.mode-policy",
      "concept.citation",
      "concept.tool-approval",
      "concept.canvas",
      "concept.image-generation",
    ],
    audience: "everyone",
  },
  file: {
    title: "File",
    walkthrough: "03-files-and-projects/the-files-library",
    purpose:
      "One file from your library: what was read from it, similar files, and the projects that share it.",
    areas: [
      {
        name: "Caption and extracted content",
        description:
          "The text read from the file when it was processed, and an image's caption. This is what the assistant searches; it isn't available until processing is ready.",
      },
      {
        name: "Similar files",
        description: "The five most similar files in your library.",
      },
      {
        name: "Projects",
        description: "The projects this file is shared with.",
      },
    ],
    tasks: ["Use Back to return to the page you came from."],
    terms: ["concept.file-scope", "concept.citation"],
    audience: "everyone",
  },
  general: {
    title: "General",
    walkthrough: "01-getting-started/finding-your-way-around",
    purpose:
      "Chats that don't belong to a project. Each one has its own attachments and no project instructions.",
    areas: [
      {
        name: "Chat list",
        description: "Your General chats. Open one to continue it.",
      },
      {
        name: "Reflections",
        description:
          "Your reflections on General chats. Only you can see them.",
      },
    ],
    tasks: [
      "Start a chat for a quick question that doesn't need shared files.",
      "Move a chat into a project from its menu when it grows into a bigger topic.",
    ],
    terms: [
      "concept.general-chat",
      "concept.project",
      "concept.chat",
      "concept.reflection",
    ],
    audience: "everyone",
  },
  projects: {
    title: "Projects",
    walkthrough: "03-files-and-projects/projects",
    purpose:
      "All your projects. A project groups related chats and shares files and instructions with each of them.",
    areas: [
      {
        name: "Project list",
        description:
          "Search projects by name or description, and open one to see its chats and files.",
      },
      {
        name: "New project: starting point",
        description:
          "Study a course, Ask my documents, Agent workspace or Blank. A starting point only fills in instructions and chooses which areas show; you can change everything before and after creating.",
      },
      {
        name: "New project: name and description",
        description:
          "Name the project (required), describe it and pick a sidebar color.",
      },
      {
        name: "New project: files and instructions",
        description:
          "Optionally choose files from your library and edit the instructions. To upload new files, create the project and use its Files tab.",
      },
      {
        name: "New project: goal",
        description:
          "Optionally write a learning goal and target date. This step appears only while the Goal area is on.",
      },
      {
        name: "New project: review",
        description:
          "Lists exactly what will be created, with a switch for each area. Nothing is created until you select Create project, and Cancel leaves nothing behind. Sub-agents are chosen afterwards in the Sub-agents tab and need a model that supports tools.",
      },
    ],
    tasks: [
      "Create a project for each course or assignment.",
      "Open a project to start a chat that can use its files.",
    ],
    terms: [
      "concept.project",
      "concept.file-scope",
      "concept.general-chat",
      "concept.team-pack",
    ],
    audience: "everyone",
  },
  project: {
    title: "Project",
    walkthrough: "03-files-and-projects/projects",
    purpose:
      "One project's workspace, organized in tabs. The open tab is in the address, so you can link to it and Back returns to it.",
    areas: [
      {
        name: "Overview",
        description:
          "The project's goal and its most recent chats, with a link to all of them.",
      },
      {
        name: "Chats",
        description:
          "Every chat in this project. Start a new one here and it can use the project's files.",
      },
      {
        name: "Files",
        description:
          "Files shared with every chat in the project. Add files from your library or upload new ones.",
      },
      {
        name: "Study",
        description:
          "Flashcard decks, the Progress panel (topics, what needs practice and unclear items from reflections), quizzes and notes made from this project.",
      },
      {
        name: "Reflections",
        description: "Your private reflections on this project's work.",
      },
      {
        name: "Sub-agents",
        description:
          "Choose which of your sub-agents this project's chats may use. New projects start with none.",
      },
      {
        name: "Settings",
        description:
          "The name, description, instructions and goal; exporting a team pack; and deleting the project, which moves its chats to General and keeps your library files. Instructions shape answers but don't grant tools or files.",
      },
      {
        name: "Feature areas",
        description:
          "Switches in Settings for Study, Reflections, Goal and Sub-agents. Turning one off hides its tab or card and keeps its data, so you can turn it back on later. It changes nothing about what chats can do: selected sub-agents stay selected and can still be used.",
      },
    ],
    tasks: [
      "Add your course notes or readings in Files, then ask about them in any chat here.",
      "Write instructions in Settings, such as the course level or the citation style you need.",
    ],
    terms: [
      "concept.project",
      "concept.file-scope",
      "concept.citation",
      "concept.sub-agent",
      "concept.flashcard",
      "concept.quiz",
      "concept.progress",
      "concept.reflection",
      "concept.team-pack",
    ],
    audience: "everyone",
  },
  files: {
    title: "Files",
    walkthrough: "03-files-and-projects/the-files-library",
    purpose:
      "Your file library. Upload files here, then add them to projects or attach them to chats.",
    areas: [
      {
        name: "File list",
        description:
          "Every file you've uploaded, with its processing status. Files are prepared for search after upload so the assistant can find relevant passages.",
      },
    ],
    tasks: [
      "Upload or drop files here, then add them to a project.",
      "Use the search box to find a file.",
    ],
    terms: ["concept.attachment", "concept.file-scope", "concept.citation"],
    audience: "everyone",
  },
  search: {
    title: "Search",
    walkthrough: "02-chatting/finding-old-chats",
    purpose: "Search across your chats and projects.",
    areas: [
      {
        name: "Results",
        description:
          "Matching projects and chats, with the project each chat belongs to.",
      },
    ],
    tasks: ["Use fewer or different words if nothing matches."],
    terms: ["concept.chat", "concept.project"],
    audience: "everyone",
  },
  help: {
    title: "Help center",
    walkthrough: "01-getting-started/getting-help",
    purpose:
      "Every explanation in Asterism in one place: what each term means and what each page is for.",
    areas: [
      {
        name: "Search",
        description: "Find help by any word in a title or explanation.",
      },
      {
        name: "Sections",
        description:
          "Glossary terms, controls and settings, and a guide for each page. Admin-only topics appear only for administrators.",
      },
    ],
    tasks: [
      "Press ? on most pages to open that page's guide without leaving it.",
    ],
    terms: [],
    audience: "everyone",
  },
  classes: {
    title: "Classes",
    walkthrough: "07-for-educators/running-a-class",
    purpose:
      "Join a class with a code from your educator, or run classes yourself once you're an educator.",
    areas: [
      {
        name: "Join a class",
        description:
          "Enter the class code your educator gave you. An invite link fills it in for you.",
      },
      {
        name: "Your classes",
        description:
          "Classes you've joined. Add or update the class's course project, choose whether to share your practice results in class totals, or leave the class.",
      },
      {
        name: "Teaching",
        description:
          "Ask to become an educator, which sends your name and email to your administrator. Once approved, create classes here and open them to manage them.",
      },
    ],
    tasks: [
      "Add your class's course to get its instructions, sub-agents and files as a project. Only course updates change them; you chat in it.",
      "Turn on sharing to let your educator see class totals. They never see your chats or your own results.",
    ],
    terms: [
      "concept.class",
      "concept.class-code",
      "concept.course",
      "concept.class-insights",
      "concept.educator",
    ],
    audience: "everyone",
  },
  class: {
    title: "Class",
    walkthrough: "07-for-educators/running-a-class",
    purpose:
      "Run one class you teach: let students in, publish its course, set its rules and see where the class struggles.",
    areas: [
      {
        name: "Class code",
        description:
          "Students with an account join with this code or its link. Replacing it stops the old code working; current students stay.",
      },
      {
        name: "Invites for new students",
        description:
          "Each link creates one account and joins this class, then stops working. Copy links when they're made; they aren't shown again.",
      },
      {
        name: "Students",
        description:
          "Who has joined, by name. You never see their chats. Remove a student, or allow a removed one back.",
      },
      {
        name: "Course",
        description:
          "Publish one of your projects as a new course version. Students get their own copy of its instructions, selected sub-agents and files, and choose when to update. Its chats and goal date stay private.",
      },
      {
        name: "Learning mode policy",
        description:
          "Which learning modes students may use in the course project, and whether they can reveal answers. It only limits; their other chats are unaffected.",
      },
      {
        name: "Where the class struggles",
        description:
          "Practice totals by course file from students who chose to share, shown only once enough of them do. Never chats, answers or one student's results.",
      },
      {
        name: "Delete class",
        description:
          "Students lose the class and its code stops working. Their own chats and files are not affected. This can't be undone.",
      },
    ],
    tasks: [
      "Publish a new version with a short note so students know what changed.",
    ],
    terms: [
      "concept.class-code",
      "concept.class-invite",
      "concept.course",
      "concept.mode-policy",
      "concept.class-insights",
    ],
    audience: "everyone",
  },
  "team-packs": {
    title: "Import team pack",
    walkthrough: "03-files-and-projects/team-packs",
    purpose:
      "Add sub-agents, skills, templates, rubrics and a project from a team pack file, after seeing exactly what it asks for.",
    areas: [
      {
        name: "Pack file and starter packs",
        description:
          "Choose a pack file (up to 1 MiB) or review one of the starter packs. Starters are checked the same way as files.",
      },
      {
        name: "Review",
        description:
          "Everything in the pack, written by its author. Choose what to include, rename items and pick a model for each sub-agent. Nothing is created until you confirm.",
      },
    ],
    tasks: [
      "Read a pack's instructions before importing: they shape how your agents behave.",
      "Export your own project's setup from its Settings tab to share it.",
    ],
    terms: [
      "concept.team-pack",
      "concept.sub-agent",
      "concept.skill",
      "concept.template",
      "concept.rubric",
    ],
    audience: "everyone",
  },
  "study.deck": {
    title: "Flashcard deck",
    walkthrough: "05-studying/flashcards",
    purpose:
      "One deck of flashcards in this project. Add and edit cards, draft them from files and review the ones that are due.",
    areas: [
      {
        name: "Deck actions",
        description:
          "Review (N due) starts a review session. Draft from files suggests cards from the project's files. Edit deck changes its name, description and topics; Delete deck removes it and its cards.",
      },
      {
        name: "Cards",
        description:
          "Each card's front, back, sources and next review date. Add card, or edit and delete existing cards.",
      },
    ],
    tasks: ["Tag the deck with topics to follow it in the Progress panel."],
    terms: ["concept.flashcard", "concept.progress", "concept.citation"],
    audience: "everyone",
  },
  "study.drafts": {
    title: "Draft cards",
    walkthrough: "05-studying/flashcards",
    purpose:
      "Have a model suggest flashcards from this project's files. Nothing is saved until you accept a draft.",
    areas: [
      {
        name: "Settings",
        description:
          "Use all project files or choose up to 10, set the number of cards and pick a model.",
      },
      {
        name: "Drafts",
        description:
          "Accept, edit or discard each suggested card, or Accept all. Each draft cites where it came from.",
      },
      {
        name: "Files",
        description: "Which files were used, and why any could not be.",
      },
    ],
    tasks: ["Edit a draft before accepting it if the wording is off."],
    terms: ["concept.flashcard", "concept.model", "concept.citation"],
    audience: "everyone",
  },
  "study.review": {
    title: "Review session",
    walkthrough: "05-studying/flashcards",
    purpose:
      "Go through the cards that are due. How well you recall each one decides when you see it next.",
    areas: [
      {
        name: "Card",
        description:
          "Recall the answer, then Show answer (Space or Enter) and rate it: Again, Hard, Good or Easy (1–4). Each button shows when you'll see the card next.",
      },
      {
        name: "Summary",
        description:
          "Shows how the session went. Review more due cards starts another session if more are due.",
      },
    ],
    tasks: [
      "Rate honestly: Again brings the card back soon and lists it under Needs practice.",
    ],
    terms: ["concept.flashcard", "concept.progress"],
    audience: "everyone",
  },
  "study.quiz-new": {
    title: "New practice quiz",
    walkthrough: "05-studying/practice-quizzes",
    purpose:
      "Generate a quiz from this project's files. Each question cites the file it came from.",
    areas: [
      {
        name: "Quiz settings",
        description:
          "Choose files, the number of questions (1–20), question types, a model and an optional title.",
      },
      {
        name: "Result",
        description:
          "The saved quiz, ready to start, and which files were used.",
      },
    ],
    tasks: [],
    terms: ["concept.quiz", "concept.model", "concept.citation"],
    audience: "everyone",
  },
  "study.quiz": {
    title: "Practice quiz",
    walkthrough: "05-studying/practice-quizzes",
    purpose: "One saved quiz: your scores and every attempt.",
    areas: [
      {
        name: "Quiz actions",
        description:
          "Take or retake the quiz. Edit quiz changes its title and topics; Delete quiz removes it and its attempts.",
      },
      {
        name: "Attempts",
        description:
          "Your best and last scores, and each attempt. Open one to see its answers.",
      },
    ],
    tasks: ["Tag the quiz with topics to follow it in the Progress panel."],
    terms: ["concept.quiz", "concept.progress"],
    audience: "everyone",
  },
  "study.quiz-take": {
    title: "Take quiz",
    walkthrough: "05-studying/practice-quizzes",
    purpose: "Answer the quiz's questions, then submit to see your results.",
    areas: [
      {
        name: "Questions",
        description:
          "Choose an option, or write a short answer. You can leave questions blank.",
      },
      {
        name: "Grading model",
        description:
          "Shown when the quiz has short answers. It grades them against each question's rubric.",
      },
    ],
    tasks: [],
    terms: ["concept.quiz", "concept.model"],
    audience: "everyone",
  },
  "study.quiz-attempt": {
    title: "Quiz results",
    walkthrough: "05-studying/practice-quizzes",
    purpose: "How one attempt went: your score and feedback on every answer.",
    areas: [
      {
        name: "Score",
        description:
          "Multiple-choice answers are marked exactly. A partly correct short answer earns half a point. An answer that couldn't be graded earns no points and is marked as ungraded.",
      },
      {
        name: "Answers",
        description:
          "Each answer's verdict, the correct option or rubric, an explanation and the source. Missed questions are listed under Needs practice.",
      },
    ],
    tasks: [
      "Retake the quiz, or use Practice in the Study tab's Progress panel.",
    ],
    terms: ["concept.quiz", "concept.progress", "concept.citation"],
    audience: "everyone",
  },
  "study.summary-new": {
    title: "Summarize files",
    walkthrough: "05-studying/study-notes",
    purpose:
      "Summarize this project's files at the depth you need. Nothing is saved until you save it as a note.",
    areas: [
      {
        name: "Settings",
        description:
          "Choose files, a depth (simple, standard or expert) and a model.",
      },
      {
        name: "Summary",
        description:
          "The draft, with each section citing its sources, and which files were used. Save as note keeps it.",
      },
    ],
    tasks: [],
    terms: ["concept.study-note", "concept.model", "concept.citation"],
    audience: "everyone",
  },
  "study.guide-new": {
    title: "Plan for an exam",
    walkthrough: "05-studying/study-notes",
    purpose:
      "Get a day-by-day study plan up to your exam, linked to this project's decks and quizzes. Nothing is saved until you save it as a note.",
    areas: [
      {
        name: "Settings",
        description:
          "Start date, exam date (up to 60 days), minutes per day (10–480) and a model. The model sees deck and quiz names and your scores, not your files.",
      },
      {
        name: "Study plan",
        description:
          "Each day's focus, with links to the decks and quizzes to use. Save as note keeps it.",
      },
    ],
    tasks: [],
    terms: ["concept.study-note", "concept.model"],
    audience: "everyone",
  },
  "study.note": {
    title: "Study note",
    walkthrough: "05-studying/study-notes",
    purpose: "A saved summary or study plan from this project.",
    areas: [
      {
        name: "Note",
        description: "The note's text and the files it draws on.",
      },
      {
        name: "Edit and delete",
        description: "Edit note changes its title and Markdown body.",
      },
    ],
    tasks: [],
    terms: ["concept.study-note", "concept.citation"],
    audience: "everyone",
  },
  "settings.general": {
    title: "General settings",
    walkthrough: "06-making-it-yours/general-settings",
    purpose:
      "Your appearance and chat defaults: theme, text size, the model new chats start with, and the chat tour.",
    areas: [
      {
        name: "Account",
        description:
          "The group you're in, which decides the models and tools you may use. Only an administrator can change it.",
      },
      {
        name: "Your data",
        description:
          "Prepare one archive of everything your account holds, then download it. It is kept for 7 days.",
      },
      {
        name: "Sign-in and account",
        description:
          "Sign out on every device, or ask an administrator to delete your account.",
      },
      {
        name: "Appearance",
        description:
          "Choose a theme and text size, and whether to show the model's thinking.",
      },
      {
        name: "Chat",
        description:
          "Choose the model new chats start with, and whether to offer the prompt coach and the canvas. Each chat keeps its own model.",
      },
      {
        name: "Guided tour",
        description:
          "Restart the short tour of the message box and the controls around it.",
      },
    ],
    tasks: [
      "Turn on Prompt coach to get feedback on your prompts before you send them.",
      "Download your data before asking to delete your account.",
    ],
    terms: [
      "concept.model",
      "concept.prompt-coach",
      "concept.canvas",
      "concept.group",
      "concept.data-download",
      "concept.deletion-request",
      "concept.suspension",
    ],
    audience: "everyone",
  },
  "settings.your-asterism": {
    title: "Your Asterism",
    walkthrough: "06-making-it-yours/about-you-and-usage",
    purpose:
      "Tell Asterism about yourself so its answers fit you. What you write is used in every chat.",
    areas: [
      {
        name: "Usage",
        description:
          "Tokens you used today and this month. If your group has a budget, it shows how much is left and when it resets. When it's used up, new messages and study tools wait until then; a reply already running finishes.",
      },
      {
        name: "About you",
        description:
          "One text about who you are, what you're studying or working on, and what you already know. New messages use the latest saved text; messages already sent keep the text they were sent with.",
      },
    ],
    tasks: [
      'Write a few facts about yourself, for example "second-year nursing student; I know basic chemistry".',
      "To change how Asterism responds, pick a learning mode in the chat or edit your main agent's instructions instead.",
    ],
    terms: [
      "concept.about-you",
      "concept.learning-mode",
      "concept.usage-limit",
    ],
    audience: "everyone",
  },
  "settings.skills": {
    title: "Skills",
    walkthrough: "06-making-it-yours/skills",
    purpose:
      "Write reusable instructions once and switch them on in any chat with /.",
    areas: [
      {
        name: "Skill list",
        description:
          "Your private skills. Each is a SKILL.md document with a name, a description and instructions. The switch on each skill assigns it to your main agent, which is what makes it appear in chats. Page through long lists, or search by name or description.",
      },
      {
        name: "New skill",
        description:
          "Write it yourself from a template, or describe it and have your main agent write a draft for you to review.",
      },
    ],
    tasks: [
      "Create a skill, then turn on Assigned to main agent beside it so it appears in chats.",
      "Describe a skill in plain words, review the draft, ask for changes, then save it.",
    ],
    terms: ["concept.skill", "concept.skill-draft", "concept.main-agent"],
    audience: "everyone",
  },
  "settings.templates": {
    title: "Templates",
    walkthrough: "06-making-it-yours/templates-and-rubrics",
    purpose:
      "Prompt templates turn a form into a clear prompt. Browse the built-in frameworks or make your own.",
    areas: [
      {
        name: "Frameworks",
        description:
          "Built-in templates based on well-known prompt frameworks. Duplicate one to customize it.",
      },
      {
        name: "Your templates",
        description: "Templates you've created or duplicated.",
      },
    ],
    tasks: ["Duplicate a framework and adjust its fields for your course."],
    terms: ["concept.template", "concept.prompt-coach"],
    audience: "everyone",
  },
  "settings.rubrics": {
    title: "Rubrics",
    walkthrough: "06-making-it-yours/templates-and-rubrics",
    purpose:
      "Assessment rubrics for Draft feedback mode. Choose one in the composer and feedback is organized by its criteria.",
    areas: [
      {
        name: "Bundled rubrics",
        description:
          "Read-only rubrics that come with Asterism. Duplicate one to adapt it.",
      },
      {
        name: "Your rubrics",
        description:
          "Rubrics you created or duplicated. Search, edit or delete them here.",
      },
    ],
    tasks: [
      "Duplicate a bundled rubric and change its criteria to match your assignment.",
    ],
    terms: ["concept.rubric", "concept.mode-draft-feedback"],
    audience: "everyone",
  },
  "settings.agents": {
    title: "Agents",
    walkthrough: "06-making-it-yours/agents",
    purpose:
      "Configure your main agent, and create sub-agents it can hand work to in General chats and projects.",
    areas: [
      {
        name: "Main agent",
        description:
          "Its instructions, the tools and skills it may use, and its step limit. Every chat uses it with the model you choose there.",
      },
      {
        name: "General chat sub-agents",
        description:
          "The sub-agents the main agent may use in chats outside projects, with each one's fixed model and whether it's available. You start with none. Project chats use their project's selection instead.",
      },
      {
        name: "Sub-agents",
        description:
          "Helpers with their own instructions, a fixed model, tools and skills. Choose a sub-agent for General chats, or select it in a project, before chats can use it. A sub-agent loads its skills on its own when one fits its task.",
      },
    ],
    tasks: [
      "Assign your skills to the main agent so they appear in chats.",
      "Create a sub-agent, then choose it under General chat sub-agents or select it in a project's Sub-agents tab.",
      "Give a sub-agent skills in its editor, under Skills. Its model needs to support tools to load them.",
    ],
    terms: [
      "concept.main-agent",
      "concept.sub-agent",
      "concept.skill",
      "settings.max-steps",
    ],
    audience: "everyone",
  },
  "settings.chatgpt": {
    title: "ChatGPT",
    walkthrough: "06-making-it-yours/connecting-chatgpt",
    purpose:
      "Connect your own ChatGPT plan to run chats on its models. Only you can use your connection.",
    areas: [
      {
        name: "Connection",
        description:
          "Sign in to connect or disconnect. Your plan's models then appear in your own model pickers.",
      },
    ],
    tasks: [],
    terms: ["concept.model"],
    audience: "everyone",
  },
  "admin.providers": {
    title: "Providers",
    walkthrough: "08-for-administrators/providers-and-models",
    purpose:
      "Connect the services that run AI models, and choose which of their models users can pick.",
    areas: [
      {
        name: "Provider list",
        description:
          "Each provider's connection details and models. Disabled models stay bound to sub-agents but become unavailable.",
      },
    ],
    tasks: ["Add a provider, then enable the models users should see."],
    terms: ["admin.providers", "concept.model"],
    audience: "admin",
  },
  "admin.theme-editor": {
    title: "Theme editor",
    walkthrough: "08-for-administrators/theme-editor",
    purpose: "Create and edit the color themes users can choose.",
    areas: [
      {
        name: "Themes",
        description: "Pick a theme to edit its colors, or create a new one.",
      },
    ],
    tasks: [],
    terms: [],
    audience: "admin",
  },
  "admin.tools": {
    title: "Tools",
    walkthrough: "08-for-administrators/policies#tools",
    purpose:
      "Turn on the tools agents may be assigned, and configure the services behind them.",
    areas: [
      {
        name: "Tool list",
        description:
          "Each tool's status and settings. Users still assign tools to their own main agent.",
      },
    ],
    tasks: [],
    terms: ["admin.tools", "concept.tool-approval"],
    audience: "admin",
  },
  "admin.skills": {
    title: "Skills policy",
    walkthrough: "08-for-administrators/policies#skills",
    purpose: "Turn skills on or off for every user.",
    areas: [
      {
        name: "Policy",
        description:
          "Skills are off until enabled. Enabling them grants no tools, files or delegation.",
      },
    ],
    tasks: [],
    terms: ["admin.skills-policy", "concept.skill"],
    audience: "admin",
  },
  "admin.canvas": {
    title: "Canvas policy",
    walkthrough: "08-for-administrators/policies#canvas",
    purpose:
      "Turn the canvas, the panel where the main agent writes documents and code, on or off for every user.",
    areas: [
      {
        name: "Availability",
        description:
          "The canvas is off until enabled. Users also turn it on in their own settings. Turning it off stops writes at once; existing items stay readable.",
      },
    ],
    tasks: [],
    terms: ["admin.canvas-policy", "concept.canvas"],
    audience: "admin",
  },
  "admin.chatgpt": {
    title: "ChatGPT plans",
    walkthrough: "08-for-administrators/policies#chatgpt-plans",
    purpose:
      "Control whether users can connect their own ChatGPT plan and run chats on it.",
    areas: [
      {
        name: "Plan connections",
        description:
          "Disabling makes plan models unavailable and blocks new connections. Existing chats and bindings are kept.",
      },
    ],
    tasks: [],
    terms: ["concept.model"],
    audience: "admin",
  },
  "admin.context-compaction": {
    title: "Context compaction",
    walkthrough: "08-for-administrators/policies#context-compaction",
    purpose:
      "Control how long chats are summarized so they keep working near the model's context limit.",
    areas: [
      {
        name: "When to compact",
        description:
          "The threshold, the recent turns always sent in full, and the window assumed for models whose context window is unknown.",
      },
      {
        name: "Summarizer",
        description:
          "Each chat's own model, or one dedicated model for every summary.",
      },
    ],
    tasks: [
      "Set each model's real context window in Providers so compaction starts at the right time.",
    ],
    terms: ["admin.context-compaction", "concept.context-compaction"],
    audience: "admin",
  },
  "admin.image-generation": {
    title: "Image generation",
    walkthrough: "08-for-administrators/policies#image-generation",
    purpose:
      "Choose what creates images, try it, and decide who may create images in chat.",
    areas: [
      {
        name: "Generator",
        description:
          "An existing ComfyUI server, or Diffusers, which runs a model on this server. Test connection checks a ComfyUI server and lists its checkpoints.",
      },
      {
        name: "Local models",
        description:
          "Shown for Diffusers: the detected hardware, which models fit it, their licenses and download sizes. Download one, then select Use this model.",
      },
      {
        name: "Try it",
        description:
          "Creates one image with the saved generator and puts it in your files. It works before image generation is turned on.",
      },
      {
        name: "Availability",
        description:
          "Off until enabled. Limit it to selected groups, or leave it open to everyone.",
      },
    ],
    tasks: [
      "Save the generator before trying it; the test uses the saved settings.",
      "Read a model's license before downloading: some may not be used commercially.",
    ],
    terms: [
      "admin.image-generation",
      "concept.image-generation",
      "admin.settings-file",
    ],
    audience: "admin",
  },
  "admin.image-captioning": {
    title: "Image captioning",
    walkthrough: "08-for-administrators/policies#image-captioning",
    purpose:
      "Choose how images in uploaded files are described so they can be searched.",
    areas: [
      {
        name: "Knowledge processing",
        description:
          "Changing the mode or provider reprocesses eligible files. Current results stay searchable until replacements succeed.",
      },
    ],
    tasks: [],
    terms: ["concept.file-scope"],
    audience: "admin",
  },
  "admin.groups": {
    title: "Groups",
    walkthrough: "08-for-administrators/groups-budgets-and-usage#groups",
    purpose:
      "Limit which models and tools each group of users may use. Everyone is in exactly one group.",
    areas: [
      {
        name: "Groups",
        description:
          "Admin, Educator and Student are built in and can't be renamed or deleted. Create other groups for people who need different access; a group can be deleted once it's empty.",
      },
      {
        name: "Access",
        description:
          "Each group allows every enabled model and tool, or only the ones you check. It can only narrow what Providers and Tools turn on, and members' own ChatGPT plan models aren't limited.",
      },
      {
        name: "Usage budget",
        description:
          "Tokens each member may use per day and per month, input and output together. Once a member has used it, new sends, regenerations, study tools and images are refused until it resets; replies already running finish. Leave a field empty for no budget. Admins never have one.",
      },
    ],
    tasks: [
      "Limit students to some models: edit access for Student and check the models they may use.",
      "Give each student 200,000 tokens a day: edit the usage budget for Student.",
      "Move people between groups from the Users section.",
    ],
    terms: ["concept.group", "concept.model"],
    audience: "admin",
  },
  "admin.usage": {
    title: "Usage",
    walkthrough: "08-for-administrators/groups-budgets-and-usage#usage",
    purpose:
      "See how many tokens each person used on each model, what it is estimated to have cost, and set when budget days start.",
    areas: [
      {
        name: "Usage",
        description:
          "Tokens and images per user and model, and totals per group, for the days you choose. Every model call counts: chats, sub-agents, verification, study tools, chat titles and image captions. Cost uses each model's price when the call ran; \"—\" means the model had no price or ran on a member's ChatGPT plan. Usage is recorded from the version that added this page on.",
      },
      {
        name: "Budget day",
        description:
          "The timezone whose midnight starts each budget day, and whose 1st starts each month, for everyone. Set it to your school's timezone.",
      },
    ],
    tasks: [
      "Check last week's usage: choose its first and last day.",
      "Set budgets per group in the Groups section.",
    ],
    terms: ["concept.group", "concept.model"],
    audience: "admin",
  },
  "admin.status": {
    title: "Status",
    walkthrough: "08-for-administrators/groups-budgets-and-usage#status",
    purpose:
      "See whether the instance is ready and how busy it is, without opening the server's logs.",
    areas: [
      {
        name: "Instance",
        description:
          "Version, schema revision, how long it has been running and the log settings. Ready means the database takes writes, storage has its minimum free space and sign-in keys load; Not ready names what failed.",
      },
      {
        name: "Work",
        description:
          "Replies running and chat connections open, against their limits, and file processing running or waiting. At a limit, new work is refused until a slot frees up.",
      },
      {
        name: "Storage and backups",
        description:
          "How much Asterism's data takes, the disk's free space, and when the last backup ran. Backups more than two days old are shown in red.",
      },
    ],
    tasks: [
      "Before an upgrade, check that the last backup is recent.",
      "Match a problem across the server's logs: nginx and backend lines for one request share its request id.",
    ],
    terms: [],
    audience: "admin",
  },
  "admin.users": {
    title: "Users",
    walkthrough: "08-for-administrators/users-and-accounts",
    purpose:
      "See who has an account, move people between groups, and suspend, reactivate, reset or delete accounts.",
    areas: [
      {
        name: "User list",
        description:
          "Each account's name, email, group, educator status and the date it was first seen. Names and emails come from sign-in and update the next time the person uses Asterism.",
      },
      {
        name: "Group",
        description:
          "Choose another group to change what someone may use. Moving someone into Educator approves educator access; moving them out revokes it. Administrators are always in Admin.",
      },
      {
        name: "Account actions",
        description:
          "The … button beside an account. Suspend blocks sign-in without deleting anything, and Reactivate lets the person back in. Create password reset link makes a one-time link for you to send them. Delete account removes the account and everything it owns, and can't be undone. Your own row has no actions.",
      },
      {
        name: "Deletion requests",
        description:
          "A row marked Asked for deletion is a person's request to delete their account. Nothing changes until you act: delete the account, or select Dismiss to decline.",
      },
      {
        name: "Search",
        description: "Find people by part of their name, email or user ID.",
      },
    ],
    tasks: [
      "When someone forgets their password, create a reset link and send it to them yourself. It works once, until the time it shows.",
      "To keep someone's work but stop them signing in, suspend the account instead of deleting it.",
      "Approve educators from the Educators section; their status shows here.",
    ],
    terms: ["concept.group", "concept.suspension", "concept.deletion-request"],
    audience: "admin",
  },
  "admin.educators": {
    title: "Educators",
    walkthrough: "08-for-administrators/users-and-accounts#educators",
    purpose: "Decide who may run classes. Educators are not administrators.",
    areas: [
      {
        name: "Requests and educators",
        description:
          "Users ask from the Classes page. Approving moves them into the Educator group, and revoking moves them back to Student. Revoking stops them managing their classes; students stay in them.",
      },
    ],
    tasks: [],
    terms: ["concept.educator", "concept.class", "concept.group"],
    audience: "admin",
  },
  "admin.export": {
    title: "Export and import settings",
    walkthrough: "08-for-administrators/policies#export",
    purpose:
      "Move every application setting between installations in one file. Users, chats and files are not included.",
    areas: [
      {
        name: "Export settings",
        description:
          "Saves providers, models, tools, policies and each group's model and tool access. Group membership isn't included. API keys in the file are encrypted with a passphrase you choose; without it the file can't be opened.",
      },
      {
        name: "Import settings",
        description:
          "Providers in the file are added, or updated when the name matches. Settings in the file replace current values. Nothing is removed.",
      },
    ],
    tasks: [],
    terms: ["admin.settings-file", "admin.providers"],
    audience: "admin",
  },
};

const userSettingsGuides: Record<string, PageGuideId> = {
  general: "settings.general",
  "your-asterism": "settings.your-asterism",
  skills: "settings.skills",
  templates: "settings.templates",
  rubrics: "settings.rubrics",
  agents: "settings.agents",
  chatgpt: "settings.chatgpt",
};

// Planned sections get no guide until they ship (ADR-0032), so no Help button.
const adminSettingsGuides: Record<string, PageGuideId | null> = {
  providers: "admin.providers",
  theme_editor: "admin.theme-editor",
  tools: "admin.tools",
  skills: "admin.skills",
  canvas: "admin.canvas",
  chatgpt: "admin.chatgpt",
  "context-compaction": "admin.context-compaction",
  "image-captioning": "admin.image-captioning",
  "user-permissions": "admin.users",
  educators: "admin.educators",
  export: "admin.export",
  "group-settings": "admin.groups",
  usage: "admin.usage",
  status: "admin.status",
  "image-generation": "admin.image-generation",
  memory: null,
  "code-execution": null,
};

/** Study pages, most specific first; each is under /projects/{id}/study. */
const studyGuides: [RegExp, PageGuideId][] = [
  [/^quizzes\/new$/, "study.quiz-new"],
  [/^quizzes\/[^/]+\/take$/, "study.quiz-take"],
  [/^quizzes\/[^/]+\/attempts\/[^/]+$/, "study.quiz-attempt"],
  [/^quizzes\/[^/]+$/, "study.quiz"],
  [/^summaries\/new$/, "study.summary-new"],
  [/^guides\/new$/, "study.guide-new"],
  [/^notes\/[^/]+$/, "study.note"],
  [/^[^/]+\/drafts$/, "study.drafts"],
  [/^[^/]+\/review$/, "study.review"],
  [/^[^/]+$/, "study.deck"],
];

/**
 * The guide for a dashboard location, or null when the page has none.
 * Settings follow the same tab rules as the settings page: the admin tab is
 * only for admins, and an unknown section falls back to its tab's default.
 * Every page and section has its own guide; a test enforces this.
 */
export function pageGuideFor(
  pathname: string,
  params: { t?: string | null; setting?: string | null },
  isAdmin: boolean,
): PageGuideId | null {
  if (pathname === "/") return "new-chat";
  if (/^\/c\/[^/]+\/files\/[^/]+/.test(pathname)) return "file";
  if (/^\/c\/[^/]+\/?$/.test(pathname)) return "chat";
  if (/^\/projects\/[^/]+\/?$/.test(pathname)) return "project";
  const study = /^\/projects\/[^/]+\/study\/(.+?)\/?$/.exec(pathname);
  if (study)
    return studyGuides.find(([pattern]) => pattern.test(study[1]))?.[1] ?? null;
  if (/^\/classes\/[^/]+\/?$/.test(pathname)) return "class";
  if (/^\/files\/[^/]+/.test(pathname)) return "file";
  // The user guide is part of help (US-90.9).
  if (/^\/help\/guide(\/|$)/.test(pathname)) return "help";
  switch (pathname) {
    case "/general":
      return "general";
    case "/projects":
      return "projects";
    case "/team-packs":
      return "team-packs";
    case "/classes":
      return "classes";
    case "/help":
      return "help";
    case "/files":
      return "files";
    case "/search":
      return "search";
    case "/settings":
      if (params.t === "admin" && isAdmin) {
        const setting = params.setting ?? "providers";
        return Object.hasOwn(adminSettingsGuides, setting)
          ? adminSettingsGuides[setting]
          : "admin.providers";
      }
      return params.setting && Object.hasOwn(userSettingsGuides, params.setting)
        ? userSettingsGuides[params.setting]
        : "settings.general";
  }
  return null;
}
