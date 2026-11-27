// The image check's own parts (US-91.2): the size budget and the runtime user.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  baseLagProblems,
  componentProblems,
  DIAGRAM_ASSETS,
  developmentPackageProblems,
  diagramAssetProblems,
  drawnDiagramProblems,
  largestLayers,
  localImageProblems,
  pnpmStorePackage,
  runtimeBaseLag,
  sizeProblem,
  uidProblems,
} from "../scripts/check-image.mjs";

const history = [
  '0B\tENTRYPOINT ["/usr/bin/tini"]',
  "1.9GB\tCOPY /app/apps/backend ./apps/backend # buildkit",
  "723MB\tCOPY /app/node_modules ./node_modules # buildkit",
  "20.5kB\tRUN /bin/sh -c chmod +x /app/docker/entrypoint.sh",
  "",
].join("\n");

test("layers are listed largest first", () => {
  const layers = largestLayers(history, 2);
  assert.deepEqual(
    layers.map(({ size }) => size),
    ["1.9GB", "723MB"],
  );
  assert.equal(
    layers[0].command,
    "COPY /app/apps/backend ./apps/backend # buildkit",
  );
});

test("an image within budget passes, and one over it names the largest layers", () => {
  const layers = largestLayers(history);
  assert.equal(sizeProblem(4.4e9, 5e9, layers), null);
  assert.equal(sizeProblem(5e9, 5e9, layers), null);
  const problem = sizeProblem(5.2e9, 5e9, layers);
  assert.match(problem, /^The image is 5\.20 GB, over the 5\.00 GB budget\./);
  assert.match(problem, /DEFAULT_MAX_SIZE_GB in scripts\/check-image\.mjs/);
  assert.match(problem, /1\.9GB {2}COPY \/app\/apps\/backend/);
  assert.equal(sizeProblem(null, 5e9, layers), "Could not read the image size");
});

test("every process must run as UID 10001", () => {
  assert.deepEqual(uidProblems(["10001", "10001"]), []);
  assert.deepEqual(uidProblems(["10001", "0"]), [
    "Processes run as UID 0, not only 10001",
  ]);
  assert.deepEqual(uidProblems([]), [
    "No processes were found in the container",
  ]);
});

test("the CPU image has no local-image packages and the GPU image has all of them", () => {
  const none = {
    torch: false,
    torchvision: false,
    diffusers: false,
    accelerate: false,
  };
  const all = {
    torch: true,
    torchvision: true,
    diffusers: true,
    accelerate: true,
  };
  assert.deepEqual(localImageProblems(none, "cpu"), []);
  assert.deepEqual(localImageProblems(all, "gpu"), []);
  assert.deepEqual(localImageProblems({ ...none, torch: true }, "cpu"), [
    "The CPU image can import torch; it must not include the local-image extra",
  ]);
  assert.deepEqual(localImageProblems({ ...all, diffusers: false }, "gpu"), [
    "The GPU image cannot import diffusers; it must include the local-image extra",
  ]);
});

test("pnpm store directories name their package", () => {
  assert.equal(pnpmStorePackage("vite@8.0.16_@types+node@20.19.41"), "vite");
  assert.equal(pnpmStorePackage("vite-node@3.2.4"), "vite-node");
  assert.equal(pnpmStorePackage("@vitest+expect@4.1.8"), "@vitest/expect");
  assert.equal(pnpmStorePackage("node_modules"), null);
  assert.equal(pnpmStorePackage("lock.yaml"), null);
});

test("test tooling in node_modules, or pip in the system Python, fails the image", () => {
  const runtime = [
    "next@16.4.6_react@19.3.1",
    "better-auth@1.7.26",
    "node_modules",
  ];
  assert.deepEqual(developmentPackageProblems(runtime, false), []);
  // A package whose name only starts with a development package's passes.
  assert.deepEqual(
    developmentPackageProblems(
      [...runtime, "vite-plugin-x@1.0.0", "@vitest+utils@4.1.8"],
      false,
    ),
    [],
  );
  assert.deepEqual(
    developmentPackageProblems(
      [
        ...runtime,
        "vitest@4.1.8_jsdom@29.1.1",
        "jsdom@29.1.1_@noble+hashes@2.2.0",
      ],
      false,
    ),
    [
      "The image's node_modules has vitest, jsdom; test tooling must not reach the production install",
    ],
  );
  assert.deepEqual(developmentPackageProblems(runtime, true), [
    "The image's system Python can import pip; the runtime stage must remove it",
  ]);
});

const dockerfile = (arg) =>
  [
    "FROM python:3.13-slim-bookworm@sha256:aaa AS backend-build",
    'ARG BASE_LAG_UPGRADES="ignored"',
    "FROM python:3.13-slim-trixie@sha256:bbb AS runtime",
    "# comment",
    ...(arg === undefined ? [] : [arg]),
    "RUN apt-get update",
  ].join("\n");

test("the runtime stage's base and its upgraded packages are read from the Dockerfile", () => {
  assert.deepEqual(
    runtimeBaseLag(dockerfile('ARG BASE_LAG_UPGRADES="zlib1g libexpat1"')),
    {
      baseImage: "python:3.13-slim-trixie@sha256:bbb",
      packages: ["zlib1g", "libexpat1"],
    },
  );
  assert.deepEqual(
    runtimeBaseLag(dockerfile('ARG BASE_LAG_UPGRADES=""')).packages,
    [],
  );
  assert.deepEqual(runtimeBaseLag(dockerfile()).packages, []);
  assert.throws(
    () => runtimeBaseLag("FROM node:22 AS frontend"),
    /no runtime stage/,
  );
});

test("the repository Dockerfile's runtime stage is readable", async () => {
  const { readFile } = await import("node:fs/promises");
  const { baseImage, packages } = runtimeBaseLag(
    await readFile("Dockerfile", "utf8"),
  );
  assert.match(baseImage, /^python:.*@sha256:[0-9a-f]{64}$/);
  assert.ok(Array.isArray(packages));
});

test("a package upgraded past the base passes, and fails once the base catches up", () => {
  const old = "1:1.3.dfsg+really1.3.1-1+b1";
  const fixed = "1:1.3.dfsg+really1.3.1-1+deb13u1";
  assert.deepEqual(
    baseLagProblems(["zlib1g"], { zlib1g: old }, { zlib1g: fixed }),
    [],
  );
  assert.deepEqual(
    baseLagProblems(["zlib1g"], { zlib1g: fixed }, { zlib1g: fixed }),
    [
      `zlib1g is ${fixed} in both the base and the image: if the base now has the fix, remove zlib1g from BASE_LAG_UPGRADES in the Dockerfile; otherwise the upgrade did not apply`,
    ],
  );
  assert.deepEqual(
    baseLagProblems(["zlibl"], { zlibl: null }, { zlibl: null }),
    ["BASE_LAG_UPGRADES names zlibl, which the base image does not install"],
  );
  assert.deepEqual(baseLagProblems([], {}, {}), []);
});

test("the diagram renderer needs every asset and the pinned mermaid", () => {
  const readable = Object.fromEntries(
    DIAGRAM_ASSETS.map((path) => [path, true]),
  );
  assert.deepEqual(
    diagramAssetProblems({ readable, mermaidVersion: "12.3.0" }, "12.3.0"),
    [],
  );
  const missing = { ...readable, [DIAGRAM_ASSETS[2]]: false };
  assert.deepEqual(
    diagramAssetProblems(
      { readable: missing, mermaidVersion: "12.2.0" },
      "12.3.0",
    ),
    [
      `the diagram renderer cannot read ${DIAGRAM_ASSETS[2]}`,
      "the image has mermaid 12.2.0, but the frontend pins 12.3.0",
    ],
  );
  assert.match(
    diagramAssetProblems({ readable, mermaidVersion: null }, "12.3.0")[0],
    /mermaid \(none\)/,
  );
});

test("the in-image diagram draw must produce a named PNG at the policy scale", () => {
  const ok = JSON.stringify({
    label: "Image check",
    png: [720, 118],
    css: [360, 59],
  });
  assert.deepEqual(drawnDiagramProblems(`INFO: Drew 1 of 1\n${ok}\n`, 2), []);
  assert.deepEqual(
    drawnDiagramProblems(
      JSON.stringify({ label: null, png: null, css: null }),
      2,
    ),
    ["the image could not draw a diagram"],
  );
  assert.deepEqual(
    drawnDiagramProblems(
      JSON.stringify({ label: "Image check", png: [360, 59], css: [360, 59] }),
      2,
    ),
    ["the drawn PNG is 360x59, not 2x its 360x59 size"],
  );
  assert.deepEqual(drawnDiagramProblems("Traceback ...", 2), [
    "the diagram draw check printed no result",
  ]);
});

test("the component record must match what the image runs (US-114.3)", () => {
  const actual = {
    libgbm1: "25.0.7-2",
    node: "22.13.0",
    chromium: "140.0.7339.16",
  };
  assert.deepEqual(componentProblems({ ...actual }, actual), []);
  assert.deepEqual(
    componentProblems(
      { libgbm1: "25.0.7-1", node: "22.13.0" },
      { ...actual, chromium: "" },
    ),
    [
      "libgbm1: components.json records 25.0.7-1, but the image has 25.0.7-2",
      "chromium: the image has no readable version",
    ],
  );
  assert.deepEqual(componentProblems(null, actual), [
    "libgbm1: components.json records nothing, but the image has 25.0.7-2",
    "node: components.json records nothing, but the image has 22.13.0",
    "chromium: components.json records nothing, but the image has 140.0.7339.16",
  ]);
});

test("compose locks the container down and check:image runs it the same way", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compose = read("docker-compose.yml");
  assert.match(compose, /cap_drop:\n\s+- ALL\n/);
  assert.match(compose, /security_opt:\n\s+- no-new-privileges:true\n/);
  const pids = /pids_limit: (\d+)/.exec(compose)?.[1];
  assert.ok(pids);
  const check = read("scripts/check-image.mjs");
  assert.match(check, /"--cap-drop",\s+"ALL"/);
  assert.match(check, /"--security-opt",\s+"no-new-privileges:true"/);
  assert.match(check, new RegExp(`"--pids-limit",\\s+"${pids}"`));
});
