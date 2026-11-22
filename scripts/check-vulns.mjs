#!/usr/bin/env node
/**
 * Scans for known vulnerabilities with the pinned Trivy (US-92.2).
 *
 * Fails on a critical with a fix, prints a table of highs, and lists criticals
 * that have no fix yet without failing on them. Accepted findings live in
 * .trivyignore.yaml, each with a reason (`statement`) and an expiry
 * (`expired_at`); the scan refuses to run while an entry lacks either or has
 * expired. A scan that read no packages fails too, so a Trivy that silently
 * scanned nothing can't pass.
 *
 * Usage:
 *   node scripts/check-vulns.mjs --image <image>     scan a built image
 *   node scripts/check-vulns.mjs --lockfiles         scan pnpm-lock.yaml and uv.lock
 *   node scripts/check-vulns.mjs --ignore-file-only  only check .trivyignore.yaml
 * Options: --report <file> writes the findings as JSON (for scripts/vuln-issue.mjs);
 * --no-fail reports without failing; --trivy <path> (or TRIVY) names the binary.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { isMap, isSeq, parseDocument } from "yaml";

export const IGNORE_FILE = ".trivyignore.yaml";
export const LOCKFILES = ["pnpm-lock.yaml", "apps/backend/uv.lock"];
const IGNORE_SECTIONS = [
  "vulnerabilities",
  "misconfigurations",
  "secrets",
  "licenses",
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today as YYYY-MM-DD in UTC, the way Trivy reads `expired_at`. */
export function utcToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Problems in .trivyignore.yaml: each entry needs an `id`, a `statement` saying
 * why it is accepted, and an `expired_at` date still in the future. Trivy stops
 * ignoring an entry on its `expired_at` day, so that day counts as expired.
 */
export function ignoreFileProblems(
  text,
  file = IGNORE_FILE,
  today = utcToday(),
) {
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    return [
      `${file}: not valid YAML: ${document.errors[0].message.split("\n")[0]}`,
    ];
  }
  const root = document.toJS();
  if (root === null || root === undefined) return [];
  if (!isMap(document.contents)) {
    return [`${file}: expected a mapping of ${IGNORE_SECTIONS.join(", ")}`];
  }
  const problems = [];
  for (const [section, entries] of Object.entries(root)) {
    if (!IGNORE_SECTIONS.includes(section)) {
      problems.push(
        `${file}: unknown section ${section} (expected ${IGNORE_SECTIONS.join(", ")})`,
      );
      continue;
    }
    if (entries === null) continue;
    if (!Array.isArray(entries) || !isSeq(document.get(section))) {
      problems.push(`${file}: ${section} is not a list`);
      continue;
    }
    for (const [index, entry] of entries.entries()) {
      const where = `${file}: ${section}[${index}]`;
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        problems.push(`${where} is not a mapping`);
        continue;
      }
      const label =
        typeof entry.id === "string" && entry.id
          ? `${where} (${entry.id})`
          : where;
      if (typeof entry.id !== "string" || !entry.id.trim())
        problems.push(`${where} has no id`);
      if (typeof entry.statement !== "string" || !entry.statement.trim()) {
        problems.push(`${label} has no statement saying why it is accepted`);
      }
      const expiry = entry.expired_at;
      if (expiry === undefined || expiry === null || expiry === "") {
        problems.push(`${label} has no expired_at date`);
      } else if (
        typeof expiry !== "string" ||
        !DATE.test(expiry) ||
        !isRealDate(expiry)
      ) {
        problems.push(
          `${label} has expired_at ${String(expiry)}, not a YYYY-MM-DD date`,
        );
      } else if (expiry <= today) {
        problems.push(
          `${label} expired on ${expiry}; fix it, or renew it with a new reason and date`,
        );
      }
    }
  }
  return problems;
}

function isRealDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Trivy JSON reports flattened to one finding per vulnerability and package version. */
export function findingsFrom(reports) {
  const findings = new Map();
  for (const report of reports) {
    for (const result of report.Results ?? []) {
      for (const vulnerability of result.Vulnerabilities ?? []) {
        const finding = {
          id: vulnerability.VulnerabilityID,
          package: vulnerability.PkgName,
          installed: vulnerability.InstalledVersion ?? "",
          fixed: vulnerability.FixedVersion ?? "",
          severity: vulnerability.Severity ?? "UNKNOWN",
          title: vulnerability.Title ?? "",
          url: vulnerability.PrimaryURL ?? "",
          target: result.Target ?? report.ArtifactName ?? "",
        };
        const key = `${finding.id}|${finding.package}|${finding.installed}`;
        if (!findings.has(key)) findings.set(key, finding);
      }
    }
  }
  return [...findings.values()].sort(
    (a, b) => a.id.localeCompare(b.id) || a.package.localeCompare(b.package),
  );
}

/** How many packages the reports read (Trivy's --list-all-pkgs output). */
export function packageCount(reports) {
  return reports
    .flatMap((report) => report.Results ?? [])
    .reduce((total, result) => total + (result.Packages?.length ?? 0), 0);
}

/** A finding has a fix when Trivy names a version that fixes it. */
export function isFixable(finding) {
  return finding.fixed.trim() !== "";
}

/** Splits findings into what fails the check, what is printed, and what is noted. */
export function classify(findings) {
  return {
    blocking: findings.filter((f) => f.severity === "CRITICAL" && isFixable(f)),
    unfixedCriticals: findings.filter(
      (f) => f.severity === "CRITICAL" && !isFixable(f),
    ),
    highs: findings.filter((f) => f.severity === "HIGH"),
  };
}

/** A plain-text table of findings. */
export function table(findings) {
  const rows = [
    ["ID", "Package", "Installed", "Fixed in", "Where"],
    ...findings.map((f) => [
      f.id,
      f.package,
      f.installed,
      f.fixed || "(no fix)",
      f.target,
    ]),
  ];
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => row[column].length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column]))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/** The lines the check prints, and whether it fails. */
export function summary(findings, scanned) {
  const { blocking, unfixedCriticals, highs } = classify(findings);
  const lines = [];
  if (blocking.length > 0) {
    lines.push(
      `${scanned}: ${blocking.length} critical ${blocking.length === 1 ? "vulnerability has" : "vulnerabilities have"} a fix:`,
      table(blocking),
      "Update the dependency or base image digest. To accept one instead, add it to .trivyignore.yaml with a statement and an expired_at date.",
    );
  } else {
    lines.push(`${scanned}: no critical vulnerability with a fix.`);
  }
  if (unfixedCriticals.length > 0) {
    lines.push(
      "",
      `Criticals with no fix yet (not failing):`,
      table(unfixedCriticals),
    );
  }
  lines.push(
    "",
    highs.length > 0
      ? `Highs (${highs.length}):\n${table(highs)}`
      : "No highs.",
  );
  return { failed: blocking.length > 0, text: lines.join("\n") };
}

function trivyScan(trivy, args, directory) {
  const output = join(
    directory,
    `report-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  execFileSync(
    trivy,
    [
      ...args,
      "--scanners",
      "vuln",
      "--format",
      "json",
      "--list-all-pkgs",
      "--ignorefile",
      IGNORE_FILE,
      "--timeout",
      "20m",
      "--quiet",
      "--output",
      output,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  return JSON.parse(readFileSync(output, "utf8"));
}

function main() {
  const { values } = parseArgs({
    options: {
      image: { type: "string" },
      lockfiles: { type: "boolean", default: false },
      "ignore-file-only": { type: "boolean", default: false },
      report: { type: "string" },
      "no-fail": { type: "boolean", default: false },
      trivy: { type: "string", default: process.env.TRIVY ?? "trivy" },
    },
  });
  const ignoreProblems = ignoreFileProblems(readFileSync(IGNORE_FILE, "utf8"));
  if (ignoreProblems.length > 0) {
    console.error(ignoreProblems.join("\n"));
    process.exit(1);
  }
  if (values["ignore-file-only"]) {
    console.log(
      `${IGNORE_FILE}: every entry has a reason and an expiry date still to come.`,
    );
    return;
  }
  if (Boolean(values.image) === values.lockfiles) {
    throw new Error(
      "Pass one of --image <image>, --lockfiles or --ignore-file-only.",
    );
  }
  if (values.image && !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(values.image)) {
    throw new Error(`Not an image name: ${values.image}`);
  }
  const directory = mkdtempSync(join(tmpdir(), "asterism-trivy-"));
  try {
    const scans = values.image
      ? [{ scanned: values.image, args: ["image", values.image] }]
      : LOCKFILES.map((file) => ({ scanned: file, args: ["fs", file] }));
    const reports = [];
    for (const scan of scans) {
      const report = trivyScan(values.trivy, scan.args, directory);
      if (packageCount([report]) === 0) {
        throw new Error(
          `Trivy read no packages from ${scan.scanned}, so the scan proves nothing.`,
        );
      }
      reports.push(report);
    }
    const scanned = scans.map((scan) => scan.scanned).join(", ");
    const findings = findingsFrom(reports);
    const result = summary(findings, scanned);
    console.log(result.text);
    if (values.report) {
      writeFileSync(
        values.report,
        `${JSON.stringify({ scanned, date: utcToday(), findings }, null, 2)}\n`,
      );
    }
    if (result.failed && !values["no-fail"]) process.exitCode = 1;
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
