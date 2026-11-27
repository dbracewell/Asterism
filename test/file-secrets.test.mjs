import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// US-115.2: the entrypoint, the backend and the frontend strip exactly one
// trailing "\r\n" or "\n" from a file secret. The backend and frontend tests
// check the same cases.
export const FILE_SECRET_CASES = [
  ["key\r\n", "key"],
  ["key\n", "key"],
  ["key", "key"],
  ["key\n\n", "key\n"],
  ["key\r\n\r\n", "key\r\n"],
  ["key\r", "key\r"],
];

const bashMajor = Number(
  spawnSync("bash", ["-c", "echo ${BASH_VERSINFO[0]}"], { encoding: "utf8" })
    .stdout,
);

test(
  "the entrypoint reads file secrets saved with any line ending",
  { skip: bashMajor < 4 && "needs bash 4 or newer, as in the image" },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "asterism-secrets-"));
    try {
      for (const [content, expected] of FILE_SECRET_CASES) {
        writeFileSync(join(directory, "SYSTEM_KEY"), content);
        const environment = { ...process.env, SECRETS: directory };
        delete environment.SYSTEM_KEY;
        const result = spawnSync(
          "bash",
          [
            "-c",
            'set -eu; source docker/secrets.sh; secrets_dir="$SECRETS"; load_secret SYSTEM_KEY; printf %s "$SYSTEM_KEY"',
          ],
          { encoding: "utf8", env: environment },
        );
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, expected, JSON.stringify(content));
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
