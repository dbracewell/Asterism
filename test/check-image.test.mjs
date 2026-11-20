// The image check's own parts (US-91.2): the size budget and the runtime user.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  largestLayers,
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
  assert.match(problem, /--max-size-gb/);
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
