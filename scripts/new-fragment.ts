#!/usr/bin/env bun
/**
 * Interactive helper to create a changelog fragment.
 *
 * Usage:
 *   bun run scripts/new-fragment.ts
 *   bun run scripts/new-fragment.ts <name> <type> <message>
 *
 * When called without arguments, prompts interactively.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const FRAGMENT_DIR = join(import.meta.dir, "..", "changelog.d");

const VALID_TYPES = [
  "added",
  "changed",
  "deprecated",
  "removed",
  "fixed",
  "security",
] as const;

type FragmentType = (typeof VALID_TYPES)[number];

function isValidType(value: string): value is FragmentType {
  return VALID_TYPES.includes(value as FragmentType);
}

async function prompt(question: string): Promise<string> {
  process.stdout.write(question);
  for await (const line of console) {
    return line.trim();
  }
  return "";
}

async function main() {
  let name: string;
  let type: string;
  let message: string;

  const [argName, argType, ...rest] = process.argv.slice(2);

  if (argName && argType && rest.length > 0) {
    // Non-interactive mode
    name = argName;
    type = argType;
    message = rest.join(" ");
  } else {
    // Interactive mode
    name = await prompt(
      "Fragment name (issue number or short slug, e.g. 42 or fix-cursor): ",
    );
    if (!name) {
      console.error("Error: name is required.");
      process.exit(1);
    }

    console.log(`\nFragment types: ${VALID_TYPES.join(", ")}`);
    type = await prompt("Type: ");

    message = await prompt("Description (one line): ");
  }

  if (!isValidType(type)) {
    console.error(
      `Error: invalid type "${type}". Must be one of: ${VALID_TYPES.join(", ")}`,
    );
    process.exit(1);
  }

  if (!message) {
    console.error("Error: message is required.");
    process.exit(1);
  }

  // Sanitize name for filesystem
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-");
  const filename = `${safeName}.${type}.md`;
  const filepath = join(FRAGMENT_DIR, filename);

  await writeFile(filepath, `${message}\n`);
  console.log(`Created: changelog.d/${filename}`);
}

main();
