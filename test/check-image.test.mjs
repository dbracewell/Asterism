// The image check's own parts (US-91.2): the size budget and the runtime user.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  developmentPackageProblems,
  largestLayers,
  localImageProblems,
  pnpmStorePackage,
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
