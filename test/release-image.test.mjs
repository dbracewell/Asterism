// The release workflow's attested images (US-92.3): finding each
// architecture's image in its pushed index, and the SBOM it attests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  MAX_SBOM_BYTES,
  SBOM_PREDICATE_TYPE,
  platformDigest,
  sbomProblem,
  spdxDocument,
} from "../scripts/release-image.mjs";

const IMAGE = "sha256:" + "a".repeat(64);
const ATTESTATION = "sha256:" + "b".repeat(64);

// The shape BuildKit pushes for one architecture with an SBOM and provenance.
const PUSHED = {
  mediaType: "application/vnd.oci.image.index.v1+json",
  manifests: [
    {
      digest: IMAGE,
      platform: { architecture: "arm64", os: "linux" },
    },
    {
      digest: ATTESTATION,
      platform: { architecture: "unknown", os: "unknown" },
      annotations: {
        "vnd.docker.reference.digest": IMAGE,
        "vnd.docker.reference.type": "attestation-manifest",
      },
    },
  ],
};

test("the pull-back takes the architecture's image, not the attestation", () => {
  assert.equal(platformDigest(PUSHED, "arm64"), IMAGE);
  assert.throws(
    () => platformDigest(PUSHED, "amd64"),
    /one linux\/amd64 image in the index, found 0/,
  );
  // An attestation claiming a real platform is still not the image.
  const disguised = structuredClone(PUSHED);
  disguised.manifests[1].platform = { architecture: "arm64", os: "linux" };
  assert.equal(platformDigest(disguised, "arm64"), IMAGE);
});

test("a pushed image without attestations is refused", () => {
  assert.throws(
    () =>
      platformDigest(
        { mediaType: "application/vnd.oci.image.manifest.v1+json", layers: [] },
        "arm64",
      ),
    /Expected an image index/,
  );
  const twice = structuredClone(PUSHED);
  twice.manifests.push({ ...PUSHED.manifests[0], digest: ATTESTATION });
  assert.throws(() => platformDigest(twice, "arm64"), /found 2/);
});

const SPDX = {
  spdxVersion: "SPDX-2.3",
  name: "sbom",
  packages: [{ name: "curl", versionInfo: "8.14.1" }],
};

test("the SPDX document is read from one platform or picked from several", () => {
  assert.equal(spdxDocument({ SPDX }), SPDX);
  const both = { "linux/amd64": { SPDX }, "linux/arm64": { SPDX: { x: 1 } } };
  assert.equal(spdxDocument(both, "amd64"), SPDX);
  assert.throws(
    () => spdxDocument(both),
    /linux\/amd64, linux\/arm64; pass --arch/,
  );
  assert.throws(() => spdxDocument({}), /no SPDX SBOM/);
  assert.throws(() => spdxDocument(null), /no SPDX SBOM/);
});

test("only an SPDX 2.3 SBOM with packages, within the limit, is attested", () => {
  assert.equal(sbomProblem(SPDX, 1000), null);
  assert.equal(sbomProblem(SPDX, MAX_SBOM_BYTES), null);
  assert.match(sbomProblem(SPDX, MAX_SBOM_BYTES + 1), /at most 16 MB/);
  assert.match(
    sbomProblem({ ...SPDX, spdxVersion: "SPDX-2.2" }, 1000),
    /Expected SPDX-2\.3, got SPDX-2\.2/,
  );
  assert.match(sbomProblem({ ...SPDX, packages: [] }, 1000), /no packages/);
});

test("the release workflow attests, and verifies, what the helpers produce", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  // Every architecture is built with an SBOM and full provenance.
  assert.match(workflow, /^\s+sbom: true$/m);
  assert.match(workflow, /^\s+provenance: mode=max$/m);
  assert.doesNotMatch(workflow, /provenance: false/);
  // The verify step checks provenance and the SBOM predicate the helper
  // insists on.
  assert.match(workflow, /gh attestation verify "oci:\/\/\$IMAGE@\$DIGEST"/);
  assert.match(workflow, /--predicate-type "\$predicate"/);
  assert.ok(
    workflow.includes(
      `for predicate in https://slsa.dev/provenance/v1 ${SBOM_PREDICATE_TYPE}; do`,
    ),
  );
  // Only the publish job can mint attestations.
  const jobs = workflow.split(/^  (?=[a-z]+:$)/m);
  const holders = jobs
    .filter((job) => /id-token: write|attestations: write/.test(job))
    .map((job) => job.split(":")[0]);
  assert.deepEqual(holders, ["publish"]);
  const publish = jobs.find((job) => job.startsWith("publish:"));
  assert.match(publish, /id-token: write/);
  assert.match(publish, /attestations: write/);
});

test("only the publish job signs, and it verifies the documented identity", () => {
  // US-92.4: a rehearsal never reaches the publish job, so it signs nothing.
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  const jobs = workflow.split(/^  (?=[a-z]+:$)/m).slice(1);
  const signers = jobs
    .filter((job) => /cosign/.test(job))
    .map((job) => job.split(":")[0]);
  assert.deepEqual(signers, ["publish"]);
  const publish = jobs.find((job) => job.startsWith("publish:"));
  assert.match(
    publish,
    /if: github\.event_name == 'push' && github\.ref_type == 'tag'/,
  );
  // The installer is pinned like every action, and so is the cosign it installs.
  assert.match(
    publish,
    /uses: sigstore\/cosign-installer@[0-9a-f]{40} # v\d+\.\d+\.\d+\n\s+with:\n\s+cosign-release: v\d+\.\d+\.\d+\n/,
  );
  assert.match(publish, /cosign sign --yes "\$IMAGE@\$DIGEST"/);
  // https://github.com/dbracewell/Asterism/.github/workflows/release.yml@refs/tags/v*
  const identity = publish.match(
    /--certificate-identity-regexp '([^']+)'/,
  )?.[1];
  assert.ok(identity, "cosign verify checks the signer's identity");
  const signer = new RegExp(identity);
  const base =
    "https://github.com/dbracewell/Asterism/.github/workflows/release.yml@";
  assert.ok(signer.test(`${base}refs/tags/v0.2.2`));
  assert.ok(!signer.test(`${base}refs/heads/main`));
  assert.ok(
    !signer.test(
      "https://github.com/someone/Asterism/.github/workflows/release.yml@refs/tags/v0.2.2",
    ),
  );
  assert.ok(
    !signer.test(
      "https://github.com/dbracewell/Asterism/.github/workflows/ci.yml@refs/tags/v0.2.2",
    ),
  );
  assert.match(
    publish,
    /--certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/,
  );
});
