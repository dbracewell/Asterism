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
  | "settings.general"
  | "settings.personas"
  | "settings.skills"
  | "settings.templates"
  | "settings.agents"
  | "settings.chatgpt"
  | "admin.overview"
  | "admin.providers"
  | "admin.theme-editor"
  | "admin.tools"
  | "admin.skills"
  | "admin.chatgpt"
  | "admin.image-captioning"
  | "admin.users";

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
          "Shows where the chat lives, its model and persona, the mode lock in a learning mode, and a menu to rename, move or delete the chat.",
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
    purpose: "A view of one file and its contents.",
    areas: [
      {
        name: "Preview",
        description:
          "Shows the file as text, Markdown or an image, depending on its type.",
      },
    ],
    tasks: ["Go back to the chat or file library with the link in the header."],
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
    ],
    tasks: [
      "Start a chat for a quick question that doesn't need shared files.",
      "Move a chat into a project from its menu when it grows into a bigger topic.",
    ],
    terms: ["concept.general-chat", "concept.project", "concept.chat"],
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
    ],
    tasks: [
      "Create a project for each course or assignment.",
      "Open a project to start a chat that can use its files.",
    ],
    terms: ["concept.project", "concept.file-scope", "concept.general-chat"],
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
      "concept.main-agent",
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
  "settings.general": {
    title: "General settings",
    purpose:
      "Your appearance and chat defaults: theme, text size, the model new chats start with, and chat preferences.",
    areas: [
      {
        name: "Appearance",
        description: "Choose a theme and text size.",
      },
      {
        name: "Chat",
        description:
          "Choose the default model for new chats, whether to show the model's thinking, and whether to offer the prompt coach.",
      },
    ],
    tasks: [
      "Turn on Prompt Coach to get feedback on your prompts before you send them.",
    ],
    terms: ["concept.model", "concept.prompt-coach"],
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
  "settings.agents": {
    title: "Agents",
    purpose:
      "Configure your main agent, and create sub-agents that projects can use.",
    areas: [
      {
        name: "Main agent",
        description:
          "Its instructions, the tools and skills it may use, and its step limit. Every chat uses it with the model you choose there.",
      },
      {
        name: "Sub-agents",
        description:
          "Helpers with their own instructions and a fixed model. A project must select a sub-agent before its chats can use it.",
      },
    ],
    tasks: [
      "Assign your skills to the main agent so they appear in chats.",
      "Create a sub-agent, then select it in a project's settings.",
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
  "admin.overview": {
    title: "Admin settings",
    purpose:
      "Platform-wide settings that apply to every user. Sections marked Planned are not available yet.",
    areas: [
      {
        name: "Sections",
        description:
          "Providers, themes, users, tools, skills, ChatGPT plans, image captioning and educators.",
      },
    ],
    tasks: [],
    terms: ["admin.providers", "admin.tools", "admin.skills-policy"],
    audience: "admin",
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
  "admin.users": {
    title: "Users",
    purpose:
      "See who has an account. The list is read-only; accounts are not changed here.",
    areas: [
      {
        name: "User list",
        description:
          "Each account's name, email, educator status and the date it was first seen. Names and emails come from sign-in and update the next time the person uses Asterism.",
      },
      {
        name: "Search",
        description: "Find people by part of their name, email or user ID.",
      },
    ],
    tasks: [
      "Approve educators from the Educators section; their status shows here.",
    ],
    terms: [],
    audience: "admin",
  },
};

const userSettingsGuides: Record<string, PageGuideId> = {
  general: "settings.general",
  personas: "settings.personas",
  skills: "settings.skills",
  templates: "settings.templates",
  agents: "settings.agents",
  chatgpt: "settings.chatgpt",
};

const adminSettingsGuides: Record<string, PageGuideId> = {
  providers: "admin.providers",
  theme_editor: "admin.theme-editor",
  tools: "admin.tools",
  skills: "admin.skills",
  chatgpt: "admin.chatgpt",
  "image-captioning": "admin.image-captioning",
  "user-permissions": "admin.users",
};

/**
 * The guide for a dashboard location, or null when the page has none.
 * Settings follow the same tab rules as the settings page: the admin tab is
 * only for admins, and an unknown section falls back to its tab's default.
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
  if (/^\/files\/[^/]+/.test(pathname)) return "file";
  switch (pathname) {
    case "/general":
      return "general";
    case "/projects":
    case "/team-packs":
      return "projects";
    case "/classes":
      return "projects";
    case "/files":
      return "files";
    case "/search":
      return "search";
    case "/settings":
      if (params.t === "admin" && isAdmin) {
        const setting = params.setting ?? "providers";
        return adminSettingsGuides[setting] ?? "admin.overview";
      }
      return userSettingsGuides[params.setting ?? ""] ?? "settings.general";
  }
  return null;
}
