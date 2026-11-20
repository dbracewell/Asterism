// Upgrading from the previous release (US-91.6): the parts that need no Docker.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chatSnapshot,
  previousRelease,
  seedProblems,
} from "../scripts/check-upgrade.mjs";

test("the previous release is the newest tag behind this commit, not its own", () => {
  assert.equal(previousRelease({ reachable: [], atHead: [] }), null);
  // Straight after the first release, its own commit has nothing before it.
  assert.equal(
    previousRelease({ reachable: ["v0.2.0"], atHead: ["v0.2.0"] }),
    null,
  );
  // A later commit upgrades from it.
  assert.equal(
    previousRelease({ reachable: ["v0.2.0"], atHead: [] }),
    "0.2.0",
  );
  // A release commit upgrades from the one before it, by version, not text.
  assert.equal(
    previousRelease({
      reachable: ["v0.9.0", "v0.10.0", "v0.10.1", "nightly"],
      atHead: ["v0.10.1"],
    }),
    "0.10.0",
  );
});

test("a chat snapshot keeps what must survive, not what may change", () => {
  const message = {
    id: "m1",
    role: "assistant",
    status: "complete",
    content: "ATP",
    input_tokens: 5,
    execution: { steps: [] },
  };
  assert.deepEqual(chatSnapshot({ info: {}, messages: [message] }), [
    { id: "m1", role: "assistant", status: "complete", content: "ATP" },
  ]);
});

test("every kind of lost data is reported", () => {
  const seeded = {
    email: "a@upgrade.test",
    chat: [{ id: "m1", role: "user", status: "complete", content: "Hi" }],
    files: ["a.txt", "b.txt"],
    theme: "upgrade-check",
  };
  const kept = {
    signedIn: true,
    chat: seeded.chat,
    files: ["a.txt", "b.txt"],
    knowledge: "ready",
    similar: ["b.txt"],
    themes: ["atlas", "upgrade-check"],
  };
  assert.deepEqual(seedProblems(seeded, kept), []);
  const problems = seedProblems(seeded, {
    signedIn: true,
    chat: [],
    files: ["a.txt"],
    knowledge: "pending",
    similar: [],
    themes: ["atlas"],
  });
  assert.equal(problems.length, 5);
  assert.match(problems[0], /The chat changed/);
  assert.match(problems[1], /b\.txt is missing/);
  assert.match(problems[2], /pending, not ready/);
  assert.match(problems[3], /vectors were lost/);
  assert.match(problems[4], /upgrade-check is missing/);
  assert.match(
    seedProblems(seeded, { ...kept, signedIn: false }).join("\n"),
    /could not sign in/,
  );
});
