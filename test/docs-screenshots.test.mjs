// The user-guide screenshot pipeline: scripted model replies and the shot list (US-89.1).
import assert from "node:assert/strict";
import { test } from "node:test";
import { chats } from "../scripts/screenshots/demo-content.mjs";
import {
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
  const cards = JSON.parse(
    respond({
      messages: [
        system("You write study flashcards"),
        { role: "user", content: "x" },
      ],
    }).content,
  );
  assert.ok(
    cards.cards.length > 0 &&
      cards.cards.every(
        (card) => card.front && card.back && card.source === "S1",
      ),
  );

  const quiz = JSON.parse(
    respond({
      messages: [
        system("You write practice quiz questions"),
        { role: "user", content: "x" },
      ],
    }).content,
  );
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
