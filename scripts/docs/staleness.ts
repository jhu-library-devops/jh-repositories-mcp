/**
 * Freshness sweep. Every hand-written page declares the code it describes
 * (`sources:`) and the date it was last checked against that code
 * (`verified:`). A page is stale when a source changed after that date, and
 * due for review when it has not been verified for MAX_AGE_DAYS.
 *
 *   bun run docs:stale                     print the report
 *   bun run docs:stale --output report.md  also write it to a file
 *   bun run docs:stale --strict            exit 1 when any page needs attention
 */

// External libraries
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Internal modules
import { DocsScriptError, REPO_ROOT, expandSource, git, handWrittenPages, parsePage } from "./lib";

const MAX_AGE_DAYS = 90;
const MS_PER_DAY = 86_400_000;

/** Pages that are append-only records rather than descriptions of current code. */
const EXEMPT_PREFIXES: readonly string[] = ["docs/adr/"];

interface StalePage {
  readonly status: "stale";
  readonly path: string;
  readonly verified: string;
  readonly changes: readonly { readonly file: string; readonly date: string }[];
}

interface OverduePage {
  readonly status: "overdue";
  readonly path: string;
  readonly verified: string;
  readonly ageDays: number;
}

interface UntrackedPage {
  readonly status: "untracked";
  readonly path: string;
  readonly reason: string;
}

type PageFinding = StalePage | OverduePage | UntrackedPage;

function changesSince(files: readonly string[], verified: string): StalePage["changes"] {
  if (files.length === 0) {
    return [];
  }
  const changes = new Map<string, string>();
  for (const file of files) {
    const date = git(["log", "-1", "--format=%cs", `--since=${verified}T23:59:59`, "--", file]);
    if (date.length > 0) {
      changes.set(file, date);
    }
  }
  return [...changes.entries()].map(([file, date]) => ({ file, date }));
}

function examine(path: string, today: Date): PageFinding | null {
  const { sources, verified } = parsePage(path).frontMatter;
  if (sources.length === 0) {
    return { status: "untracked", path, reason: "no `sources:` in front matter" };
  }
  if (verified === null) {
    return { status: "untracked", path, reason: "no `verified:` date in front matter" };
  }
  const files = [...new Set(sources.flatMap(expandSource))];
  const changes = changesSince(files, verified);
  if (changes.length > 0) {
    return { status: "stale", path, verified, changes };
  }
  const ageDays = Math.floor((today.getTime() - Date.parse(`${verified}T00:00:00Z`)) / MS_PER_DAY);
  if (ageDays > MAX_AGE_DAYS) {
    return { status: "overdue", path, verified, ageDays };
  }
  return null;
}

function render(findings: readonly PageFinding[], checked: number): string {
  if (findings.length === 0) {
    return `All ${checked} tracked documentation pages are current.\n`;
  }
  const lines: string[] = [
    `${findings.length} of ${checked} documentation pages need attention.`,
    "",
    "For each page: re-read it against its sources, fix anything that no longer matches the code, then set `verified:` to today's date in its front matter.",
  ];
  const stale = findings.filter((finding): finding is StalePage => finding.status === "stale");
  if (stale.length > 0) {
    lines.push("", "## Sources changed after verification", "");
    for (const page of stale) {
      lines.push(`- [ ] \`${page.path}\` (verified ${page.verified})`);
      for (const change of page.changes) {
        lines.push(`  - \`${change.file}\` changed ${change.date}`);
      }
    }
  }
  const overdue = findings.filter(
    (finding): finding is OverduePage => finding.status === "overdue",
  );
  if (overdue.length > 0) {
    lines.push("", `## Not verified in over ${MAX_AGE_DAYS} days`, "");
    for (const page of overdue) {
      lines.push(`- [ ] \`${page.path}\` (verified ${page.verified}, ${page.ageDays} days ago)`);
    }
  }
  const untracked = findings.filter(
    (finding): finding is UntrackedPage => finding.status === "untracked",
  );
  if (untracked.length > 0) {
    lines.push("", "## Missing freshness metadata", "");
    for (const page of untracked) {
      lines.push(`- [ ] \`${page.path}\`: ${page.reason}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main(): number {
  const pages = handWrittenPages().filter(
    (path) => !EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix)),
  );
  const today = new Date();
  const findings = pages
    .map((path) => examine(path, today))
    .filter((finding): finding is PageFinding => finding !== null);
  const report = render(findings, pages.length);
  console.info(report.trimEnd());
  const output = argValue("--output");
  if (output !== undefined) {
    writeFileSync(join(REPO_ROOT, output), report);
  }
  return process.argv.includes("--strict") && findings.length > 0 ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof DocsScriptError) {
    console.error(`docs: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
