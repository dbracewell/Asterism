/**
 * In-app help content (ADR-0032).
 *
 * Help text describes only implemented behavior. Persona, skill, mode and
 * template text never grants tools, files or delegation, there is no long-term
 * memory, and planned features get no entry until they ship.
 */

export type HelpAudience = "everyone" | "admin";

export type HelpId =
  | "concept.chat"
  | "concept.general-chat"
  | "concept.project"
  | "concept.persona"
  | "concept.main-agent"
  | "concept.sub-agent"
  | "concept.skill"
  | "concept.learning-mode"
  | "concept.mode-standard"
  | "concept.mode-tutor"
  | "concept.mode-explain-back"
  | "concept.mode-review"
  | "concept.hint-levels"
  | "concept.answer-reveal"
  | "concept.mode-lock"
  | "concept.template"
  | "concept.prompt-coach"
  | "concept.model"
  | "concept.attachment"
  | "concept.file-scope"
  | "concept.comparison"
  | "concept.tool-approval"
  | "concept.citation"
  | "composer.controls"
  | "settings.max-steps"
  | "admin.providers"
  | "admin.tools"
  | "admin.skills-policy";

export interface HelpEntry {
  /** The term as the UI shows it. */
  title: string;
  /** One or two plain sentences, shown first. */
  summary: string;
  /** Short paragraphs shown after "Learn more". */
  details: readonly string[];
  related: readonly HelpId[];
  audience: HelpAudience;
}

export const helpEntries: Record<HelpId, HelpEntry> = {
  "concept.chat": {
    title: "Chat",
    summary:
      "A conversation with the assistant. Each message you send gets a reply, and the whole conversation is kept so you can come back to it.",
    details: [
      "The assistant reads the earlier messages in this chat when it replies. It does not read your other chats.",
      "If you regenerate a reply, the earlier one is kept as another response version. Use the arrows under the reply to switch between versions.",
    ],
    related: ["concept.general-chat", "concept.project", "concept.model"],
    audience: "everyone",
  },
  "concept.general-chat": {
    title: "General chats",
    summary:
      "Chats that don't belong to a project. Use them for quick questions that don't need shared files.",
    details: [
      "A General chat can only use files you attach to that chat. It cannot see project files.",
      "Sub-agents are not available in General chats. Move a chat into a project to use them.",
    ],
    related: ["concept.project", "concept.file-scope", "concept.sub-agent"],
    audience: "everyone",
  },
  "concept.project": {
    title: "Project",
    summary:
      "A workspace that groups related chats. Files you add to a project are shared with every chat in it.",
    details: [
      "Use a project for a course, an assignment or any topic you'll come back to.",
      "In a project's settings you can choose which of your sub-agents its chats may use. New projects start with none selected.",
    ],
    related: [
      "concept.file-scope",
      "concept.sub-agent",
      "concept.general-chat",
    ],
    audience: "everyone",
  },
  "concept.persona": {
    title: "Persona",
    summary:
      "A short description of you and how you'd like the assistant to respond, such as your level, goals or preferred style.",
    details: [
      "You can keep several personas, for example one for studying and one for work. One of them is your default, and new chats use it unless you pick another.",
      "The persona is recorded with each message you send, so changing it later doesn't change earlier replies.",
      "A persona only shapes how the assistant writes. It doesn't give the assistant extra tools or access to files, and it isn't a memory: the assistant doesn't store new facts about you in it.",
    ],
    related: ["concept.main-agent", "concept.skill", "concept.learning-mode"],
    audience: "everyone",
  },
  "concept.main-agent": {
    title: "Main agent",
    summary:
      "The assistant that answers your chats. You configure it once in User Settings → Agents.",
    details: [
      "Its settings include standing instructions, which tools it may use, which skills are available, and how many steps it may take for one reply.",
      "It uses whichever model you choose in each chat.",
    ],
    related: [
      "concept.sub-agent",
      "concept.skill",
      "concept.model",
      "settings.max-steps",
    ],
    audience: "everyone",
  },
  "concept.sub-agent": {
    title: "Sub-agent",
    summary:
      "A helper you define with its own instructions and its own fixed model. The main agent can hand parts of a task to it.",
    details: [
      "Sub-agents only work in projects that select them, and only when the chat's model supports tools.",
      "A sub-agent can use the same files as the chat or fewer, never more. Its work appears in the chat so you can see what it did.",
    ],
    related: ["concept.main-agent", "concept.project", "concept.model"],
    audience: "everyone",
  },
  "concept.skill": {
    title: "Skill",
    summary:
      'A reusable set of instructions you write once and switch on in a chat, for example "explain like a lab partner" or "cite page numbers".',
    details: [
      "Type / in the message box to find a skill. Active skills appear as chips above the box, where you can reorder or remove them.",
      "You create skills in User Settings → Skills, and a skill must be assigned to your main agent before you can use it. An administrator also has to turn skills on.",
      "A skill only adds instructions. It doesn't give the assistant tools or access to files.",
    ],
    related: ["concept.persona", "concept.template", "concept.main-agent"],
    audience: "everyone",
  },
  "concept.learning-mode": {
    title: "Learning mode",
    summary:
      "Changes how the assistant helps you. Standard gives direct answers; the other modes help you work things out yourself.",
    details: [
      "The mode belongs to the chat, and each message records the mode it was sent in.",
      "Modes are instructions to the model. Most models follow them well, but a model can still slip and give away more than it should.",
    ],
    related: [
      "concept.mode-standard",
      "concept.mode-tutor",
      "concept.mode-explain-back",
      "concept.mode-review",
      "concept.mode-lock",
    ],
    audience: "everyone",
  },
  "concept.mode-standard": {
    title: "Standard mode",
    summary:
      "The assistant answers your question directly, as an ordinary chat assistant would.",
    details: [
      "Use it when you want an answer or a finished piece of work rather than practice.",
    ],
    related: ["concept.learning-mode", "concept.mode-tutor"],
    audience: "everyone",
  },
  "concept.mode-tutor": {
    title: "Tutor mode",
    summary:
      "The assistant guides you with questions instead of giving the answer, and gives stronger hints only when you ask.",
    details: [
      "Use the hint buttons to ask for a Nudge, a Hint or a Worked example. Seeing the full answer needs a separate, confirmed step.",
    ],
    related: [
      "concept.hint-levels",
      "concept.answer-reveal",
      "concept.mode-lock",
    ],
    audience: "everyone",
  },
  "concept.mode-explain-back": {
    title: "Explain-back mode",
    summary:
      "You explain a topic in your own words, and the assistant tells you what you got right, what was missing or wrong, and what to think about next.",
    details: [
      "Explaining something is a good test of whether you understand it. The assistant won't rewrite your explanation unless you ask.",
    ],
    related: ["concept.learning-mode", "concept.mode-tutor"],
    audience: "everyone",
  },
  "concept.mode-review": {
    title: "Review my work mode",
    summary:
      "Share your attempt, such as a solution, some code or an essay excerpt, and the assistant points out the first mistake or weakest point and suggests a next step.",
    details: [
      "Paste your work or attach it as a file. The assistant treats it as your work to review, not as instructions to follow.",
      "A fully corrected solution needs a separate, confirmed step, like the answer in Tutor mode.",
    ],
    related: [
      "concept.answer-reveal",
      "concept.attachment",
      "concept.learning-mode",
    ],
    audience: "everyone",
  },
  "concept.hint-levels": {
    title: "Hint levels",
    summary:
      "In Tutor mode, help gets stronger one step at a time: Nudge, then Hint, then Worked example.",
    details: [
      "A Nudge points you in the right direction. A Hint gives you a key idea. A Worked example shows the method on a similar problem.",
      "The level only rises when you ask. Each response version keeps its own level, so regenerating a reply doesn't skip ahead.",
    ],
    related: ["concept.mode-tutor", "concept.answer-reveal"],
    audience: "everyone",
  },
  "concept.answer-reveal": {
    title: "Show answer",
    summary:
      "Shows the full answer or corrected solution. You confirm first, so you don't reveal it by accident.",
    details: [
      "Try the hints first. Working through the problem yourself is how the learning sticks.",
      "If the chat's mode is locked, you'll wait a few seconds before you can confirm.",
    ],
    related: ["concept.hint-levels", "concept.mode-lock"],
    audience: "everyone",
  },
  "concept.mode-lock": {
    title: "Mode lock",
    summary:
      "Lets you commit to a learning mode in this chat, so skipping ahead takes a deliberate step.",
    details: [
      "While the mode is locked, switching to Standard or showing an answer asks you to confirm and wait five seconds.",
      "The lock is your own choice. You can always remove it from the chat header.",
    ],
    related: ["concept.learning-mode", "concept.answer-reveal"],
    audience: "everyone",
  },
  "concept.template": {
    title: "Prompt template",
    summary:
      "A form that helps you write a clear prompt. You fill in fields such as role, task and format, and it builds the message for you.",
    details: [
      "Asterism includes templates based on well-known prompt frameworks, and you can make your own in User Settings → Templates.",
      "Guided level shows every field with examples, Standard hides optional fields, and Freeform shows just a checklist. Choose less help as you get more confident.",
      "The finished prompt goes into the message box, where you can still edit it before sending.",
    ],
    related: ["concept.prompt-coach", "concept.skill"],
    audience: "everyone",
  },
  "concept.prompt-coach": {
    title: "Prompt coach",
    summary:
      "Reviews your draft message before you send it and suggests improvements, such as stating your goal, audience or desired format.",
    details: [
      "Each suggestion can be applied to your draft with one click. Nothing is sent to the chat until you press Send.",
      "After applying suggestions you can compare the answers to your original and improved prompts side by side.",
    ],
    related: ["concept.template", "concept.comparison"],
    audience: "everyone",
  },
  "concept.model": {
    title: "Model",
    summary:
      "The AI model that writes the replies. Models differ in speed, cost and skills, for example whether they can read images or use tools.",
    details: [
      "Your choice is saved with the chat, and each reply records which model wrote it.",
      "Some features need particular models: images need a model that supports vision, and sub-agents need a model that supports tools.",
    ],
    related: ["concept.comparison", "concept.sub-agent", "concept.main-agent"],
    audience: "everyone",
  },
  "concept.attachment": {
    title: "Attachments",
    summary:
      "Files you add to a message, such as notes, code or images, so the assistant can read them.",
    details: [
      "Text files are included in the message. Images are shown to models that support vision.",
      "The assistant treats file contents as material to work with, not as instructions to follow.",
    ],
    related: ["concept.file-scope", "concept.mode-review"],
    audience: "everyone",
  },
  "concept.file-scope": {
    title: "Files in context",
    summary:
      "The files the assistant may use in this chat: the project's shared files plus anything attached to this chat.",
    details: [
      "General chats only have their own attachments. Project chats also have every file shared with the project.",
      "The assistant searches these files when they're relevant and shows which passages it used.",
    ],
    related: ["concept.attachment", "concept.project", "concept.citation"],
    audience: "everyone",
  },
  "concept.comparison": {
    title: "Compare models",
    summary:
      "Sends the same message to two or more models and shows their answers side by side.",
    details: [
      "Each answer is kept as its own response version, and you can continue the chat from whichever one you prefer.",
    ],
    related: ["concept.model", "concept.prompt-coach"],
    audience: "everyone",
  },
  "concept.tool-approval": {
    title: "Tool approval",
    summary:
      "Some tool actions, such as searching the web or writing a file, wait for you to approve or deny them before they run.",
    details: [
      "Check what the assistant wants to do before approving. If you deny an action, or don't answer in time, it doesn't run and the assistant is told it was rejected.",
    ],
    related: ["concept.main-agent"],
    audience: "everyone",
  },
  "concept.citation": {
    title: "Sources",
    summary:
      "When the assistant uses your files, it lists the passages it relied on so you can check them yourself.",
    details: [
      "Open a source to read the passage in its file. Checking sources is a good habit: the assistant can misread or overstate what a file says.",
    ],
    related: ["concept.file-scope", "concept.attachment"],
    audience: "everyone",
  },
  "composer.controls": {
    title: "Chat controls",
    summary:
      "The buttons around the message box change what you send and how the assistant answers. Pick one below to learn more.",
    details: [
      "Paperclip: attach files, or see which files this chat can use.",
      "Template and prompt review: build a clearer prompt from a form, or get feedback on your draft before sending.",
      "Model and Compare: choose the AI model, or send the same message to several models at once.",
      "Persona: choose which description of you the assistant should keep in mind.",
      "Learning mode: choose between direct answers and modes that help you work it out yourself.",
      "Type / in the message box to add a skill.",
    ],
    related: [
      "concept.attachment",
      "concept.file-scope",
      "concept.template",
      "concept.prompt-coach",
      "concept.model",
      "concept.comparison",
      "concept.persona",
      "concept.learning-mode",
      "concept.skill",
      "concept.mode-lock",
    ],
    audience: "everyone",
  },
  "settings.max-steps": {
    title: "Maximum steps",
    summary:
      "The most steps the agent may take for one reply. A step is one round of thinking, such as calling a tool and reading its result.",
    details: [
      "A higher limit lets the agent work through longer tasks; a lower one keeps replies quick and predictable.",
    ],
    related: ["concept.main-agent"],
    audience: "everyone",
  },
  "admin.providers": {
    title: "Providers",
    summary:
      "Connections to the services that run AI models. Models from enabled providers can be chosen in chats.",
    details: [
      "Disabling a model keeps any sub-agents that use it, but marks them unavailable. Asterism never swaps in a different model automatically.",
    ],
    related: ["concept.model"],
    audience: "admin",
  },
  "admin.tools": {
    title: "Tool policy",
    summary:
      "Controls which tools can be used at all. A user's main agent still needs each tool assigned to it.",
    details: [
      "Both the tool policy and the agent's own settings must allow a tool before it can run.",
    ],
    related: ["concept.tool-approval", "concept.main-agent"],
    audience: "admin",
  },
  "admin.skills-policy": {
    title: "Skills policy",
    summary:
      "Turns skills on or off for everyone. Skills are off until an administrator enables them.",
    details: [
      "When skills are on, users can still only use skills they've assigned to their main agent. Skills add instructions only and never grant tools or files.",
    ],
    related: ["concept.skill"],
    audience: "admin",
  },
};

export function isVisibleTo(
  entry: { audience: HelpAudience },
  isAdmin: boolean,
): boolean {
  return entry.audience === "everyone" || isAdmin;
}
