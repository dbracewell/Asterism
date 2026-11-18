// The capacity check's own parts (US-86.7): statistics and the model double.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDockerSize, percentile, summarize } from "../scripts/capacity/stats.mjs";
import { startStubProvider } from "../scripts/capacity/stub-provider.mjs";

test("percentiles use the nearest rank", () => {
  const values = Array.from({ length: 20 }, (_, index) => index + 1);
  assert.equal(percentile(values, 50), 10);
  assert.equal(percentile(values, 95), 19);
  assert.equal(percentile(values, 100), 20);
  assert.equal(percentile([], 95), null);
  assert.deepEqual(summarize([3, 1, 2]), { count: 3, p50: 2, p95: 3, max: 3 });
});

test("docker sizes parse in binary and decimal units", () => {
  assert.equal(parseDockerSize("1.5GiB"), 1.5 * 1024 ** 3);
  assert.equal(parseDockerSize("512MiB "), 512 * 1024 ** 2);
  assert.equal(parseDockerSize("20kB"), 20_000);
  assert.equal(parseDockerSize("n/a"), null);
});

async function stream(port) {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "Stub tutor", stream: true, messages: [{ role: "user", content: "Hi" }] }),
  });
  const decoder = new TextDecoder();
  let text = "";
  let firstToken = null;
  for await (const part of response.body) {
    text += decoder.decode(part, { stream: true });
    if (firstToken == null && text.includes('"content"')) firstToken = performance.now() - started;
  }
  return { text, firstToken, total: performance.now() - started };
}

test("the model double streams like a hosted model and counts concurrent streams", async () => {
  const stub = await startStubProvider({ ttftMs: 150, tokensPerSecond: 100, replyTokens: 20, completionMs: 10 });
  try {
    const models = await (await fetch(`http://127.0.0.1:${stub.port}/v1/models`)).json();
    assert.deepEqual(models.data.map((model) => model.id), ["Stub tutor"]);

    const [first, second] = await Promise.all([stream(stub.port), stream(stub.port)]);
    assert.ok(first.firstToken >= 140, `first token after ${first.firstToken} ms`);
    // 20 words at 100 per second after the first-token delay.
    assert.ok(first.total >= 140 + 180, `reply took ${first.total} ms`);
    const words = first.text
      .split("\n\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)))
      .flatMap((chunk) => chunk.choices.map((choice) => choice.delta.content ?? ""))
      .join("");
    assert.equal(words.split(" ").length, 20);
    assert.match(first.text, /"usage":\{"prompt_tokens":\d+,"completion_tokens":20/);
    assert.ok(first.text.endsWith("data: [DONE]\n\n"));
    assert.ok(second.text.endsWith("data: [DONE]\n\n"));

    const title = await fetch(`http://127.0.0.1:${stub.port}/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model: "Stub tutor", messages: [] }),
    });
    assert.equal((await title.json()).choices[0].message.content, "Light reactions");
    assert.deepEqual(stub.stats(), { streams: 2, completions: 1, active: 0, maxActive: 2 });
  } finally {
    await stub.close();
  }
});
