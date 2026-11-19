// The user-guide screenshot pipeline: scripted model replies and the shot list (US-89.1).
import assert from "node:assert/strict";
import { test } from "node:test";
import { chats, modeChats } from "../scripts/screenshots/demo-content.mjs";
import {
  comfy,
  COMFY_CHECKPOINT,
  fillCitations,
  findChat,
  passagesFrom,
  respond,
  startDemoProvider,
} from "../scripts/screenshots/demo-provider.mjs";
import { shots, validateShots } from "../scripts/screenshots/shots.mjs";

const searchTool = {
  type: "function",
  function: { name: "search_knowledge", parameters: {} },
};

test("chat turns are matched by the user's message, case-insensitively", () => {
  assert.equal(
    findChat("Can you EXPLAIN THE CALVIN CYCLE?").title,
    "The Calvin cycle",
  );
  assert.equal(findChat("Something unscripted"), null);
  assert.match(
    respond({ messages: [{ role: "user", content: "Something unscripted" }] })
      .content,
    /tell me a little more/,
  );
});

test("a sourced answer searches first, then cites the passages the tool returned", () => {
  const user = {
    role: "user",
    content: "What happens in the light-dependent reactions?",
  };
  const first = respond({ messages: [user], tools: [searchTool] });
  assert.equal(first.toolCall.name, "search_knowledge");

  const tool = {
    role: "tool",
    content: JSON.stringify({
      results: [
        { cite: "asterism-cite:0123456789ab", excerpt: "thylakoid membranes" },
      ],
    }),
  };
  const second = respond({
    messages: [user, { role: "assistant", tool_calls: [] }, tool],
    tools: [searchTool],
  });
  assert.match(
    second.content,
    /\[take place in the thylakoid membranes\]\(asterism-cite:0123456789ab\)/,
  );

  // Without the tool (no project files), it answers straight away and drops the links.
  const plain = respond({ messages: [user] });
  assert.equal(plain.toolCall, undefined);
  assert.doesNotMatch(plain.content, /\{cite:|asterism-cite/);
});

test("each claim cites the passage that shares the most words with it", () => {
  const passages = passagesFrom(
    JSON.stringify({
      results: [
        {
          cite: "asterism-cite:aaaaaaaaaaaa",
          excerpt: "A chloroplast is surrounded by two membranes.",
        },
        {
          cite: "asterism-cite:bbbbbbbbbbbb",
          excerpt: "Splitting water releases oxygen as a by-product.",
        },
        { cite: "asterism-cite:bbbbbbbbbbbb", excerpt: "duplicate" },
      ],
    }),
  );
  assert.deepEqual(
    passages.map((passage) => passage.key),
    ["asterism-cite:aaaaaaaaaaaa", "asterism-cite:bbbbbbbbbbbb"],
  );
  assert.equal(
    fillCitations("[releases oxygen]({cite:1})", passages),
    "[releases oxygen](asterism-cite:bbbbbbbbbbbb)",
  );
  // No overlap: the Nth passage, then the first.
  assert.equal(
    fillCitations("[zzzz]({cite:2})", passages),
    "[zzzz](asterism-cite:bbbbbbbbbbbb)",
  );
  assert.equal(
    fillCitations("[zzzz]({cite:9})", passages),
    "[zzzz](asterism-cite:aaaaaaaaaaaa)",
  );
  assert.equal(fillCitations("[a]({cite:1}) b", []), "a b");
  assert.deepEqual(passagesFrom("not json asterism-cite:cccccccccccc"), [
    { key: "asterism-cite:cccccccccccc", text: "" },
  ]);
});

test("titles and study generators get the replies their parsers expect", () => {
  const title = respond({
    messages: [
      {
        role: "system",
        content: "You are a title generation assistant. Your ONLY task…",
      },
      {
        role: "user",
        content:
          "<message>\nCan you explain how photosynthesis works?\n</message>\nTitle:",
      },
    ],
  });
  assert.equal(title.content, "Photosynthesis for Friday's test");

  const system = (prompt) => ({ role: "system", content: `${prompt}…` });
  // Cards and questions come from the file in the request, up to its count.
  const handout =
    "Write up to 2 flashcards from these excerpts.\n<sources>\nS1: stacks of thylakoids, called grana. The fluid around them is the stroma, where the Calvin cycle runs.\n</sources>";
  const cards = JSON.parse(
    respond({
      messages: [
        system("You write study flashcards"),
        { role: "user", content: handout },
      ],
    }).content,
  );
  assert.deepEqual(
    cards.cards.map((card) => card.front),
    [
      "Where do the light-dependent reactions take place?",
      "Where does the Calvin cycle take place?",
    ],
  );
  assert.ok(
    cards.cards.every(
      (card) => card.back && card.source === "S1" && !("from" in card),
    ),
  );
  const notFromThisFile = JSON.parse(
    respond({
      messages: [
        system("You write study flashcards"),
        { role: "user", content: "Write up to 5 flashcards: nothing matches" },
      ],
    }).content,
  );
  assert.deepEqual(notFromThisFile.cards, []);

  const quiz = JSON.parse(
    respond({
      messages: [
        system("You write practice quiz questions"),
        {
          role: "user",
          content:
            "Write up to 3 questions. S1: RuBisCO … whichever is in shortest supply … releases oxygen as a by-product",
        },
      ],
    }).content,
  );
  assert.equal(quiz.questions.length, 3);
  for (const question of quiz.questions.filter(
    (entry) => entry.type === "multiple_choice",
  )) {
    assert.ok(
      question.answer >= 0 && question.answer < question.options.length,
    );
  }

  const guide = JSON.parse(
    respond({
      messages: [
        system("You plan a learner's study days"),
        {
          role: "user",
          content:
            "Plan 3 day(s) from 2026-11-20 to the exam on 2026-11-22, about 30 minutes a day.",
        },
      ],
    }).content,
  );
  assert.deepEqual(
    guide.days.map((day) => day.date),
    ["2026-11-20", "2026-11-21", "2026-11-22"],
  );
});

test("the double streams scripted replies over HTTP", async () => {
  const provider = await startDemoProvider();
  try {
    const base = `http://127.0.0.1:${provider.port}/v1`;
    const listed = await (await fetch(`${base}/models`)).json();
    assert.deepEqual(
      listed.data.map((model) => model.id),
      ["Demo Tutor", "Demo Writer"],
    );
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      body: JSON.stringify({
        model: "Demo Tutor",
        stream: true,
        messages: [{ role: "user", content: chats[0].match }],
      }),
    });
    const body = await response.text();
    const text = body
      .split("\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)).choices[0]?.delta?.content ?? "")
      .join("");
    assert.equal(text, chats[0].answer);
    assert.ok(body.trimEnd().endsWith("data: [DONE]"));
  } finally {
    await provider.close();
  }
});

test("the shot list is valid, and validation catches mistakes", () => {
  assert.deepEqual(validateShots(shots), []);
  const problems = validateShots([
    { name: "Bad Name", alt: "", as: "student", path: () => "/", ready: [] },
    { name: "dup", alt: "x", as: "nobody", path: "/", ready: [] },
    {
      name: "dup",
      alt: "x",
      as: "student",
      path: () => "/",
      ready: "text",
      viewport: "tablet",
    },
  ]);
  for (const expected of [
    "kebab-case",
    "alt text",
    "unknown persona",
    "path must be",
    "duplicate",
    "ready must",
    "viewport",
  ]) {
    assert.ok(
      problems.some((problem) => problem.includes(expected)),
      `expected a problem mentioning ${expected}`,
    );
  }
});

test("a script's pace reaches the reply, and visitors need no account", () => {
  const slow = chats.find((script) => script.pace);
  assert.ok(slow, "one scripted reply streams slowly for the stop shot");
  const reply = respond({ messages: [{ role: "user", content: slow.match }] });
  assert.equal(reply.pace, slow.pace);
  assert.equal(
    respond({ messages: [{ role: "user", content: chats[0].match }] }).pace,
    undefined,
  );
  assert.deepEqual(
    validateShots([
      {
        name: "signed-out",
        alt: "The sign-in page",
        as: "visitor",
        path: () => "/sign-in",
        ready: [],
      },
    ]),
    [],
  );
});

test("each model can have its own answer, for comparing models", () => {
  const ask = (model) =>
    respond({
      model,
      messages: [{ role: "user", content: "What is chlorophyll?" }],
    }).content;
  assert.match(ask("Demo Tutor"), /green pigment/);
  assert.match(ask("Demo Writer"), /solar panel/);
});

test("a web page request calls web_fetch, then answers once it is denied", () => {
  const fetchTool = {
    type: "function",
    function: { name: "web_fetch", parameters: {} },
  };
  const user = {
    role: "user",
    content: "Can you read https://example.org/leaf-structure?",
  };
  const first = respond({ messages: [user], tools: [fetchTool] });
  assert.deepEqual(first.toolCall, {
    name: "web_fetch",
    arguments: { url: "https://example.org/leaf-structure" },
  });
  const denied = respond({
    messages: [
      user,
      { role: "assistant", tool_calls: [] },
      { role: "tool", content: "The user rejected this tool call." },
    ],
    tools: [fetchTool],
  });
  assert.match(denied.content, /wasn't able to read/);
});

test("Create image calls the image tool, and the reply shows the picture", () => {
  const user = { role: "user", content: "A plant cell" };
  const forced = respond({
    messages: [user],
    tool_choice: { type: "function", function: { name: "generate_image" } },
  });
  assert.deepEqual(forced.toolCall, {
    name: "generate_image",
    arguments: { prompt: "A plant cell" },
  });
  const embed = "![cell.png](asterism-file:abc)";
  const reply = respond({
    messages: [
      user,
      {
        role: "assistant",
        tool_calls: [{ function: { name: "generate_image" } }],
      },
      { role: "tool", content: JSON.stringify({ images: [{ embed }] }) },
    ],
  });
  assert.ok(reply.content.startsWith(embed));
});

test("the prompt coach and compaction get scripted replies", () => {
  const coach = respond({
    messages: [
      { role: "system", content: "You are a prompt-writing coach. ..." },
      { role: "user", content: "Explain osmosis" },
    ],
  });
  const review = JSON.parse(coach.content);
  assert.deepEqual(
    review.suggestions.map((item) => item.criterion),
    ["audience", "output_format"],
  );
  const summary = respond({
    messages: [
      {
        role: "system",
        content: "You compact the earlier part of a conversation ...",
      },
      { role: "user", content: "transcript" },
    ],
  });
  assert.match(summary.content, /revising unit 3/);
});

test("the stand-in ComfyUI server lists a checkpoint and returns the picture", () => {
  const jobs = new Set();
  const image = Buffer.from("png");
  assert.deepEqual(
    comfy("GET", "/object_info/CheckpointLoaderSimple", jobs, image)
      .CheckpointLoaderSimple.input.required.ckpt_name,
    [[COMFY_CHECKPOINT]],
  );
  const { prompt_id: id } = comfy("POST", "/prompt", jobs, image);
  const entry = comfy("GET", `/history/${id}`, jobs, image)[id];
  assert.equal(entry.status.completed, true);
  assert.equal(entry.outputs[9].images[0].type, "output");
  assert.equal(comfy("GET", "/view?filename=x.png", jobs, image), image);
  assert.deepEqual(comfy("GET", "/history/unknown", jobs, image), {});
  assert.equal(comfy("GET", "/ws", jobs, image), null);
});

test("image captions get a scripted description", () => {
  const caption = respond({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe this image accurately in a concise retrieval caption.",
          },
          { type: "image_url", image_url: { url: "data:image/png;base64," } },
        ],
      },
    ],
  });
  assert.match(caption.content, /diagram of a green leaf/);
});

test("Draft feedback quotes and the Spot the error quote match their text exactly", () => {
  const draft = findChat(modeChats.draftFeedback.user_prompt);
  const quotes = [...draft.answer.matchAll(/^> (.+)$/gm)].map((m) => m[1]);
  assert.equal(quotes.length, 5);
  // Matching ignores line breaks and runs of spaces, as the app's does.
  const fold = (text) => text.replace(/\s+/g, " ");
  for (const quote of quotes)
    assert.ok(
      fold(modeChats.draftFeedback.user_prompt).includes(fold(quote)),
      `the draft contains: ${quote}`,
    );

  const spot = findChat(modeChats.spotTheError.user_prompt);
  const [, block] = spot.answer.split("```asterism-exercise");
  const record = JSON.parse(block.replace(/```\s*$/, ""));
  assert.ok(spot.answer.split("```")[0].includes(record.quote));
});

test("a reflection draft gets the two answers the dialog expects", () => {
  const reply = respond({
    messages: [
      { role: "system", content: "You help a learner reflect at the end ..." },
      { role: "user", content: "transcript" },
    ],
  });
  const draft = JSON.parse(reply.content);
  assert.ok(draft.learned && draft.unclear);
});
