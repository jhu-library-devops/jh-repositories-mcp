/**
 * Public-content guard. The documentation site is published from a public
 * repository, so its sources must not name private infrastructure: AWS
 * account IDs, resource IDs, private IP addresses, or internal hostnames.
 *
 *   bun run docs:public           scan the site's Markdown sources
 *   bun run docs:public <dir>     also scan built output (HTML, JS, JSON)
 */

// External libraries
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Internal modules
import { DocsScriptError, REPO_ROOT, UNPUBLISHED_DOC_DIRS, markdownFiles } from "./lib";

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
}

const RULES: readonly Rule[] = [
  { name: "AWS account ID", pattern: /(?<![\w.-])\d{12}(?![\w.-])/g },
  {
    name: "AWS resource ID",
    pattern: /\b(?:sg|subnet|vpc|vpce|eni|igw|nat|rtb|i)-[0-9a-f]{8,17}\b/g,
  },
  {
    name: "private IPv4 address",
    pattern: /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g,
  },
  { name: "internal hostname", pattern: /\b[\w-]+(?:\.[\w-]+)*\.(?:internal|local|lan|corp)\b/g },
  { name: "internal load balancer", pattern: /\binternal-[\w-]+\.[\w.-]*elb\.amazonaws\.com\b/g },
];

function siteSources(): string[] {
  return markdownFiles("docs/**/*.md").filter(
    (path) => !UNPUBLISHED_DOC_DIRS.some((dir) => path.startsWith(dir)),
  );
}

/**
 * Built files that carry page content: rendered HTML, per-page chunks
 * (`*.md.<hash>.js`), and the local search index. Framework and vendor
 * bundles are skipped; their minified identifiers produce false matches and
 * they contain no repository content.
 */
function builtFiles(dir: string): string[] {
  const glob = new Bun.Glob("**/*.{html,js}");
  return [...glob.scanSync({ cwd: join(REPO_ROOT, dir), onlyFiles: true })]
    .filter(
      (path) =>
        path.endsWith(".html") ||
        /\.md\.[\w-]+\.js$/.test(path) ||
        path.includes("localSearchIndex"),
    )
    .map((path) => `${dir}/${path}`)
    .sort();
}

function scan(path: string): string[] {
  const text = readFileSync(join(REPO_ROOT, path), "utf8");
  const findings: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of RULES) {
      for (const match of line.matchAll(rule.pattern)) {
        findings.push(`${path}:${index + 1}: ${rule.name} "${match[0]}"`);
      }
    }
  }
  return findings;
}

function main(): number {
  const builtDir = process.argv[2];
  const files = [...siteSources(), ...(builtDir === undefined ? [] : builtFiles(builtDir))];
  const findings = files.flatMap(scan);
  if (findings.length > 0) {
    console.error(
      [
        "Published documentation names private infrastructure:",
        ...findings.map((finding) => `  - ${finding}`),
        "Remove the value, or describe it without the identifier.",
      ].join("\n"),
    );
    return 1;
  }
  console.info(
    `docs: ${files.length} published files contain no private infrastructure identifiers`,
  );
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
