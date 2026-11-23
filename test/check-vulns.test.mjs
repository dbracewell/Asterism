// The vulnerability scan policy, its ignore file and the weekly issue (US-92.2;
// fixable highs fail from US-95.5).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  classify,
  findingsFrom,
  ignoreFileProblems,
  packageCount,
  summary,
  utcToday,
} from "../scripts/check-vulns.mjs";
import {
  TRIVY_TARBALLS,
  hashProblem,
  tarballFor,
} from "../scripts/install-trivy.mjs";
import { issueBody, planIssue, recordedKeys } from "../scripts/vuln-issue.mjs";

const TODAY = "2026-11-21";

function vulnerability(
  id,
  severity,
  fixed = "",
  pkg = "pkg",
  installed = "1.0.0",
) {
  return {
    VulnerabilityID: id,
    PkgName: pkg,
    InstalledVersion: installed,
    FixedVersion: fixed,
    Severity: severity,
    Title: `${id} title`,
  };
}

const REPORT = {
  ArtifactName: "asterism:ci",
  Results: [
    {
      Target: "asterism:ci (debian 13.2)",
      Packages: [{ Name: "openssl" }, { Name: "zlib" }],
      Vulnerabilities: [
        vulnerability("CVE-1", "CRITICAL", "3.0.1", "openssl"),
        vulnerability("CVE-2", "CRITICAL", "", "zlib"),
        vulnerability("CVE-3", "HIGH", "2.0.0", "zlib"),
        vulnerability("CVE-4", "MEDIUM", "2.0.0", "zlib"),
      ],
    },
    {
      Target: "app/node_modules",
      Packages: [{ Name: "openssl" }],
      // The same finding reached from a second target counts once.
      Vulnerabilities: [vulnerability("CVE-1", "CRITICAL", "3.0.1", "openssl")],
    },
    { Target: "clean", Packages: [{ Name: "a" }] },
  ],
};

test("an ignore entry needs an id, a statement and an expiry still to come", () => {
  const text = [
    "vulnerabilities:",
    "  - id: CVE-ok",
    "    statement: not reachable",
    "    expired_at: 2026-12-01",
    "  - id: CVE-no-statement",
    "    expired_at: 2026-12-01",
    "  - id: CVE-no-expiry",
    "    statement: later",
    "  - id: CVE-today",
    "    statement: due",
    `    expired_at: ${TODAY}`,
    "  - id: CVE-past",
    "    statement: old",
    "    expired_at: 2026-01-01",
    "  - id: CVE-bad-date",
    "    statement: typo",
    "    expired_at: 2026-02-30",
    "  - statement: no id",
    "    expired_at: 2026-12-01",
    "secrets:",
    "  - id: aws-access-key-id",
    "    statement: test fixture",
    "    expired_at: 2027-01-01",
    "unknown: []",
  ].join("\n");
  assert.deepEqual(ignoreFileProblems(text, "f", TODAY), [
    "f: vulnerabilities[1] (CVE-no-statement) has no statement saying why it is accepted",
    "f: vulnerabilities[2] (CVE-no-expiry) has no expired_at date",
    `f: vulnerabilities[3] (CVE-today) expired on ${TODAY}; fix it, or renew it with a new reason and date`,
    "f: vulnerabilities[4] (CVE-past) expired on 2026-01-01; fix it, or renew it with a new reason and date",
    "f: vulnerabilities[5] (CVE-bad-date) has expired_at 2026-02-30, not a YYYY-MM-DD date",
    "f: vulnerabilities[6] has no id",
    "f: unknown section unknown (expected vulnerabilities, misconfigurations, secrets, licenses)",
  ]);
});

test("an empty or comment-only ignore file is fine, and bad layouts are problems", () => {
  assert.deepEqual(ignoreFileProblems("", "f", TODAY), []);
  assert.deepEqual(
    ignoreFileProblems("# nothing\nvulnerabilities: []\n", "f", TODAY),
    [],
  );
  assert.deepEqual(ignoreFileProblems("vulnerabilities:\n", "f", TODAY), []);
  assert.deepEqual(ignoreFileProblems("- CVE-1\n", "f", TODAY), [
    "f: expected a mapping of vulnerabilities, misconfigurations, secrets, licenses",
  ]);
  assert.deepEqual(ignoreFileProblems("vulnerabilities: CVE-1\n", "f", TODAY), [
    "f: vulnerabilities is not a list",
  ]);
  assert.deepEqual(
    ignoreFileProblems("vulnerabilities:\n  - CVE-1\n", "f", TODAY),
    ["f: vulnerabilities[0] is not a mapping"],
  );
  assert.match(
    ignoreFileProblems("vulnerabilities: [\n", "f", TODAY)[0],
    /^f: not valid YAML/,
  );
});

test("the repository's ignore file passes", () => {
  assert.deepEqual(
    ignoreFileProblems(readFileSync(".trivyignore.yaml", "utf8")),
    [],
  );
});

test("utcToday reads the UTC date", () => {
  assert.equal(utcToday(new Date("2026-11-21T23:30:00-05:00")), "2026-11-22");
});

test("findings are deduplicated, and fixable criticals and highs fail", () => {
  const findings = findingsFrom([REPORT]);
  assert.deepEqual(
    findings.map((f) => f.id),
    ["CVE-1", "CVE-2", "CVE-3", "CVE-4"],
  );
  const { blocking, unfixedCriticals, highs } = classify(findings);
  assert.deepEqual(
    blocking.map((f) => f.id),
    ["CVE-1", "CVE-3"],
  );
  assert.deepEqual(
    unfixedCriticals.map((f) => f.id),
    ["CVE-2"],
  );
  assert.deepEqual(
    highs.map((f) => f.id),
    ["CVE-3"],
  );
  assert.equal(packageCount([REPORT]), 4);
  assert.equal(packageCount([{ Results: [{ Target: "x" }] }]), 0);
  assert.equal(packageCount([{}]), 0);
});

test("the summary fails on a fixable critical or high and prints the highs", () => {
  const failing = summary(findingsFrom([REPORT]), "asterism:ci");
  assert.equal(failing.failed, true);
  assert.match(
    failing.text,
    /^asterism:ci: 2 critical or high vulnerabilities have a fix:\nID +Package +Installed +Fixed in +Where\nCVE-1 +openssl +1\.0\.0 +3\.0\.1 +asterism:ci \(debian 13\.2\)\nCVE-3 +zlib +1\.0\.0 +2\.0\.0/,
  );
  assert.match(
    failing.text,
    /Criticals with no fix yet \(not failing\):\n.*\nCVE-2 +zlib +1\.0\.0 +\(no fix\)/,
  );
  assert.match(failing.text, /Highs \(1\):\n.*\nCVE-3 +zlib/);
  assert.doesNotMatch(failing.text, /CVE-4/);

  const fixableHigh = summary(
    findingsFrom([
      { Results: [{ Vulnerabilities: [vulnerability("CVE-5", "HIGH", "1")] }] },
    ]),
    "x",
  );
  assert.equal(fixableHigh.failed, true);
  assert.match(
    fixableHigh.text,
    /^x: 1 critical or high vulnerability has a fix:\n.*\nCVE-5 +pkg +1\.0\.0 +1\n/,
  );

  // A high with no fix, a medium or a low with a fix, and a critical with no
  // fix are reported without failing.
  const passing = summary(
    findingsFrom([
      {
        Results: [
          {
            Vulnerabilities: [
              vulnerability("CVE-6", "HIGH"),
              vulnerability("CVE-7", "MEDIUM", "2"),
              vulnerability("CVE-8", "LOW", "2"),
              vulnerability("CVE-9", "CRITICAL"),
            ],
          },
        ],
      },
    ]),
    "x",
  );
  assert.equal(passing.failed, false);
  assert.match(
    passing.text,
    /^x: no critical or high vulnerability with a fix\./,
  );
  assert.match(
    passing.text,
    /Highs \(1\):\n.*\nCVE-6 +pkg +1\.0\.0 +\(no fix\)/,
  );
  assert.match(
    passing.text,
    /Criticals with no fix yet \(not failing\):\n.*\nCVE-9/,
  );
  assert.equal(
    summary([], "x").text,
    "x: no critical or high vulnerability with a fix.\n\nNo highs.",
  );
});

test("an accepted high follows the same ignore rules as a critical", () => {
  // Entries carry no severity: Trivy drops an accepted finding before the
  // summary, so a high listed with a reason and a future expiry stops failing.
  const accepted = [
    "vulnerabilities:",
    "  - id: CVE-2026-85091",
    "    statement: zlib1g high; gzwrite is never called in non-blocking mode",
    "    expired_at: 2026-12-01",
  ].join("\n");
  assert.deepEqual(ignoreFileProblems(accepted, "f", TODAY), []);
  assert.deepEqual(
    ignoreFileProblems(accepted.replace(/\n.*statement.*$/m, ""), "f", TODAY),
    [
      "f: vulnerabilities[0] (CVE-2026-85091) has no statement saying why it is accepted",
    ],
  );
  assert.deepEqual(ignoreFileProblems(accepted, "f", "2026-12-01"), [
    "f: vulnerabilities[0] (CVE-2026-85091) expired on 2026-12-01; fix it, or renew it with a new reason and date",
  ]);
  const remaining = findingsFrom([REPORT]).filter((f) => f.id !== "CVE-3");
  assert.deepEqual(
    classify(remaining).blocking.map((f) => f.id),
    ["CVE-1"],
  );
});

test("Trivy is pinned for the runners, and a tarball with another hash is refused", () => {
  assert.deepEqual(Object.keys(TRIVY_TARBALLS).sort(), [
    "darwin-arm64",
    "linux-arm64",
    "linux-x64",
  ]);
  for (const { sha256 } of Object.values(TRIVY_TARBALLS))
    assert.match(sha256, /^[0-9a-f]{64}$/);
  const tarball = tarballFor("linux", "x64", "1.2.3");
  assert.equal(
    tarball.url,
    "https://github.com/aquasecurity/trivy/releases/download/v1.2.3/trivy_1.2.3_Linux-64bit.tar.gz",
  );
  assert.throws(
    () => tarballFor("win32", "x64"),
    /No pinned Trivy for win32-x64; pinned: linux-x64, linux-arm64, darwin-arm64/,
  );
  const empty =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  assert.equal(hashProblem(Buffer.alloc(0), empty, "t"), null);
  assert.match(
    hashProblem(Buffer.from("x"), empty, "t"),
    /^t has SHA-256 [0-9a-f]{64}, not the pinned e3b0.*Not installing it\.$/,
  );
});

const SCAN = {
  scanned: "ghcr.io/dbracewell/asterism:latest",
  date: TODAY,
  runUrl: "https://example.test/run/1",
};

function scan(...vulnerabilities) {
  return {
    ...SCAN,
    findings: findingsFrom([
      { Results: [{ Target: "t", Vulnerabilities: vulnerabilities }] },
    ]),
  };
}

test("the weekly issue opens for a fixable critical or high and changes only for a new one", () => {
  assert.deepEqual(
    planIssue(
      scan(vulnerability("CVE-2", "CRITICAL"), vulnerability("CVE-3", "HIGH")),
      null,
    ),
    {
      action: "none",
      reason: "no critical or high with a fix",
    },
  );

  const high = planIssue(
    scan(vulnerability("CVE-3", "HIGH", "1", "zlib")),
    null,
  );
  assert.equal(high.action, "create");
  assert.equal(
    high.title,
    "Fixable critical or high vulnerabilities in the published image",
  );
  assert.match(
    high.body,
    /found 1 critical or high vulnerability with a fix\./,
  );
  assert.deepEqual([...recordedKeys(high.body)], ["CVE-3 zlib"]);

  const first = planIssue(
    scan(vulnerability("CVE-1", "CRITICAL", "2.0.0", "openssl")),
    null,
  );
  assert.equal(first.action, "create");
  assert.match(
    first.body,
    /^The weekly scan of `ghcr\.io\/dbracewell\/asterism:latest` on 2026-11-21 found 1 critical or high vulnerability with a fix\. \[Scan run\]\(https:\/\/example\.test\/run\/1\)\./,
  );
  assert.deepEqual([...recordedKeys(first.body)], ["CVE-1 openssl"]);

  const issue = { number: 7, body: first.body };
  // The same finding at a new installed version is not new.
  assert.deepEqual(
    planIssue(
      scan(vulnerability("CVE-1", "CRITICAL", "2.0.0", "openssl", "1.0.1")),
      issue,
    ),
    {
      action: "none",
      reason: "issue #7 already lists every one",
    },
  );

  const later = planIssue(
    scan(
      vulnerability("CVE-1", "CRITICAL", "2.0.0", "openssl"),
      vulnerability("CVE-9", "CRITICAL", "5", "zlib"),
    ),
    issue,
  );
  assert.equal(later.action, "update");
  assert.equal(later.number, 7);
  assert.deepEqual(
    [...recordedKeys(later.body)],
    ["CVE-1 openssl", "CVE-9 zlib"],
  );
  assert.match(
    later.comment,
    /^New since the issue was last updated \(2026-11-21\):/,
  );
  assert.match(later.comment, /CVE-9/);
  assert.doesNotMatch(later.comment, /CVE-1 /);
});

test("an issue without the marker records nothing", () => {
  assert.deepEqual([...recordedKeys("hand-written")], []);
  assert.deepEqual([...recordedKeys(null)], []);
  assert.match(issueBody(SCAN, []), /<!-- vulnerability-scan: \[\] -->$/);
});
