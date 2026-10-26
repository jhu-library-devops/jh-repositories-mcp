/**
 * Generate the reference pages under docs/reference/ and refresh every
 * `<!-- docs:inject NAME -->` region in hand-written Markdown.
 *
 *   bun run docs:generate           write the generated output
 *   bun run docs:generate --check   fail if anything committed is out of date
 */

// External libraries
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Internal modules
import { generateConfiguration } from "./generators/configuration";
import { generateErrors } from "./generators/errors";
import { generateInfrastructure } from "./generators/infrastructure";
import { generateMcpSurface } from "./generators/mcp-surface";
import { generateRepositories } from "./generators/repositories";
import { DocsScriptError, REPO_ROOT, markdownFiles } from "./lib";
import { applyRegions } from "./regions";

// Type imports
import type { Generated, GeneratedFile, InjectedRegion } from "./generators/types";

/** Hand-written files that may contain injected regions. */
const INJECTION_TARGETS: readonly string[] = [
  "README.md",
  "CLAUDE.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "ONBOARDING.md",
];

function injectionTargets(): string[] {
  const docs = markdownFiles("docs/**/*.md").filter((path) => !path.startsWith("docs/reference/"));
  return [...INJECTION_TARGETS, ...docs].filter((path) => existsSync(join(REPO_ROOT, path)));
}

async function collect(): Promise<Generated[]> {
  return [
    await generateMcpSurface(),
    generateConfiguration(),
    generateRepositories(),
    generateErrors(),
    generateInfrastructure(),
  ];
}

function expectedOutputs(results: readonly Generated[]): GeneratedFile[] {
  const files = results.flatMap((result) => result.files);
  const regions = new Map<string, string>();
  for (const region of results.flatMap((result): readonly InjectedRegion[] => result.regions)) {
    if (regions.has(region.name)) {
      throw new DocsScriptError(`Injected region "${region.name}" is produced twice`);
    }
    regions.set(region.name, region.content);
  }
  const injected: GeneratedFile[] = injectionTargets().map((path) => {
    const current = readFileSync(join(REPO_ROOT, path), "utf8");
    return { path, content: applyRegions(path, current, regions) };
  });
  return [...files, ...injected];
}

async function main(): Promise<number> {
  const check = process.argv.includes("--check");
  const outputs = expectedOutputs(await collect());
  const stale: string[] = [];
  for (const output of outputs) {
    const absolute = join(REPO_ROOT, output.path);
    const current = existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
    if (current === output.content) {
      continue;
    }
    if (check) {
      stale.push(output.path);
    } else {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, output.content);
      console.info(`docs: wrote ${output.path}`);
    }
  }
  if (stale.length > 0) {
    console.error(
      [
        "Generated documentation is out of date:",
        ...stale.map((path) => `  - ${path}`),
        "Run `bun run docs:generate` and commit the result.",
      ].join("\n"),
    );
    return 1;
  }
  if (check) {
    console.info(`docs: ${outputs.length} generated outputs are current`);
  }
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof DocsScriptError) {
    console.error(`docs: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
