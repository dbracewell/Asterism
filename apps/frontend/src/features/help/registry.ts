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
  | "concept.mode-draft-feedback"
  | "concept.mode-research"
  | "concept.rubric"
  | "concept.ai-use-log"
  | "concept.reflection"
  | "concept.topic-mastery"
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
  | "concept.flashcard"
  | "concept.quiz"
  | "concept.weak-spot"
  | "concept.study-note"
  | "concept.class"
  | "concept.educator"
  | "concept.course"
  | "concept.class-code"
  | "concept.class-invite"
  | "concept.class-mode-policy"
  | "concept.class-insights"
  | "concept.team-pack"
  | "composer.controls"
  | "settings.max-steps"
  | "admin.providers"
  | "admin.tools"
  | "admin.skills-policy"
  | "admin.settings-file";

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
      "A project's page has tabs for Overview, Chats, Files, Study, Reflections, Sub-agents and Settings. In Settings you can hide the optional areas you don't use; hidden areas keep their data.",
      "In the Sub-agents tab you choose which of your sub-agents its chats may use. New projects start with none selected.",
      "Export team pack in a project's Settings tab shares its setup as a file. Import team pack on the Projects page shows everything a pack asks for before anything is created.",
      "You can also set a learning goal and a target date. The goal shows on the project's Overview, and a chat only sees it when you turn on Goal in the message box for a message.",
    ],
    related: [
      "concept.file-scope",
      "concept.sub-agent",
      "concept.general-chat",
      "concept.team-pack",
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
      "Sub-agents only work in projects that select them in their Sub-agents tab, and only when the chat's model supports tools.",
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
      "In a class's course project, your educator may limit which modes you can use. The message box shows the limits.",
    ],
    related: [
      "concept.mode-standard",
      "concept.mode-tutor",
      "concept.mode-explain-back",
      "concept.mode-review",
      "concept.mode-draft-feedback",
      "concept.mode-research",
      "concept.mode-lock",
      "concept.class-mode-policy",
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
  "concept.mode-draft-feedback": {
    title: "Draft feedback mode",
    summary:
      "Get feedback on your own writing against a rubric: an estimated level for each criterion, with quotes from your draft. Your draft is not rewritten.",
    details: [
      "Choose a rubric with the Rubric control next to the mode, then paste your draft or attach it as a file. The rubric stays selected for your next messages.",
      "Levels are the assistant's estimate, not a grade. If you want to see how one passage could read, ask for an example rewrite of that one passage.",
      "Use Review draft with comments to see your draft with each comment pinned to the passage it quotes. Mark comments resolved as you revise. Comments whose quote doesn't match your draft are listed separately.",
    ],
    related: ["concept.rubric", "concept.attachment", "concept.learning-mode"],
    audience: "everyone",
  },
  "concept.mode-research": {
    title: "Research assistant mode",
    summary:
      "Get help finding and judging sources and planning your structure. The assistant suggests search angles, evaluates sources and builds outlines, but writes no paragraphs for you.",
    details: [
      "Ask where to look, paste a source to check its credibility, relevance and bias, or share your sources and ask for an outline that labels which source supports each point.",
      "The assistant only searches if your agent has a search tool that's turned on. Otherwise it suggests searches you can run and works with the sources you share. Always check a source yourself before you rely on it.",
    ],
    related: ["concept.learning-mode", "concept.citation"],
    audience: "everyone",
  },
  "concept.topic-mastery": {
    title: "Topic mastery",
    summary:
      "How well you know each topic, from your latest review rating or quiz answer on each card and question tagged with it.",
    details: [
      "Add topics to a deck or quiz when you create or edit it. The project's Study tab then shows each topic's level (Not started, Needs work, Developing or Mastered), how many items you've practiced, and how it changed over the last 8 weeks.",
      "Mastered needs at least 80% and at least 80% of the topic's items practiced. Practice builds a quiz from the topic's weakest and unpracticed items. Mastery comes only from your study results, never from chats.",
    ],
    related: ["concept.flashcard", "concept.quiz", "concept.weak-spot"],
    audience: "everyone",
  },
  "concept.reflection": {
    title: "Reflection",
    summary:
      "A short note at the end of a session about what you learned and what's still unclear. They're listed in the project's Reflections tab, or on the General page for General chats.",
    details: [
      "Choose Reflect on this session in a chat's menu. Suggest a draft fills both answers from the chat; edit it so it says what you think before saving.",
      "Reflections are yours only. Each is filed under the chat's project and persona, and the assistant doesn't read them automatically.",
      "In a project, Practice unclear items turns what's still unclear into flashcards, one at a time. You write each answer and confirm each card, and it can also appear in your weak spots until you recall it.",
    ],
    related: ["concept.project", "concept.persona", "concept.weak-spot"],
    audience: "everyone",
  },
  "concept.ai-use-log": {
    title: "AI-use log",
    summary:
      "A record you can share with a teacher of how you used AI: your prompts, modes, models, templates, files and verification results, with times.",
    details: [
      "Open it from a chat's actions menu or with Export AI-use log on a project's page. Choose the chats, untick any prompts you want to leave out, then download Markdown or save a PDF.",
      "The log only documents what Asterism recorded. It can't detect AI use, and it doesn't include the assistant's answers. Spot-the-error answers are labelled as exercises.",
    ],
    related: ["concept.learning-mode", "concept.template"],
    audience: "everyone",
  },
  "concept.rubric": {
    title: "Rubric",
    summary:
      "A rubric lists the criteria your work is assessed on and what each performance level looks like.",
    details: [
      "Asterism includes a few general rubrics. To use your assignment's own rubric, duplicate one or create a rubric in User Settings → Rubrics.",
      "Each message records a copy of the rubric it was sent with, so later edits don't change earlier feedback. Rubric text only describes the assessment; it grants no tools or file access.",
    ],
    related: ["concept.mode-draft-feedback", "concept.template"],
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
      "In a class's course project, your educator may turn answer reveals off.",
    ],
    related: [
      "concept.hint-levels",
      "concept.mode-lock",
      "concept.class-mode-policy",
    ],
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
      "Check what the assistant wants to do before approving. If you deny an action, or don't answer within a minute, it doesn't run and the assistant is told it was rejected.",
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
  "concept.flashcard": {
    title: "Flashcards and decks",
    summary:
      "A flashcard has a question on the front and the answer on the back. A deck groups a project's cards, and cards come back for review when they're due.",
    details: [
      "In a review you recall the answer, show it, then rate how it went: Again, Hard, Good or Easy. Your rating decides when the card is due next, so cards you know well come back less often.",
      "Write cards yourself, or use Draft from files to have a model suggest cards from the project's files. Nothing is saved until you accept a draft.",
      "Tag a deck with topics to follow your progress under Topic mastery.",
    ],
    related: ["concept.weak-spot", "concept.topic-mastery", "concept.quiz"],
    audience: "everyone",
  },
  "concept.quiz": {
    title: "Practice quizzes and attempts",
    summary:
      "A quiz is a saved set of questions generated from a project's files. Each time you take it is an attempt, with its own score and feedback.",
    details: [
      "Questions are multiple choice or short answer, and each cites the file it came from. Multiple-choice answers are marked exactly. A model grades short answers against each question's rubric: a partly correct answer earns half a point, and one it couldn't grade earns none.",
      "The quiz page shows your best and last scores. Retake a quiz as often as you like; every attempt is kept.",
      "Practice quizzes are for your own practice. Scores are only shared with an educator as class totals, and only if you choose to share.",
    ],
    related: [
      "concept.weak-spot",
      "concept.topic-mastery",
      "concept.flashcard",
      "concept.class-insights",
    ],
    audience: "everyone",
  },
  "concept.weak-spot": {
    title: "Weak spots",
    summary:
      "Quiz questions you missed or got partly right, and cards you rated Again. They're listed on the Study tab, most recent first.",
    details: [
      "Practice weak spots builds a quiz of up to 10 of them. Answering an item correctly there, in another quiz or in a review clears it.",
      "Cards made from a reflection's unclear points also count until you recall them.",
    ],
    related: [
      "concept.quiz",
      "concept.flashcard",
      "concept.reflection",
      "concept.topic-mastery",
    ],
    audience: "everyone",
  },
  "concept.study-note": {
    title: "Study notes",
    summary:
      "Saved summaries of a project's files, and day-by-day study plans for an exam. Both are drafted by a model and only saved when you choose Save as note.",
    details: [
      "Summarize files writes a summary at the depth you choose, with each section citing its sources. Plan for an exam lays out each day up to your exam, linked to the project's decks and quizzes; the model sees their names and your scores, not your files.",
      "A note is Markdown you can edit or delete at any time. Check a draft against its sources before you rely on it.",
    ],
    related: ["concept.citation", "concept.flashcard", "concept.quiz"],
    audience: "everyone",
  },
  "concept.class": {
    title: "Class",
    summary:
      "A group of students run by an educator. Students join with a class code or an invite link, and can add the class's course as a project.",
    details: [
      "Your educator sees your name and whether you've joined. They never see your chats, files or answers.",
      "You can leave a class from the Classes page. Leaving doesn't delete your course project or your chats.",
    ],
    related: [
      "concept.class-code",
      "concept.course",
      "concept.educator",
      "concept.class-insights",
    ],
    audience: "everyone",
  },
  "concept.educator": {
    title: "Educator",
    summary:
      "Someone who may create and run classes. Ask for educator access on the Classes page; an administrator approves it.",
    details: [
      "Asking sends your name and email to your administrator. Educators are not administrators and get no extra access to other people's chats or files.",
      "If educator access is revoked, the educator can no longer manage their classes, and students stay in them.",
    ],
    related: ["concept.class", "concept.course", "concept.class-mode-policy"],
    audience: "everyone",
  },
  "concept.course": {
    title: "Course",
    summary:
      "A project an educator publishes to a class. Each student who adds it gets their own copy of its instructions, selected sub-agents and files.",
    details: [
      "Educators publish numbered versions with a short note. Students see what changed and choose when to update. Updating replaces the course's instructions, sub-agents and files with the new version, and keeps the student's chats.",
      "The educator's own chats and goal date are never published, and the educator can't see students' course chats.",
      "If a course needs a model you can't use, adding it is blocked until your educator or an administrator fixes it.",
    ],
    related: [
      "concept.class",
      "concept.project",
      "concept.sub-agent",
      "concept.class-mode-policy",
    ],
    audience: "everyone",
  },
  "concept.class-code": {
    title: "Class code",
    summary:
      "A short code students with an account enter on the Classes page to join a class. The educator's join link fills it in.",
    details: [
      "Replace code stops the old code and links working. Students who already joined stay in the class.",
      "Students without an account need an invite link instead.",
    ],
    related: ["concept.class", "concept.class-invite"],
    audience: "everyone",
  },
  "concept.class-invite": {
    title: "Invite links",
    summary:
      "Links an educator creates for new students. Each one creates one account and joins the class.",
    details: [
      "Each link works once and expires after 14 days. Copy the links when they're made: they aren't shown again.",
      "Students who already have an account join with the class code instead.",
    ],
    related: ["concept.class-code", "concept.class"],
    audience: "everyone",
  },
  "concept.class-mode-policy": {
    title: "Learning mode policy",
    summary:
      "An educator's limits on which learning modes students may use in the course project, and whether they can reveal answers.",
    details: [
      "The policy can only limit. It never adds tools, files or modes, and students' other chats are unaffected.",
      "Students see the limits and that their educator set them. A change applies from the next message.",
    ],
    related: [
      "concept.learning-mode",
      "concept.answer-reveal",
      "concept.course",
    ],
    audience: "everyone",
  },
  "concept.class-insights": {
    title: "Class insights",
    summary:
      "Totals that show an educator which course files the class finds hard. Sharing is off until each student turns it on.",
    details: [
      "Only flashcard and quiz results from students who chose to share count, grouped by the course file the practice came from. Nothing shows until at least five students share, and a file shows only once five of them have practiced it.",
      "Educators never see chats, answers or any one student's results. Students can stop sharing at any time on the Classes page.",
    ],
    related: ["concept.class", "concept.quiz", "concept.flashcard"],
    audience: "everyone",
  },
  "concept.team-pack": {
    title: "Team pack",
    summary:
      "A file that shares a setup: sub-agents, skills, templates, rubrics and project settings. It never holds files, keys or provider details.",
    details: [
      "Export team pack is in a project's Settings tab. Models are saved as requirements, and instructions are included as written, so read them before you share.",
      "Import team pack on the Projects page shows everything a pack asks for first. You choose what to include and a model for each sub-agent, approve each tool, and nothing is created until you confirm. Starter packs go through the same review.",
      "A pack's instructions shape how your agents behave, but they can't grant tools: you approve those yourself.",
    ],
    related: [
      "concept.sub-agent",
      "concept.skill",
      "concept.template",
      "concept.rubric",
    ],
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
  "admin.settings-file": {
    title: "Settings file",
    summary:
      "One file that moves every application setting between installations: providers, models, tools and policies. Users, chats and files are not included.",
    details: [
      "API keys in the file are encrypted with the passphrase you choose when exporting. Without it the file can't be opened, and nobody can recover it.",
      "Importing shows what will change before anything is applied. Providers are added, or updated when the name matches; settings in the file replace current values; nothing is removed.",
    ],
    related: ["admin.providers", "admin.tools"],
    audience: "admin",
  },
};

export function isVisibleTo(
  entry: { audience: HelpAudience },
  isAdmin: boolean,
): boolean {
  return entry.audience === "everyone" || isAdmin;
}
