#!/usr/bin/env bun
/**
 * Towncrier-style changelog builder.
 *
 * Reads fragment files from `changelog.d/`, groups them by type,
 * prepends a new release section to `CHANGELOG.md`, and removes
 * consumed fragments.
 *
 * Usage:
 *   bun run scripts/changelog.ts [--version <ver>] [--dry-run]
 *
 * If --version is omitted the version is read from package.json.
 * --dry-run prints the new section without modifying any files.
 */

import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, parse as parsePath } from "node:path";

const FRAGMENT_DIR = join(import.meta.dir, "..", "changelog.d");
const CHANGELOG_PATH = join(import.meta.dir, "..", "CHANGELOG.md");

const VALID_TYPES = [
  "added",
  "changed",
  "deprecated",
  "removed",
  "fixed",
  "security",
] as const;

type FragmentType = (typeof VALID_TYPES)[number];

const TYPE_HEADINGS: Record<FragmentType, string> = {
  added: "Added",
  changed: "Changed",
  deprecated: "Deprecated",
  removed: "Removed",
  fixed: "Fixed",
  security: "Security",
};

interface Fragment {
  type: FragmentType;
  content: string;
  file: string;
}

function parseArgs(): { version: string | null; dryRun: boolean } {
  const args = process.argv.slice(2);
  let version: string | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--version" && args[i + 1]) {
      version = args[++i];
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  return { version, dryRun };
}

async function getVersion(explicit: string | null): Promise<string> {
  if (explicit) return explicit;

  const pkg = JSON.parse(
    await readFile(join(import.meta.dir, "..", "package.json"), "utf-8"),
  );
  if (!pkg.version || pkg.version === "0.0.0") {
    console.error(
      "Error: package.json version is unset. Pass --version explicitly.",
    );
    process.exit(1);
  }
  return pkg.version;
}

async function collectFragments(): Promise<Fragment[]> {
  const entries = await readdir(FRAGMENT_DIR);
  const fragments: Fragment[] = [];

  for (const entry of entries) {
    if (entry === "README.md" || entry === ".gitkeep") continue;

    const { name, ext } = parsePath(entry);
    if (ext !== ".md") continue;

    // name is e.g. "42.fixed" → last segment is the type
    const parts = name.split(".");
    const typePart = parts.pop();

    if (!typePart || !VALID_TYPES.includes(typePart as FragmentType)) {
      console.warn(
        `Warning: skipping "${entry}" – unknown type "${typePart}". ` +
          `Valid types: ${VALID_TYPES.join(", ")}`,
      );
      continue;
    }

    const content = (await readFile(join(FRAGMENT_DIR, entry), "utf-8")).trim();
    if (!content) {
      console.warn(`Warning: skipping "${entry}" – empty content.`);
      continue;
    }

    fragments.push({ type: typePart as FragmentType, content, file: entry });
  }

  return fragments;
}

function buildSection(version: string, fragments: Fragment[]): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [`## [${version}] - ${date}`, ""];

  for (const type of VALID_TYPES) {
    const matching = fragments.filter((f) => f.type === type);
    if (matching.length === 0) continue;

    lines.push(`### ${TYPE_HEADINGS[type]}`, "");
    for (const frag of matching) {
      lines.push(`- ${frag.content}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const { version: explicitVersion, dryRun } = parseArgs();
  const version = await getVersion(explicitVersion);
  const fragments = await collectFragments();

  if (fragments.length === 0) {
    console.log("No changelog fragments found. Nothing to do.");
    process.exit(0);
  }

  const section = buildSection(version, fragments);

  if (dryRun) {
    console.log("--- Dry run: new changelog section ---\n");
    console.log(section);
    console.log(`\n${fragments.length} fragment(s) would be removed.`);
    process.exit(0);
  }

  // Read existing changelog or create stub
  let existing = "";
  try {
    existing = await readFile(CHANGELOG_PATH, "utf-8");
  } catch {
    existing = "# Changelog\n\n";
  }

  // Insert new section after the top-level heading and any preamble text
  // (everything before the first ## or end of file)
  const insertionPoint = existing.search(/^## /m);
  let updated: string;
  if (insertionPoint !== -1) {
    // Insert before the first existing version section
    updated =
      existing.slice(0, insertionPoint) + section + existing.slice(insertionPoint);
  } else {
    // No existing version sections; append after everything
    updated = existing.trimEnd() + "\n\n" + section;
  }

  await writeFile(CHANGELOG_PATH, updated);
  console.log(`Updated CHANGELOG.md with version ${version}`);

  // Remove consumed fragments
  for (const frag of fragments) {
    await unlink(join(FRAGMENT_DIR, frag.file));
  }
  console.log(`Removed ${fragments.length} fragment(s) from changelog.d/`);
}

main();
