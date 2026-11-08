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
  | "settings.personas"
  | "settings.skills"
  | "settings.templates"
  | "settings.rubrics"
  | "settings.agents"
  | "settings.chatgpt"
  | "admin.providers"
  | "admin.theme-editor"
  | "admin.tools"
  | "admin.skills"
  | "admin.chatgpt"
  | "admin.image-captioning"
  | "admin.groups"
  | "admin.users"
  | "admin.educators"
  | "admin.export";

export interface PageGuide {
  title: string;
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
          "Write your message here. The buttons below it choose the model, persona and learning mode, and add files, templates or skills.",
      },
    ],
    tasks: [
      "To practice rather than get answers, set the learning mode to Tutor before you send.",
      "Type / in the message box to add a skill or a prompt template.",
      "Use the paperclip to attach your notes or work.",
    ],
    terms: [
      "composer.controls",
      "concept.learning-mode",
      "concept.persona",
      "concept.model",
      "concept.general-chat",
      "concept.project",
    ],
    audience: "everyone",
  },
  chat: {
    title: "Chat",
    purpose:
      "A conversation with the assistant. Read the replies, keep the conversation going, and change how the assistant helps at any time.",
    areas: [
      {
        name: "Header",
        description:
          "Shows where the chat lives, its model and persona, the mode lock in a learning mode, and a menu to rename or move the chat, reflect on the session, export an AI-use log or delete the chat.",
      },
      {
        name: "Conversation",
        description:
          "Your messages and the replies. Messages show the model, persona and learning mode used, and replies show any tools they used and the sources they relied on.",
      },
      {
        name: "Hint controls",
        description:
          "In Tutor or Review my work mode, ask for stronger hints or reveal the answer here.",
      },
      {
        name: "Message box",
        description:
          "Write your next message. Changes to the model, persona or mode apply from your next message.",
      },
    ],
    tasks: [
      "Regenerate a reply to get another version, then use the arrows to switch between versions.",
      "Use Compare with other models under a reply to see how different models answer.",
      "Lock the learning mode from the header to stop yourself skipping ahead.",
    ],
    terms: [
      "concept.chat",
      "composer.controls",
      "concept.hint-levels",
      "concept.mode-lock",
      "concept.citation",
      "concept.tool-approval",
    ],
    audience: "everyone",
  },
  file: {
    title: "File",
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
          "Flashcard decks, topic mastery, weak spots, quizzes and notes made from this project.",
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
      "concept.weak-spot",
      "concept.reflection",
      "concept.team-pack",
    ],
    audience: "everyone",
  },
  files: {
    title: "Files",
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
      "concept.class-mode-policy",
      "concept.class-insights",
    ],
    audience: "everyone",
  },
  "team-packs": {
    title: "Import team pack",
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
    tasks: [
      "Tag the deck with topics to see your progress under Topic mastery.",
    ],
    terms: ["concept.flashcard", "concept.topic-mastery", "concept.citation"],
    audience: "everyone",
  },
  "study.drafts": {
    title: "Draft cards",
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
      "Rate honestly: Again brings the card back soon and marks it as a weak spot.",
    ],
    terms: ["concept.flashcard", "concept.weak-spot", "concept.topic-mastery"],
    audience: "everyone",
  },
  "study.quiz-new": {
    title: "New practice quiz",
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
    tasks: [
      "Tag the quiz with topics to see your progress under Topic mastery.",
    ],
    terms: ["concept.quiz", "concept.weak-spot", "concept.topic-mastery"],
    audience: "everyone",
  },
  "study.quiz-take": {
    title: "Take quiz",
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
          "Each answer's verdict, the correct option or rubric, an explanation and the source. Missed questions become weak spots.",
      },
    ],
    tasks: ["Retake the quiz, or practice weak spots from the Study tab."],
    terms: ["concept.quiz", "concept.weak-spot", "concept.citation"],
    audience: "everyone",
  },
  "study.summary-new": {
    title: "Summarize files",
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
    purpose:
      "Your appearance and chat defaults: theme, text size, the model new chats start with, and the chat tour.",
    areas: [
      {
        name: "Account",
        description:
          "The group you're in, which decides the models and tools you may use. Only an administrator can change it.",
      },
      {
        name: "Appearance",
        description:
          "Choose a theme and text size, and whether to show the model's thinking.",
      },
      {
        name: "Chat",
        description:
          "Choose the model new chats start with, and whether to offer the prompt coach. Each chat keeps its own model.",
      },
      {
        name: "Guided tour",
        description:
          "Restart the short tour of the message box and the controls around it.",
      },
    ],
    tasks: [
      "Turn on Prompt Coach to get feedback on your prompts before you send them.",
    ],
    terms: ["concept.model", "concept.prompt-coach", "concept.group"],
    audience: "everyone",
  },
  "settings.personas": {
    title: "Personas",
    purpose:
      "Describe yourself and how you'd like the assistant to respond. You can keep several personas and choose one as your default.",
    areas: [
      {
        name: "Persona list",
        description:
          "Each persona has a name and a USER.md document. Your default persona is used for new chats unless you pick another.",
      },
    ],
    tasks: [
      'Write your level, goals and preferred explanation style, for example "first-year biology student; explain with everyday examples".',
    ],
    terms: ["concept.persona", "concept.learning-mode"],
    audience: "everyone",
  },
  "settings.skills": {
    title: "Skills",
    purpose:
      "Write reusable instructions once and switch them on in any chat with /.",
    areas: [
      {
        name: "Skill list",
        description:
          "Your private skills. Each is a SKILL.md document with a name, a description and instructions.",
      },
    ],
    tasks: [
      "Create a skill, then assign it to your main agent under Agents so it appears in chats.",
    ],
    terms: ["concept.skill", "concept.main-agent"],
    audience: "everyone",
  },
  "settings.templates": {
    title: "Templates",
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
          "Helpers with their own instructions and a fixed model. Choose a sub-agent for General chats, or select it in a project, before chats can use it.",
      },
    ],
    tasks: [
      "Assign your skills to the main agent so they appear in chats.",
      "Create a sub-agent, then choose it under General chat sub-agents or select it in a project's Sub-agents tab.",
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
  "admin.chatgpt": {
    title: "ChatGPT plans",
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
  "admin.image-captioning": {
    title: "Image captioning",
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
    ],
    tasks: [
      "Limit students to some models: edit access for Student and check the models they may use.",
      "Move people between groups from the Users section.",
    ],
    terms: ["concept.group", "concept.model"],
    audience: "admin",
  },
  "admin.users": {
    title: "Users",
    purpose:
      "See who has an account and move people between groups. Accounts are not otherwise changed here.",
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
        name: "Search",
        description: "Find people by part of their name, email or user ID.",
      },
    ],
    tasks: [
      "Approve educators from the Educators section; their status shows here.",
    ],
    terms: ["concept.group"],
    audience: "admin",
  },
  "admin.educators": {
    title: "Educators",
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
  personas: "settings.personas",
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
  chatgpt: "admin.chatgpt",
  "image-captioning": "admin.image-captioning",
  "user-permissions": "admin.users",
  educators: "admin.educators",
  export: "admin.export",
  "group-settings": "admin.groups",
  "image-generation": null,
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
