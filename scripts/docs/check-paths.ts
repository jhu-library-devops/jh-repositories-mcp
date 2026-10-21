/**
 * Fail when documentation cites a repository path that does not exist:
 * inline-code paths such as `src/adapters/index.ts` in maintained Markdown,
 * and every `sources:` entry in page front matter.
 *
 *   bun run docs:paths
 */

// External libraries
import { existsSync } from "node:fs";
import { join } from "node:path";

// Internal modules
import {
  DocsScriptError,
  REPO_ROOT,
  expandSource,
  handWrittenPages,
  markdownFiles,
  parsePage,
} from "./lib";

const ROOT_DOCS: readonly string[] = [
  "README.md",
  "CLAUDE.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "ONBOARDING.md",
  "CONTEXT.md",
];

const CITED_PATH = /`((?:src|config|infra|test|scripts|docs|\.github)\/[^`\s]*)`/g;

/** Placeholders and patterns are illustrative, not citations. */
function isConcrete(path: string): boolean {
  return !/[<>*{}…]/.test(path) && !path.includes("...");
}

function normalize(path: string): string {
  return path.replace(/#.*$/, "").replace(/:\d+(-\d+)?$/, "");
}

function filesToScan(): string[] {
  const docs = markdownFiles("docs/**/*.md").filter((path) => !path.startsWith("docs/spike/"));
  return [...ROOT_DOCS.filter((path) => existsSync(join(REPO_ROOT, path))), ...docs];
}

function main(): number {
  const problems: string[] = [];
  for (const file of filesToScan()) {
    const page = parsePage(file);
    for (const match of page.body.matchAll(CITED_PATH)) {
      const cited = match[1];
      if (cited === undefined || !isConcrete(cited)) {
        continue;
      }
      const target = normalize(cited);
      if (!existsSync(join(REPO_ROOT, target))) {
        problems.push(`${file}: cites \`${cited}\`, which does not exist`);
      }
    }
  }
  for (const file of handWrittenPages()) {
    const page = parsePage(file);
    for (const source of page.frontMatter.sources) {
      if (expandSource(source).length === 0) {
        problems.push(`${file}: front matter source "${source}" matches no files`);
      }
    }
  }
  if (problems.length > 0) {
    console.error(
      ["Documentation cites missing paths:", ...problems.map((p) => `  - ${p}`)].join("\n"),
    );
    return 1;
  }
  console.info("docs: every cited path exists");
  return 0;
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
