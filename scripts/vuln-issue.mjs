#!/usr/bin/env node
/**
 * Opens or updates the one vulnerability issue from a weekly scan (US-92.2).
 *
 * Reads a report written by `check-vulns.mjs --report`. When the scan found a
 * critical with a fix that the open `vulnerability-scan` issue doesn't list yet,
 * it opens that issue, or updates its list and comments on what is new. A scan
 * with nothing new changes nothing; a maintainer closes the issue once the fix
 * ships. Uses the gh CLI, with GH_TOKEN from the workflow.
 *
 * Usage: node scripts/vuln-issue.mjs --report <file> [--run-url <url>] [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { classify, table } from "./check-vulns.mjs";

export const LABEL = "vulnerability-scan";
export const TITLE = "Fixable critical vulnerabilities in the published image";
const MARKER = /<!-- vulnerability-scan: (.*?) -->/;

/** A finding's identity for "is this new": the vulnerability and the package. */
export function findingKey(finding) {
  return `${finding.id} ${finding.package}`;
}

/** The keys an issue body records, from its hidden marker. */
export function recordedKeys(body) {
  const match = (body ?? "").match(MARKER);
  if (!match) return new Set();
  return new Set(JSON.parse(match[1]));
}

/** The issue body listing the current fixable criticals. */
export function issueBody({ scanned, date, runUrl }, blocking) {
  const keys = [...new Set(blocking.map(findingKey))].sort();
  return [
    `The weekly scan of \`${scanned}\` on ${date} found ${blocking.length} critical ${blocking.length === 1 ? "vulnerability" : "vulnerabilities"} with a fix.${runUrl ? ` [Scan run](${runUrl}).` : ""}`,
    "",
    "```",
    table(blocking),
    "```",
    "",
    "Update the dependency or the base image digest, check it passes CI, and cut a patch release. To accept a finding instead, add it to `.trivyignore.yaml` with a `statement` and an `expired_at` date. Close this issue once the release that fixes it is published.",
    "",
    `<!-- vulnerability-scan: ${JSON.stringify(keys)} -->`,
  ].join("\n");
}

/**
 * What to do with the issue: nothing, open it, or update it. `issue` is the open
 * issue ({ number, body }) or null.
 */
export function planIssue(report, issue) {
  const { blocking } = classify(report.findings);
  if (blocking.length === 0)
    return { action: "none", reason: "no critical with a fix" };
  const body = issueBody(report, blocking);
  if (!issue) return { action: "create", title: TITLE, body };
  const recorded = recordedKeys(issue.body);
  const fresh = blocking.filter(
    (finding) => !recorded.has(findingKey(finding)),
  );
  if (fresh.length === 0) {
    return {
      action: "none",
      reason: `issue #${issue.number} already lists every one`,
    };
  }
  return {
    action: "update",
    number: issue.number,
    body,
    comment: [
      `New since the issue was last updated (${report.date}):`,
      "",
      "```",
      table(fresh),
      "```",
    ].join("\n"),
  };
}

function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function main() {
  const { values } = parseArgs({
    options: {
      report: { type: "string" },
      "run-url": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (!values.report)
    throw new Error("Pass --report <file> from check-vulns.mjs.");
  const report = {
    ...JSON.parse(readFileSync(values.report, "utf8")),
    runUrl: values["run-url"],
  };
  const [issue] = JSON.parse(
    gh([
      "issue",
      "list",
      "--label",
      LABEL,
      "--state",
      "open",
      "--json",
      "number,body",
      "--limit",
      "1",
    ]) || "[]",
  );
  const plan = planIssue(report, issue ?? null);
  if (plan.action === "none") {
    console.log(`No issue change: ${plan.reason}.`);
    return;
  }
  if (values["dry-run"]) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "asterism-vuln-issue-"));
  try {
    const bodyFile = join(directory, "body.md");
    writeFileSync(bodyFile, plan.body);
    if (plan.action === "create") {
      gh([
        "label",
        "create",
        LABEL,
        "--color",
        "B60205",
        "--description",
        "Found by the weekly image scan",
        "--force",
      ]);
      console.log(
        gh([
          "issue",
          "create",
          "--title",
          plan.title,
          "--label",
          LABEL,
          "--body-file",
          bodyFile,
        ]).trim(),
      );
    } else {
      gh(["issue", "edit", String(plan.number), "--body-file", bodyFile]);
      const commentFile = join(directory, "comment.md");
      writeFileSync(commentFile, plan.comment);
      gh(["issue", "comment", String(plan.number), "--body-file", commentFile]);
      console.log(`Updated issue #${plan.number}.`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
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
