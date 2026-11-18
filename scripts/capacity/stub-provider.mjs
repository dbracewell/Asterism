// An OpenAI-compatible model double with realistic streaming latency (US-86.7).
//
// Chat completions stream one word per chunk after a first-token delay, like a
// hosted model. Non-streaming calls (chat titles) answer after a short delay.
// The double counts concurrent streams so a run can show where the backend's
// provider limit held requests back.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const WORDS =
  "photosynthesis converts light energy into chemical energy stored in glucose while chlorophyll in the thylakoid membranes absorbs mostly red and blue light and the Calvin cycle fixes carbon dioxide".split(
    " ",
  );

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The reply text: `count` words from a fixed vocabulary. */
export function replyWords(count) {
  return Array.from({ length: count }, (_, index) => WORDS[index % WORDS.length]);
}

function chunk(model, delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id: randomUUID(),
    object: "chat.completion.chunk",
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

/**
 * Start the double.
 *
 * @param {{ host?: string, ttftMs?: number, tokensPerSecond?: number,
 *   replyTokens?: number, completionMs?: number, models?: string[] }} options
 */
export async function startStubProvider({
  host = "127.0.0.1",
  ttftMs = 700,
  tokensPerSecond = 40,
  replyTokens = 250,
  completionMs = 800,
  models = ["Stub tutor"],
} = {}) {
  const stats = { streams: 0, completions: 0, active: 0, maxActive: 0 };
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: models.map((id) => ({ id, supports_tools: true })) }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const part of request) body += part;
    const payload = JSON.parse(body);
    const promptTokens = Math.ceil(JSON.stringify(payload.messages ?? []).length / 4);
    if (!payload.stream) {
      stats.completions += 1;
      await sleep(completionMs);
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          id: randomUUID(),
          object: "chat.completion",
          model: payload.model,
          choices: [{ index: 0, message: { role: "assistant", content: "Light reactions" }, finish_reason: "stop" }],
          usage: { prompt_tokens: promptTokens, completion_tokens: 3, total_tokens: promptTokens + 3 },
        }),
      );
      return;
    }
    stats.streams += 1;
    stats.active += 1;
    stats.maxActive = Math.max(stats.maxActive, stats.active);
    let closed = false;
    response.on("close", () => {
      closed = true;
    });
    try {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      await sleep(ttftMs);
      const gap = 1000 / tokensPerSecond;
      const words = replyWords(replyTokens);
      const started = Date.now();
      for (const [index, word] of words.entries()) {
        if (closed) return;
        response.write(chunk(payload.model, { role: "assistant", content: index ? ` ${word}` : word }));
        // Pace against the start time so timer drift does not slow long replies.
        const due = started + (index + 1) * gap - Date.now();
        if (due > 0) await sleep(due);
      }
      response.write(chunk(payload.model, {}, "stop"));
      response.write(
        `data: ${JSON.stringify({
          id: randomUUID(),
          object: "chat.completion.chunk",
          model: payload.model,
          choices: [],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: replyTokens,
            total_tokens: promptTokens + replyTokens,
          },
        })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    } finally {
      stats.active -= 1;
    }
  });
  await new Promise((resolve) => server.listen(0, host, resolve));
  return {
    port: server.address().port,
    stats: () => ({ ...stats }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
