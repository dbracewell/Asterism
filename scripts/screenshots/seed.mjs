// Seeds the demo dataset through the public API, as the people themselves
// would (US-89.1). The administrator already exists: first-run setup is done in
// the browser so it can be photographed.
import {
  HttpError,
  Metrics,
  Session,
  newRequestId,
} from "../capacity/session.mjs";
import * as demo from "./demo-content.mjs";
import { COMFY_CHECKPOINT } from "./demo-provider.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class DemoSession extends Session {
  /** Upload one file with its own content type. */
  async uploadFile(name, type, data) {
    const token = await this.token();
    const form = new FormData();
    form.append("files", new Blob([data], { type }), name);
    const { files } = await this.json(`upload ${name}`, "/api/py/files/", {
      method: "POST",
      body: form,
      headers: { Authorization: `Bearer ${token}` },
    });
    return files[0];
  }

  async waitProcessed(file, expected = "ready") {
    const started = Date.now();
    while (Date.now() - started < 600_000) {
      try {
        const status = await this.api(
          "file status",
          "GET",
          `/files/${encodeURIComponent(file.filename)}/knowledge`,
        );
        if (status.status === expected) return;
        if (status.status === "failed")
          throw new Error(`${file.original_name} failed to process`);
        if (status.status === "ready" && expected !== "ready")
          throw new Error(`${file.original_name} was processed after all`);
      } catch (error) {
        if (!(error instanceof HttpError && [404, 429].includes(error.status)))
          throw error;
      }
      await sleep(2000);
    }
    throw new Error(`${file.original_name} was not processed in time`);
  }

  /** Run the waiting turn (or `command`, such as a regeneration) and wait until the reply is complete. */
  async runTurn(chatId, command = { type: "resume" }) {
    const socket = await this.openChat(chatId);
    try {
      // Connecting resumes any waiting turn; let that settle before another command.
      if (command.type !== "resume") await sleep(1000);
      const turn = socket.expectTurn(180_000);
      socket.send(command);
      const result = await turn;
      if (result.error) throw new Error(`chat ${chatId}: ${result.error}`);
    } finally {
      socket.close();
    }
    return this.api("chat read", "GET", `/chat/${chatId}`);
  }

  /** Send a follow-up message in an existing chat and wait for the reply. */
  async reply(chat, prompt) {
    await this.api("send", "POST", `/chat/${chat.info.id}/message`, {
      request_id: newRequestId(),
      user_prompt: prompt,
      parent_message_id: chat.messages.at(-1).id,
      expected_model_revision: chat.info.model_revision,
    });
    return this.runTurn(chat.info.id);
  }

  async newChat(body) {
    const { info } = await this.api("chat create", "POST", "/chat/", {
      request_id: newRequestId(),
      ...body,
    });
    return this.runTurn(info.id);
  }

  /** A second answer to the chat's latest turn, as a sibling branch, the way the Regenerate button makes it. */
  async regenerate(chat) {
    const parent = chat.messages.at(-1).parent_message_id;
    for (let attempt = 0; ; attempt += 1) {
      const result = await this.runTurn(chat.info.id, {
        type: "regenerate",
        parent_message_id: parent,
      }).catch((error) => error);
      if (!(result instanceof Error)) return result;
      if (attempt >= 5) throw result;
      await sleep(1000);
    }
  }
}

/**
 * Create everything the shot list needs. `instance` is from startInstance;
 * `modelUrl` is the scripted model's address as the container sees it, which
 * also serves the stand-in image generator.
 * Returns the ids the shots navigate to.
 */
export async function seedDemo({
  instance,
  renderFile,
  modelUrl,
  log = () => {},
}) {
  const metrics = new Metrics();
  const session = () =>
    new DemoSession({
      base: instance.base,
      publicUrl: instance.publicUrl,
      metrics,
    });

  async function signIn(person) {
    const browser = session();
    const result = await browser.signIn(person.email, demo.PASSWORD);
    if (!result.ok)
      throw new Error(`Could not sign in as ${person.email}: ${result.status}`);
    return browser;
  }

  async function signUp(person) {
    const browser = session();
    const query = new URLSearchParams({
      adminKey: instance.secrets.ADMIN_PASSPHRASE,
      role: "user",
    });
    const { user } = await browser.json(
      "sign-up",
      `/api/auth/sign-up/email?${query}`,
      {
        method: "POST",
        json: {
          name: person.name,
          email: person.email,
          password: demo.PASSWORD,
        },
      },
    );
    await browser.json("provision", "/api/py/users/", {
      method: "POST",
      json: { user_id: user.id, system_key: instance.secrets.SYSTEM_KEY },
    });
    return { browser, id: user.id };
  }

  // --- Administrator: models and policies ------------------------------------------
  log("Seeding: models and policies");
  const admin = await signIn(demo.people.admin);
  const { llm_providers: providers } = await admin.api(
    "providers",
    "GET",
    "/settings/app/providers",
  );
  const provider = providers[0];
  const catalog = await admin.api(
    "models",
    "GET",
    `/settings/app/providers/${provider.id}/models`,
  );
  const models = {};
  for (const model of catalog.models) {
    await admin.api(
      "model",
      "PUT",
      `/settings/app/providers/${provider.id}/models/${model.id}`,
      {
        is_active: true,
        supports_tools: true,
        tools_source: "manual",
        // Demo Writer reads pictures, so it can caption the student's images.
        supports_vision: model.name === demo.MODELS.writer,
        vision_source: "manual",
        context_window: 128_000,
        context_window_source: "manual",
        pricing: { input_per_million: 0.5, output_per_million: 1.5 },
      },
    );
    models[model.name] = model.id;
  }
  const tutor = models[demo.MODELS.tutor] ?? Object.values(models)[0];
  // Captions for uploaded images, written by the picture-reading model.
  await admin.api("captioning", "PUT", "/settings/app/captioning", {
    mode: "provider",
    provider_model_id: models[demo.MODELS.writer],
  });
  await admin.api("canvas policy", "PUT", "/settings/app/canvas", {
    enabled: true,
  });
  await admin.api("skills policy", "PUT", "/settings/app/skills", {
    enabled: true,
  });
  // People may connect their own ChatGPT plan (the connection itself isn't made).
  await admin.api(
    "chatgpt policy",
    "PUT",
    "/settings/app/chatgpt_plan_enabled",
    {
      value: true,
    },
  );
  // Reading a web page, which waits for the reader's approval in chat.
  const tools = await admin.api("tools", "GET", "/settings/app/tools");
  await admin.api("tools", "PUT", "/settings/app/tools", {
    ...tools,
    active_tools: [...new Set([...tools.active_tools, "web_fetch"])],
  });
  // Image generation through the scripted model's stand-in ComfyUI server.
  await admin.api(
    "image generator",
    "PUT",
    "/settings/app/image_generator_provider",
    {
      value: {
        name: "ComfyUI",
        parameters: {
          base_url: `${modelUrl.replace(/\/v1$/, "")}/comfy`,
          checkpoint: COMFY_CHECKPOINT,
        },
      },
    },
  );
  await admin.api("image policy", "PUT", "/settings/app/image-generation", {
    enabled: true,
  });

  // --- People and groups -------------------------------------------------------------
  log("Seeding: people and groups");
  const educator = await signUp(demo.people.educator);
  const student = await signUp(demo.people.student);
  const classmate = await signUp(demo.people.classmate);
  const groups = await admin.api("groups", "GET", "/groups");
  const educators = groups.find(
    (group) => group.name.toLowerCase() === "educator",
  );
  await admin.api("group member", "PUT", `/groups/members/${educator.id}`, {
    group_id: educators.id,
  });
  // Fresh tokens carry the new group.
  const teacher = await signIn(demo.people.educator);
  const maya = student.browser;

  for (const browser of [admin, teacher, maya, classmate.browser]) {
    // Leo keeps the first-chat tour offer, as a new person sees it.
    if (browser !== classmate.browser)
      await browser.api("tour", "PUT", "/settings/user/first_chat_tour", {
        value: "dismissed",
      });
    await browser.api("canvas", "PUT", "/settings/user/canvas_enabled", {
      value: true,
    });
    // With two models, only the administrator's setup chose a default; the others choose one in settings.
    await browser.api(
      "default model",
      "PUT",
      "/settings/user/default_model_id",
      { value: tutor },
    );
  }

  // --- The student's files and project -----------------------------------------------
  log("Seeding: files and a project");
  const uploaded = {};
  for (const file of demo.files) {
    const data = file.html ? await renderFile(file) : file.text;
    uploaded[file.name] = await maya.uploadFile(file.name, file.type, data);
  }
  for (const file of Object.values(uploaded)) await maya.waitProcessed(file);
  const broken = await maya.uploadFile(
    demo.brokenFile.name,
    demo.brokenFile.type,
    demo.brokenFile.text,
  );
  await maya.waitProcessed(broken, "failed");

  const project = await maya.api("project", "POST", "/projects/", {
    name: demo.project.name,
    description: demo.project.description,
    goal: demo.project.goal,
    accent: "green",
    areas: { study: true, reflections: true, goal: true, sub_agents: true },
    file_ids: demo.project.files.map((name) => uploaded[name].id),
  });
  const checker = await maya.api("sub-agent", "POST", "/agents/sub-agents", {
    ...demo.subAgent,
    model_id: tutor,
  });
  await maya.api(
    "project sub-agents",
    "POST",
    `/projects/${project.id}/sub-agents`,
    {
      expected_context_revision: project.context_revision,
      agent_ids: [checker.id],
    },
  );

  // --- About you ----------------------------------------------------------------------
  const about = await maya.api("about", "GET", "/users/me/about");
  await maya.api("about", "PUT", "/users/me/about", {
    about_md: demo.aboutYou,
    expected_revision: about.revision,
  });

  // --- The student's agent: a skill, web pages and the prompt coach ------------------
  await maya.api("prompt coach", "PUT", "/settings/user/prompt_coach_enabled", {
    value: true,
  });
  const labPartner = await maya.api("skill", "POST", "/skills/", {
    content: demo.skill,
  });
  const assigned = await maya.api(
    "skills",
    "GET",
    "/settings/user/main-agent/skills",
  );
  await maya.api("skills", "PUT", "/settings/user/main-agent/skills", {
    skill_ids: [labPartner.id],
    expected_revision: assigned.revision,
  });
  const mainAgent = await maya.api(
    "main agent",
    "GET",
    "/settings/user/main-agent",
  );
  await maya.api("main agent", "PUT", "/settings/user/main-agent", {
    system_prompt: mainAgent.system_prompt,
    max_steps: mainAgent.max_steps,
    chat_parameters: mainAgent.chat_parameters,
    tools: [...new Set([...mainAgent.tools, "web_fetch"])],
  });

  // --- Chats ---------------------------------------------------------------------------
  log("Seeding: chats");
  const general = await maya.newChat({
    model_id: tutor,
    learning_mode: "tutor",
    user_prompt:
      "Can you explain how photosynthesis works? I have a biology test on Friday.",
  });
  const sourced = await maya.newChat({
    model_id: tutor,
    project_id: project.id,
    user_prompt: "What happens in the light-dependent reactions?",
  });
  // Regenerating the answer makes a second branch from the same question. A
  // General chat, so the turn has no search step and the switcher shows.
  const branched = await maya.regenerate(
    await maya.newChat({
      model_id: tutor,
      user_prompt: "Can you explain the Calvin cycle?",
    }),
  );
  const lab = await maya.newChat({
    model_id: tutor,
    project_id: project.id,
    user_prompt: "Can you help me write an outline for my lab report?",
  });
  await maya.api("canvas", "POST", `/chat/${lab.info.id}/canvas`, demo.canvas);
  // One example chat for each learning mode that has its own way of answering.
  const modeChats = {};
  for (const [key, body] of Object.entries(demo.modeChats))
    modeChats[key] = (await maya.newChat({ model_id: tutor, ...body })).info.id;
  await maya.api("reflection", "POST", "/reflections/", {
    chat_id: general.info.id,
    ...demo.reflection,
  });
  // Four turns, one more than compaction keeps in full, so it can be compacted.
  const [opening, ...followUps] = demo.revisionTurns;
  let revision = await maya.newChat({ model_id: tutor, user_prompt: opening });
  for (const prompt of followUps) revision = await maya.reply(revision, prompt);

  // --- Study -------------------------------------------------------------------------
  log("Seeding: study material");
  const study = `/projects/${project.id}/study`;
  const deck = await maya.api("deck", "POST", `${study}/decks`, {
    name: demo.deck.name,
    description: demo.deck.description,
  });
  for (const card of demo.deck.cards)
    await maya.api("card", "POST", `${study}/decks/${deck.id}/cards`, card);
  const queue = await maya.api(
    "review queue",
    "GET",
    `${study}/decks/${deck.id}/review?limit=3`,
  );
  for (const [index, card] of queue.items.entries()) {
    await maya.api(
      "review",
      "POST",
      `${study}/decks/${deck.id}/cards/${card.id}/reviews`,
      {
        rating: index === 0 ? "again" : "good",
        expected_reps: card.reps ?? 0,
      },
    );
  }
  const { quiz } = await maya.api("quiz", "POST", `${study}/quizzes`, {
    model_id: tutor,
    question_count: 6,
    kinds: ["multiple_choice", "short_answer"],
    title: "Photosynthesis check",
  });
  if (!quiz) throw new Error("The scripted model did not produce a quiz");
  for (const note of demo.notes)
    await maya.api("note", "POST", `${study}/notes`, note);
  // Topics and one attempt with a miss and a half-right answer, so Progress
  // has levels, items that need practice, and an unclear item from a reflection.
  await maya.api("deck topics", "PATCH", `${study}/decks/${deck.id}`, {
    tags: demo.studyTopics.deck,
  });
  await maya.api("quiz topics", "PATCH", `${study}/quizzes/${quiz.id}`, {
    tags: demo.studyTopics.quiz,
  });
  const attempt = await maya.api(
    "quiz attempt",
    "POST",
    `${study}/quizzes/${quiz.id}/attempts`,
    {
      model_id: tutor,
      answers: quiz.questions.map((question) => {
        const answer = demo.quizAttempt[question.prompt] ?? {};
        return answer.text
          ? { question_id: question.id, text: answer.text }
          : question.options.includes(answer.option)
            ? {
                question_id: question.id,
                choice: question.options.indexOf(answer.option),
              }
            : { question_id: question.id };
      }),
    },
  );
  await maya.api("project reflection", "POST", "/reflections/", {
    chat_id: sourced.info.id,
    ...demo.projectReflection,
  });

  // --- The educator's class ------------------------------------------------------------
  log("Seeding: a class with a course");
  const handout = await teacher.uploadFile(
    demo.courseFile.name,
    demo.courseFile.type,
    demo.courseFile.text,
  );
  await teacher.waitProcessed(handout);
  const courseProject = await teacher.api(
    "course project",
    "POST",
    "/projects/",
    {
      name: demo.classroom.course.name,
      description: demo.classroom.course.description,
      accent: "teal",
      file_ids: [handout.id],
    },
  );
  const room = await teacher.api("class", "POST", "/classes", {
    name: demo.classroom.name,
    description: demo.classroom.description,
  });
  await teacher.api("publish course", "POST", `/classes/${room.id}/course`, {
    project_id: courseProject.id,
    note: "Unit 3 notes and practice.",
  });
  const {
    items: [invite],
  } = await teacher.api("invite", "POST", `/classes/${room.id}/invites`, {
    labels: [demo.classroom.invitee],
  });
  const { join_code: code } = await teacher.api(
    "join code",
    "POST",
    `/classes/${room.id}/join-code`,
  );
  await teacher.api(
    "mode policy",
    "PUT",
    `/classes/${room.id}/mode-policy`,
    demo.classModePolicy,
  );
  for (const browser of [maya, classmate.browser]) {
    await browser.api("join", "POST", "/classes/join", { code });
    const course = await browser.api(
      "course",
      "GET",
      `/classes/joined/${room.id}/course`,
    );
    if (course) {
      await browser.api(
        "accept course",
        "POST",
        `/classes/joined/${room.id}/course`,
        {
          version_number: course.version_number,
        },
      );
    }
    await browser.api(
      "insights consent",
      "PUT",
      `/classes/joined/${room.id}/insights-consent`,
      { consent: true },
    );
  }

  // Version 2 adds practice questions, so students see an update to take.
  const practice = await teacher.uploadFile(
    demo.courseUpdate.file.name,
    demo.courseUpdate.file.type,
    demo.courseUpdate.file.text,
  );
  await teacher.waitProcessed(practice);
  const coursePage = await teacher.api(
    "course project",
    "GET",
    `/projects/${courseProject.id}`,
  );
  await teacher.api(
    "course file",
    "POST",
    `/projects/${courseProject.id}/files`,
    {
      expected_context_revision: coursePage.context_revision,
      file_ids: [practice.id],
    },
  );
  await teacher.api("publish course", "POST", `/classes/${room.id}/course`, {
    project_id: courseProject.id,
    note: demo.courseUpdate.note,
  });

  // Maya's own copy of the course, a project in her sidebar.
  const mayaProjects = await maya.api("projects", "GET", "/projects/");
  const courseCopy = (
    mayaProjects.items ??
    mayaProjects.projects ??
    mayaProjects
  ).find((item) => item.name === demo.classroom.name);
  if (!courseCopy) throw new Error("the course copy was not found");
  const courseChat = await maya.newChat({
    model_id: tutor,
    project_id: courseCopy.id,
    learning_mode: "tutor",
    user_prompt: "What should I focus on for unit 3?",
  });

  return {
    models,
    modeChats,
    courseCopy: courseCopy.id,
    courseChat: courseChat.info.id,
    project: project.id,
    chats: {
      general: general.info.id,
      sourced: sourced.info.id,
      branched: branched.info.id,
      lab: lab.info.id,
      revision: revision.info.id,
    },
    deck: deck.id,
    quiz: quiz.id,
    attempt: attempt.id,
    classroom: room.id,
    invite: invite.token,
    courseProject: courseProject.id,
    files: Object.fromEntries(
      Object.entries(uploaded).map(([name, file]) => [name, file.id]),
    ),
  };
}
