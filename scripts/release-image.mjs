#!/usr/bin/env node
/**
 * Helpers for the release workflow's attested images (US-92.3).
 *
 * Each architecture is built with an SPDX SBOM and `provenance: mode=max`, so
 * the digest it is pushed by names an index: the image manifest plus an
 * attestation manifest (platform unknown/unknown) holding the SBOM and the
 * BuildKit provenance.
 *
 *   platform --image <ref@digest> --arch <amd64|arm64>
 *     Prints the digest of the index's image manifest for that architecture.
 *     The workflow pulls that manifest back, so the checked image carries no
 *     attestation blobs and `pnpm check:image` reads the image's own size.
 *
 *   sbom --image <ref@digest> --out <file>
 *     Writes the image's SPDX document, read from its attestation manifest,
 *     and fails unless it can be attested (SPDX 2.3, within the size limit).
 *
 * Usage: node scripts/release-image.mjs <platform|sbom> [options]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

/** The SPDX version BuildKit writes; the workflow verifies this predicate type. */
export const SPDX_VERSION = "SPDX-2.3";
export const SBOM_PREDICATE_TYPE = "https://spdx.dev/Document/v2.3";
/** actions/attest refuses an SBOM over 16 MB. */
export const MAX_SBOM_BYTES = 16_000_000;

const ATTESTATION = "attestation-manifest";

/** The digest of the image manifest for `arch` in a pushed image index. */
export function platformDigest(index, arch) {
  if (!Array.isArray(index?.manifests))
    throw new Error(
      "Expected an image index (built with an SBOM and provenance), got a single manifest.",
    );
  const matches = index.manifests.filter(
    (manifest) =>
      manifest.annotations?.["vnd.docker.reference.type"] !== ATTESTATION &&
      manifest.platform?.os === "linux" &&
      manifest.platform?.architecture === arch,
  );
  if (matches.length !== 1)
    throw new Error(
      `Expected one linux/${arch} image in the index, found ${matches.length}.`,
    );
  return matches[0].digest;
}

/**
 * The SPDX document from `imagetools inspect --format '{{json .SBOM}}'`: for a
 * single-platform index that is `{ SPDX }`; for a multi-platform one, a map
 * from platform to `{ SPDX }`, and `arch` picks the entry.
 */
export function spdxDocument(sbom, arch) {
  if (sbom?.SPDX) return sbom.SPDX;
  if (arch && sbom?.[`linux/${arch}`]?.SPDX) return sbom[`linux/${arch}`].SPDX;
  const platforms = Object.keys(sbom ?? {});
  throw new Error(
    platforms.length > 1 && !arch
      ? `The index has SBOMs for ${platforms.join(", ")}; pass --arch.`
      : "The image has no SPDX SBOM; build it with an SBOM attestation.",
  );
}

/** Why an SPDX document can't be attested, or null when it can. */
export function sbomProblem(document, bytes) {
  if (document?.spdxVersion !== SPDX_VERSION)
    return `Expected ${SPDX_VERSION}, got ${document?.spdxVersion ?? "no spdxVersion"}; the workflow verifies ${SBOM_PREDICATE_TYPE}.`;
  if (!Array.isArray(document.packages) || document.packages.length === 0)
    return "The SBOM lists no packages.";
  if (bytes > MAX_SBOM_BYTES)
    return `The SBOM is ${(bytes / 1e6).toFixed(1)} MB; actions/attest takes at most ${MAX_SBOM_BYTES / 1e6} MB.`;
  return null;
}

function imagetools(args) {
  return execFileSync("docker", ["buildx", "imagetools", "inspect", ...args], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      image: { type: "string" },
      arch: { type: "string" },
      out: { type: "string" },
    },
  });
  const [command] = positionals;
  if (!values.image) throw new Error("Pass --image <ref@digest>.");
  if (command === "platform") {
    if (!values.arch) throw new Error("Pass --arch <amd64|arm64>.");
    const index = JSON.parse(imagetools(["--raw", values.image]));
    console.log(platformDigest(index, values.arch));
  } else if (command === "sbom") {
    if (!values.out) throw new Error("Pass --out <file>.");
    const sbom = JSON.parse(
      imagetools([values.image, "--format", "{{json .SBOM}}"]),
    );
    const document = spdxDocument(sbom, values.arch);
    const text = JSON.stringify(document);
    const bytes = Buffer.byteLength(text);
    const problem = sbomProblem(document, bytes);
    if (problem) throw new Error(problem);
    writeFileSync(values.out, text);
    console.log(
      `Wrote ${values.out}: ${document.packages.length} packages, ${(bytes / 1e6).toFixed(1)} MB.`,
    );
  } else {
    throw new Error("Usage: release-image.mjs <platform|sbom> --image <ref>");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
