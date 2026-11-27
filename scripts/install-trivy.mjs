#!/usr/bin/env node
/**
 * Installs the pinned Trivy release, checked against a SHA-256 kept here (US-92.2).
 *
 * The workflows don't use aquasecurity/trivy-action or setup-trivy: in March 2026
 * both had their tags repointed to a credential stealer, and one Trivy release
 * (0.69.4) was malicious (GHSA-69fq-xp46-6x23). A release tarball checked against
 * a hash committed here can't change under us. Dependabot can't update this pin;
 * docs/development.md says how to move it.
 *
 * Usage: node scripts/install-trivy.mjs [--dir <directory>]
 * Prints the binary's path. In GitHub Actions it also adds the directory to PATH.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export const TRIVY_VERSION = "0.76.2";

/** SHA-256 of each release tarball, from trivy_<version>_checksums.txt. */
export const TRIVY_TARBALLS = {
  "linux-x64": {
    asset: "Linux-64bit.tar.gz",
    sha256: "bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf",
  },
  "linux-arm64": {
    asset: "Linux-ARM64.tar.gz",
    sha256: "ab9d51f86e6a5fb936f605faff6b593ac51bc378fff4d3e8b9d58358b9c367c3",
  },
  "darwin-arm64": {
    asset: "macOS-ARM64.tar.gz",
    sha256: "ae7ea358326960406b703c77b2ac490190797d80b306b5b50c2a27221da0a5b8",
  },
};

/** The tarball for a platform and architecture, or an error naming the supported ones. */
export function tarballFor(platform, arch, version = TRIVY_VERSION) {
  const tarball = TRIVY_TARBALLS[`${platform}-${arch}`];
  if (!tarball) {
    throw new Error(
      `No pinned Trivy for ${platform}-${arch}; pinned: ${Object.keys(TRIVY_TARBALLS).join(", ")}`,
    );
  }
  const name = `trivy_${version}_${tarball.asset}`;
  return {
    name,
    sha256: tarball.sha256,
    url: `https://github.com/aquasecurity/trivy/releases/download/v${version}/${name}`,
  };
}

/** A problem when the downloaded bytes don't match the pinned hash, else null. */
export function hashProblem(bytes, expected, name) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  return actual === expected
    ? null
    : `${name} has SHA-256 ${actual}, not the pinned ${expected}. Not installing it.`;
}

/**
 * A new directory only this user can write, under `base` (US-114.3): a fixed
 * name in a shared temporary directory could be created first by someone else,
 * with their own binary in it.
 */
export function privateInstallDir(base) {
  return mkdtempSync(join(base, `trivy-${TRIVY_VERSION}-`));
}

async function main() {
  const { values } = parseArgs({
    options: { dir: { type: "string" } },
  });
  const dir =
    values.dir ?? privateInstallDir(process.env.RUNNER_TEMP ?? tmpdir());
  const tarball = tarballFor(process.platform, process.arch);
  const response = await fetch(tarball.url);
  if (!response.ok) {
    throw new Error(
      `Downloading ${tarball.url} failed: HTTP ${response.status}`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const problem = hashProblem(bytes, tarball.sha256, tarball.name);
  if (problem) throw new Error(problem);
  mkdirSync(dir, { recursive: true });
  const archive = join(dir, tarball.name);
  writeFileSync(archive, bytes);
  execFileSync("tar", ["-xzf", archive, "-C", dir, "trivy"]);
  const binary = join(dir, "trivy");
  if (process.env.GITHUB_PATH)
    appendFileSync(process.env.GITHUB_PATH, `${dir}\n`);
  console.log(binary);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
