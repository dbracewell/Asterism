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

  async waitProcessed(file) {
    const started = Date.now();
    while (Date.now() - started < 600_000) {
      try {
        const status = await this.api(
          "file status",
          "GET",
          `/files/${encodeURIComponent(file.filename)}/knowledge`,
        );
        if (status.status === "ready") return;
        if (status.status === "failed")
          throw new Error(`${file.original_name} failed to process`);
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
 * `providerId` is the provider connected during first-run setup.
 * Returns the ids the shots navigate to.
 */
export async function seedDemo({ instance, renderFile, log = () => {} }) {
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
        supports_vision: false,
        vision_source: "manual",
        context_window: 128_000,
        context_window_source: "manual",
        pricing: { input_per_million: 0.5, output_per_million: 1.5 },
      },
    );
    models[model.name] = model.id;
  }
  const tutor = models[demo.MODELS.tutor] ?? Object.values(models)[0];
  await admin.api("canvas policy", "PUT", "/settings/app/canvas", {
    enabled: true,
  });
  await admin.api("skills policy", "PUT", "/settings/app/skills", {
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
    question_count: 4,
    kinds: ["multiple_choice", "short_answer"],
    title: "Photosynthesis check",
  });
  if (!quiz) throw new Error("The scripted model did not produce a quiz");
  for (const note of demo.notes)
    await maya.api("note", "POST", `${study}/notes`, note);

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

  return {
    models,
    project: project.id,
    chats: {
      general: general.info.id,
      sourced: sourced.info.id,
      branched: branched.info.id,
      lab: lab.info.id,
    },
    deck: deck.id,
    quiz: quiz.id,
    classroom: room.id,
    invite: invite.token,
    courseProject: courseProject.id,
    files: Object.fromEntries(
      Object.entries(uploaded).map(([name, file]) => [name, file.id]),
    ),
  };
}
