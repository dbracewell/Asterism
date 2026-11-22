// Upgrading from the previous release (US-91.6): the parts that need no Docker.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chatSnapshot,
  previousReleases,
  publishedRelease,
  schemaProblem,
  seedProblems,
} from "../scripts/check-upgrade.mjs";

test("the previous releases are the tags behind this commit, newest first, not its own", () => {
  assert.deepEqual(previousReleases({ reachable: [], atHead: [] }), []);
  // Straight after the first release, its own commit has nothing before it.
  assert.deepEqual(
    previousReleases({ reachable: ["v0.2.0"], atHead: ["v0.2.0"] }),
    [],
  );
  assert.deepEqual(previousReleases({ reachable: ["v0.2.0"], atHead: [] }), [
    "0.2.0",
  ]);
  // By version, not text.
  assert.deepEqual(
    previousReleases({
      reachable: ["v0.9.0", "v0.10.0", "v0.10.1", "nightly"],
      atHead: ["v0.10.1"],
    }),
    ["0.10.0", "0.9.0"],
  );
});

test("a release whose image was never published is passed over, other registry answers are not", async () => {
  const registry = { "0.3.0": 404, "0.2.0": 200, "0.1.0": 200 };
  const notes = [];
  assert.equal(
    await publishedRelease(
      ["0.3.0", "0.2.0", "0.1.0"],
      async (version) => registry[version],
      (note) => notes.push(note),
    ),
    "0.2.0",
  );
  assert.match(notes.join(), /0\.3\.0 was never published/);
  assert.equal(await publishedRelease(["0.3.0"], async () => 404), null);
  await assert.rejects(
    publishedRelease(["0.3.0", "0.2.0"], async () => 401),
    /answered 401 for .*:0\.3\.0/,
  );
});

test("an upgraded schema must match a fresh one", () => {
  const fresh = {
    user: {
      columns: [
        ["email", "TEXT", 1, null, 0],
        ["id", "TEXT", 1, null, 1],
        ["role", "TEXT", 0, null, 0],
      ],
      indexes: [],
    },
    jwks: { columns: [["id", "TEXT", 1, null, 1]], indexes: [] },
  };
  assert.equal(schemaProblem(fresh, structuredClone(fresh)), null);
  // Extra tables in the upgraded database are tolerated.
  assert.equal(schemaProblem(fresh, { ...fresh, old: fresh.jwks }), null);
  const stale = structuredClone(fresh);
  stale.user.columns.pop();
  delete stale.jwks;
  const problem = schemaProblem(fresh, stale);
  assert.match(problem, /not at the image's schema/);
  assert.match(problem, /user is/);
  assert.match(problem, /missing table jwks/);
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
  const theme = {
    name: "Upgrade check",
    filename: "upgrade-check",
    radius: 0.45,
  };
  const seeded = {
    email: "a@upgrade.test",
    chat: [{ id: "m1", role: "user", status: "complete", content: "Hi" }],
    files: { "a.txt": "alpha", "b.txt": "beta" },
    theme,
    caption: { filename: "red-square.png", text: "A red square." },
    generator: "Diffusers",
  };
  const kept = {
    signedIn: true,
    chat: seeded.chat,
    files: ["a.txt", "b.txt"],
    contents: { "a.txt": "alpha", "b.txt": "beta" },
    knowledge: "ready",
    similar: ["b.txt"],
    theme: { ...theme },
    caption: "A red square.",
    newCaption: { status: "ready", payload: { text: "A blue circle." } },
    generator: "Diffusers",
    generatorStatus: {
      provider: "Diffusers",
      ready: false,
      detail: "Diffusers is not available in this image",
    },
  };
  assert.deepEqual(seedProblems(seeded, kept), []);
  const problems = seedProblems(seeded, {
    signedIn: true,
    chat: [],
    files: ["a.txt"],
    contents: { "a.txt": "changed" },
    knowledge: "pending",
    similar: [],
    theme: { ...theme, radius: 0 },
    caption: null,
    newCaption: { status: "pending" },
    generator: "ComfyUI",
  });
  assert.equal(problems.length, 9);
  assert.match(problems[0], /The chat changed/);
  assert.match(problems[1], /a\.txt no longer has the uploaded content/);
  assert.match(problems[2], /b\.txt is missing/);
  assert.match(problems[3], /pending, not ready/);
  assert.match(problems[4], /vectors were lost/);
  assert.match(problems[5], /caption of red-square\.png changed/);
  assert.match(problems[6], /no longer captions/);
  assert.match(problems[7], /saved image generator changed/);
  assert.match(problems[8], /The theme changed/);
  assert.match(
    seedProblems(seeded, {
      ...kept,
      generatorStatus: {
        provider: "Diffusers",
        ready: false,
        detail: "No image provider is set up",
      },
    }).join(),
    /should read as not available in this image/,
  );
  assert.match(
    seedProblems(seeded, { ...kept, theme: null }).join(),
    /upgrade-check is missing/,
  );
  assert.match(
    seedProblems(seeded, { ...kept, signedIn: false }).join(),
    /could not sign in/,
  );
});
