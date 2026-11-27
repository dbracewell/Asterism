// The build-input pin check (US-92.1).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  checkPins,
  dockerfileProblems,
  workflowProblems,
} from "../scripts/check-pins.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const SHA = "b".repeat(40);

test("a FROM needs a digest unless it names an earlier stage or scratch", () => {
  const dockerfile = [
    `# syntax=docker/dockerfile:1.29.0@${DIGEST}`,
    `FROM node:22-bookworm-slim@${DIGEST} AS base`,
    "FROM base AS deps",
    "FROM --platform=$BUILDPLATFORM Base AS build",
    "FROM scratch",
    "FROM python:3.13-slim AS runtime",
    "FROM later AS earlier",
    "FROM node AS later",
    "FROM later",
  ].join("\n");
  assert.deepEqual(dockerfileProblems(dockerfile, "Dockerfile"), [
    "Dockerfile:6: FROM python:3.13-slim is not pinned by digest (image:tag@sha256:…)",
    "Dockerfile:7: FROM later is not pinned by digest (image:tag@sha256:…)",
    "Dockerfile:8: FROM node is not pinned by digest (image:tag@sha256:…)",
  ]);
});

test("the syntax directive needs a digest anywhere in the directive block", () => {
  const unpinned = "syntax docker/dockerfile:1 is not pinned by digest (image:tag@sha256:…)";
  assert.deepEqual(dockerfileProblems("# syntax=docker/dockerfile:1\nFROM scratch", "D"), [`D:1: ${unpinned}`]);
  assert.deepEqual(dockerfileProblems("  #  syntax = docker/dockerfile:1\r\nFROM scratch", "D"), [
    `D:1: ${unpinned}`,
  ]);
  assert.deepEqual(dockerfileProblems("# escape=`\n# check=error=true\n# SYNTAX=docker/dockerfile:1\nFROM scratch", "D"), [
    `D:3: ${unpinned}`,
  ]);
  assert.deepEqual(dockerfileProblems(`\uFEFF# syntax=docker/dockerfile:1.29.0@${DIGEST}\nFROM scratch`, "D"), []);
});

test("a syntax line after the directive block is a comment, as BuildKit reads it", () => {
  for (const prefix of ["\n", "# a comment\n", "FROM scratch\n"]) {
    assert.deepEqual(dockerfileProblems(`${prefix}# syntax=docker/dockerfile:1\nFROM scratch`, "D"), []);
  }
});

test("a stage can't pin itself by sharing its image's name", () => {
  assert.deepEqual(dockerfileProblems("FROM node AS node", "Dockerfile"), [
    "Dockerfile:1: FROM node is not pinned by digest (image:tag@sha256:…)",
  ]);
});

test("a uses needs a commit SHA unless it is local; images need a digest", () => {
  const workflow = [
    "jobs:",
    "  image:",
    "    container: # the E2E runtime",
    `      image: node:22.13.0-bookworm@${DIGEST}`,
    "    services:",
    "      db:",
    "        image: postgres:17",
    "    steps:",
    `      - uses: actions/cache@${SHA} # v4.4.0`,
    "      - uses: actions/setup-node@v4",
    `      - uses: "docker/build-push-action@${SHA.slice(0, 7)}"`,
    "      - uses: ./.github/actions/local",
    `      - uses: docker://alpine:3.22@${DIGEST}`,
    "      - uses: docker://alpine:3.22",
    "      - run: 'echo uses: not/an-action@v1'",
    "  other:",
    "    container: ubuntu:24.04",
    "  matrix:",
    "    container: ${{ matrix.image }}",
    "  reusable:",
    "    uses: org/repo/.github/workflows/build.yml@main",
    "  local:",
    "    uses: ./.github/workflows/local.yml",
  ].join("\n");
  assert.deepEqual(workflowProblems(workflow, "ci.yml"), [
    "ci.yml:7: image postgres:17 is not pinned by digest (image:tag@sha256:…)",
    "ci.yml:10: uses actions/setup-node@v4 is not pinned to a full commit SHA (owner/repo@<sha> # vX.Y.Z)",
    `ci.yml:11: uses docker/build-push-action@${SHA.slice(0, 7)} is not pinned to a full commit SHA (owner/repo@<sha> # vX.Y.Z)`,
    "ci.yml:14: uses docker://alpine:3.22 is not pinned by digest (docker://image:tag@sha256:…)",
    "ci.yml:17: image ubuntu:24.04 is not pinned by digest (image:tag@sha256:…)",
    "ci.yml:21: uses org/repo/.github/workflows/build.yml@main is not pinned to a full commit SHA (owner/repo@<sha> # vX.Y.Z)",
  ]);
});

test("flow-style steps and containers are read like block style", () => {
  const workflow = [
    "jobs:",
    "  build: { container: { image: 'ubuntu:24.04' }, steps: [",
    "    { uses: actions/cache@v4 },",
    `    { name: pinned, uses: actions/setup-node@${SHA} }`,
    "    ] }",
  ].join("\n");
  assert.deepEqual(workflowProblems(workflow, "ci.yml"), [
    "ci.yml:2: image ubuntu:24.04 is not pinned by digest (image:tag@sha256:…)",
    "ci.yml:3: uses actions/cache@v4 is not pinned to a full commit SHA (owner/repo@<sha> # vX.Y.Z)",
  ]);
});

test("layouts the check can't read fail instead of passing", () => {
  const aliases = [
    "x-step: &checkout",
    "  uses: actions/cache@v4",
    "x-action: &action actions/cache@v4",
    "jobs:",
    "  build:",
    "    steps:",
    "      - *checkout",
    "      - uses: *action",
  ].join("\n");
  assert.deepEqual(workflowProblems(aliases, "ci.yml"), [
    "ci.yml:7: step is not a mapping the pin check can read (aliases are not followed)",
    "ci.yml:8: uses is not a plain string the pin check can read (aliases are not followed)",
  ]);
  assert.match(workflowProblems("jobs:\n  build: [\n", "ci.yml")[0], /^ci\.yml:\d+: not valid YAML/);
});

test("the check walks Dockerfiles and workflows under the root", () => {
  const root = mkdtempSync(join(tmpdir(), "check-pins-"));
  try {
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    mkdirSync(join(root, "docker", "node_modules"), { recursive: true });
    writeFileSync(join(root, "Dockerfile"), `FROM node@${DIGEST} AS base\nFROM base\n`);
    writeFileSync(join(root, "docker", "gpu.Dockerfile"), "FROM nvidia/cuda:12\n");
    writeFileSync(join(root, "docker", "node_modules", "Dockerfile"), "FROM ignored\n");
    writeFileSync(join(root, ".github", "workflows", "ci.yml"), "jobs:\n  build:\n    steps:\n      - uses: actions/cache@v4\n");
    writeFileSync(join(root, ".github", "workflows", "notes.txt"), "uses: not/a-workflow@v1\n");
    assert.deepEqual(checkPins(root), [
      "docker/gpu.Dockerfile:1: FROM nvidia/cuda:12 is not pinned by digest (image:tag@sha256:…)",
      ".github/workflows/ci.yml:4: uses actions/cache@v4 is not pinned to a full commit SHA (owner/repo@<sha> # vX.Y.Z)",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("this repository's build inputs are pinned", () => {
  assert.deepEqual(checkPins(new URL("..", import.meta.url).pathname), []);
});

test("checkouts drop the token and Node comes from .node-version (US-114.2)", () => {
  const workflow = [
    "jobs:",
    "  e2e:",
    "    container:",
    `      image: node:22.12.0-bookworm@${DIGEST}`,
    "    steps:",
    `      - uses: actions/checkout@${SHA} # v4.4.0`,
    `      - uses: actions/checkout@${SHA} # v4.4.0`,
    "        with:",
    "          persist-credentials: false",
    `      - uses: actions/setup-node@${SHA} # v4.4.0`,
    "        with:",
    '          node-version: "22.13.0"',
    `      - uses: actions/setup-node@${SHA} # v4.4.0`,
    "        with:",
    "          node-version-file: .node-version",
    "  same:",
    "    container:",
    `      image: node:22.13.0-bookworm@${DIGEST}`,
  ].join("\n");
  assert.deepEqual(workflowProblems(workflow, "ci.yml", { nodeVersion: "22.13.0" }), [
    `ci.yml:4: image node:22.12.0-bookworm@${DIGEST} is not Node 22.13.0 from .node-version`,
    "ci.yml:6: checkout keeps the token; set persist-credentials: false",
    "ci.yml:10: setup-node does not read node-version-file: .node-version",
  ]);
  // Without a version file only the token rule applies.
  assert.deepEqual(workflowProblems(workflow, "ci.yml"), [
    "ci.yml:6: checkout keeps the token; set persist-credentials: false",
  ]);
});
