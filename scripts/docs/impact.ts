/**
 * Advisory doc-impact report for a pull request: lists hand-written pages
 * whose declared `sources:` changed while the page itself did not. Never
 * fails the build; the CI workflow posts the report as a PR comment.
 *
 *   bun run docs:impact --base origin/main [--output comment.md]
 */

// External libraries
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Internal modules
import { DocsScriptError, REPO_ROOT, git, handWrittenPages, parsePage } from "./lib";
import { matchingFiles } from "./sources";

/** Hidden marker the workflow uses to find and update its own comment. */
export const COMMENT_MARKER = "<!-- docs-impact-report -->";

interface ImpactedPage {
  readonly path: string;
  readonly changedSources: readonly string[];
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function impactedPages(changed: readonly string[]): ImpactedPage[] {
  const changedSet = new Set(changed);
  return handWrittenPages()
    .filter((path) => !changedSet.has(path))
    .map((path) => ({
      path,
      changedSources: matchingFiles(parsePage(path).frontMatter.sources, changed),
    }))
    .filter((page) => page.changedSources.length > 0);
}

function render(pages: readonly ImpactedPage[]): string {
  if (pages.length === 0) {
    return [
      COMMENT_MARKER,
      "### Documentation impact",
      "",
      "No hand-written documentation pages describe the files this pull request changes, or every such page was updated here.",
      "",
    ].join("\n");
  }
  const lines = [
    COMMENT_MARKER,
    "### Documentation impact",
    "",
    "This pull request changes code that these pages describe. Check that each page is still accurate. If it is, no change is needed; if you update it, also set `verified:` to today in its front matter. This check is advisory and does not block merging.",
    "",
  ];
  for (const page of pages) {
    lines.push(`- [ ] \`${page.path}\``);
    for (const source of page.changedSources) {
      lines.push(`  - \`${source}\``);
    }
  }
  lines.push(
    "",
    "Generated reference pages are checked separately by `bun run docs:generate --check`.",
    "",
  );
  return lines.join("\n");
}

function main(): number {
  const base = argValue("--base") ?? "origin/main";
  const changed = git(["diff", "--name-only", `${base}...HEAD`])
    .split("\n")
    .filter((line) => line.length > 0);
  const report = render(impactedPages(changed));
  console.info(report.trimEnd());
  const output = argValue("--output");
  if (output !== undefined) {
    writeFileSync(join(REPO_ROOT, output), report);
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof DocsScriptError) {
    // Advisory: report the problem, never fail the pull request.
    console.error(`docs: impact report unavailable: ${error.message}`);
    process.exitCode = 0;
  } else {
    throw error;
  }
}
