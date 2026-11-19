// A scripted OpenAI-compatible model for the user-guide screenshots (US-89.1).
//
// Every reply is fixed, so the screenshots show realistic answers and reruns
// produce the same text:
//
// - Chat turns are matched by the latest user message against `chats` in
//   demo-content.mjs. A script with `search` first calls `search_knowledge`,
//   then answers and cites the passages the tool returned.
// - Study generation (flashcards, quizzes, summaries, study guides) and chat
//   titles are recognized by their system prompts and get valid JSON or text.
// - Anything else gets a short, neutral answer.
import { createServer } from "node:http";
import { chats, DEFAULT_REPLY, study } from "./demo-content.mjs";

const CITE = /asterism-cite:[0-9a-f]{12}/g;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function text(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((part) => part?.text ?? "").join("");
  return "";
}

/** The messages after the latest user message: this turn's tool calls and results so far. */
function currentTurn(messages) {
  const index = messages.findLastIndex((message) => message.role === "user");
  return {
    user: index >= 0 ? text(messages[index].content) : "",
    after: messages.slice(index + 1),
  };
}

/** The script whose `match` appears in the user's message, if any. */
export function findChat(prompt, scripts = chats) {
  const lower = prompt.toLowerCase();
  return (
    scripts.find((script) => lower.includes(script.match.toLowerCase())) ?? null
  );
}

/**
 * The passages a tool result offers for citing: each object that holds a
 * citation key, with the text of its other fields. Falls back to bare keys
 * when the result is not JSON.
 */
export function passagesFrom(content) {
  const passages = [];
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    const strings = Object.values(value).filter(
      (field) => typeof field === "string",
    );
    const key = strings.map((field) => field.match(CITE)?.[0]).find(Boolean);
    if (key) passages.push({ key, text: strings.join(" ") });
    Object.values(value).forEach(walk);
  };
  try {
    walk(JSON.parse(content));
  } catch {
    for (const key of content.match(CITE) ?? [])
      passages.push({ key, text: "" });
  }
  return passages.filter(
    (passage, index) =>
      passages.findIndex((other) => other.key === passage.key) === index,
  );
}

const words = (value) =>
  new Set(value.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);

/**
 * Replace each `[claim]({cite:N})` with a citation of the passage that shares
 * the most words with the claim (the Nth passage on a tie); drop the link when
 * the tools returned nothing to cite.
 */
export function fillCitations(answer, passages) {
  return answer.replace(
    /\[([^\]]+)\]\(\{cite:(\d+)\}\)/g,
    (_, claim, number) => {
      if (!passages.length) return claim;
      const wanted = words(claim);
      const score = (passage) =>
        [...words(passage.text)].filter((word) => wanted.has(word)).length;
      let best = passages[Number(number) - 1] ?? passages[0];
      for (const passage of passages)
        if (score(passage) > score(best)) best = passage;
      return `[${claim}](${best.key})`;
    },
  );
}

/**
 * Decide the reply to one request: `{ toolCall }` or `{ content }`.
 * `answered` counts the finished answers per script, for scripts with several
 * `answers`; the tests pass their own map.
 */
export function respond(payload, answered = new Map()) {
  const messages = payload.messages ?? [];
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => text(message.content))
    .join("\n");
  const { user, after } = currentTurn(messages);

  if (
    system.includes("title generation assistant") ||
    user.includes("title generation assistant")
  ) {
    const message =
      /<message>\s*([\s\S]*?)\s*<\/message>/.exec(user)?.[1] ?? user;
    return { content: findChat(message)?.title ?? "Study questions" };
  }
  for (const generator of study) {
    if (system.includes(generator.prompt))
      return { content: JSON.stringify(generator.reply(user)) };
  }

  const script = findChat(user);
  if (!script) return { content: DEFAULT_REPLY };
  const tools = new Set(
    (payload.tools ?? []).map((tool) => tool.function?.name),
  );
  const searched = after.some((message) => message.role === "tool");
  if (script.search && tools.has("search_knowledge") && !searched) {
    return {
      toolCall: {
        name: "search_knowledge",
        arguments: { query: script.search },
      },
    };
  }
  const passages = after
    .filter((message) => message.role === "tool")
    .flatMap((message) => passagesFrom(text(message.content)));
  const count = answered.get(script.match) ?? 0;
  answered.set(script.match, count + 1);
  const answer = script.answers
    ? script.answers[count % script.answers.length]
    : script.answer;
  return { content: fillCitations(answer, passages), pace: script.pace };
}

function chunk(model, delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id: "demo",
    object: "chat.completion.chunk",
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

const usage = (prompt, completion) => ({
  prompt_tokens: prompt,
  completion_tokens: completion,
  total_tokens: prompt + completion,
});

/** Start the model double. `models` are the ids it lists. */
export async function startDemoProvider({
  host = "127.0.0.1",
  models = ["Demo Tutor", "Demo Writer"],
} = {}) {
  let calls = 0;
  const answered = new Map();
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          object: "list",
          data: models.map((id) => ({ id, object: "model", owned_by: "demo" })),
        }),
      );
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const part of request) body += part;
    const payload = JSON.parse(body);
    calls += 1;
    const reply = respond(payload, answered);
    const promptTokens = Math.ceil(
      JSON.stringify(payload.messages ?? []).length / 4,
    );
    const completionTokens = Math.ceil(
      (reply.content ?? JSON.stringify(reply.toolCall)).length / 4,
    );

    if (!payload.stream) {
      const message = reply.toolCall
        ? {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: `call_${calls}`,
                type: "function",
                function: {
                  name: reply.toolCall.name,
                  arguments: JSON.stringify(reply.toolCall.arguments),
                },
              },
            ],
          }
        : { role: "assistant", content: reply.content };
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          id: "demo",
          object: "chat.completion",
          model: payload.model,
          choices: [
            {
              index: 0,
              message,
              finish_reason: reply.toolCall ? "tool_calls" : "stop",
            },
          ],
          usage: usage(promptTokens, completionTokens),
        }),
      );
      return;
    }

    response.writeHead(200, { "Content-Type": "text/event-stream" });
    if (reply.toolCall) {
      response.write(
        chunk(payload.model, {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call_${calls}`,
              type: "function",
              function: {
                name: reply.toolCall.name,
                arguments: JSON.stringify(reply.toolCall.arguments),
              },
            },
          ],
        }),
      );
      response.write(chunk(payload.model, {}, "tool_calls"));
    } else {
      // Stream a few words at a time so the reply arrives like a real one,
      // quickly unless the script sets its own pace.
      const words = reply.content.split(/(?<=\s)/);
      for (let index = 0; index < words.length; index += 4) {
        response.write(
          chunk(payload.model, {
            content: words.slice(index, index + 4).join(""),
          }),
        );
        await sleep(reply.pace ?? 5);
      }
      response.write(chunk(payload.model, {}, "stop"));
    }
    response.write(
      `data: ${JSON.stringify({ id: "demo", object: "chat.completion.chunk", model: payload.model, choices: [], usage: usage(promptTokens, completionTokens) })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => server.listen(0, host, resolve));
  return {
    port: server.address().port,
    calls: () => calls,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
