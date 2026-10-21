/**
 * Configuration reference, generated from the zod environment schema in
 * src/config/env.ts. Names, requiredness, defaults, and allowed values come
 * from the schema; the descriptions below are the only hand-written part, and
 * the Record type makes the compiler reject a missing or stale entry.
 */

import { z } from "zod";

import { envSchema } from "../../../src/config/env";
import { DocsScriptError, GENERATED_BANNER, code, table } from "../lib";

import type { Generated } from "./types";

type EnvVarName = keyof typeof envSchema.shape;

type EnvGroup =
  | "Service"
  | "JScholarship"
  | "JHRDR"
  | "Edge security"
  | "Timeouts"
  | "Concurrency"
  | "Cache";

interface EnvVarDoc {
  readonly group: EnvGroup;
  readonly format: string;
  readonly description: string;
}

const ENV_DOCS: Readonly<Record<EnvVarName, EnvVarDoc>> = {
  PORT: { group: "Service", format: "port (1–65535)", description: "HTTP listen port." },
  ENVIRONMENT: {
    group: "Service",
    format: "enum",
    description: "Deployment environment, printed in the startup log line.",
  },
  BUILD_VERSION: {
    group: "Service",
    format: "string",
    description:
      "Release identifier. Returned by `GET /version` and the health endpoints, and sent as the MCP server version.",
  },
  BUILD_COMMIT: {
    group: "Service",
    format: "string",
    description: "Source commit of the build. Returned by `GET /version` and the health endpoints.",
  },
  JSCHOLARSHIP_SOLR_URL: {
    group: "JScholarship",
    format: "http(s) URL",
    description: "Full URL of the private DSpace Solr collection used for candidate retrieval.",
  },
  JSCHOLARSHIP_API_URL: {
    group: "JScholarship",
    format: "http(s) URL",
    description: "Base URL of the DSpace REST API, the canonical source for every returned record.",
  },
  JSCHOLARSHIP_PUBLIC_URL: {
    group: "JScholarship",
    format: "http(s) URL",
    description: "Public site base URL used to build landing-page links.",
  },
  JHRDR_SOLR_URL: {
    group: "JHRDR",
    format: "URL (not validated)",
    description:
      "Full URL of the private Dataverse Solr collection. The JHRDR adapter is only created when this and `JHRDR_API_URL` are both set; otherwise the server runs JScholarship alone.",
  },
  JHRDR_API_URL: {
    group: "JHRDR",
    format: "URL (not validated)",
    description: "Base URL of the Dataverse Native API, the canonical source for JHRDR records.",
  },
  JHRDR_PUBLIC_URL: {
    group: "JHRDR",
    format: "URL (not validated)",
    description: "Public site base URL used to build JHRDR landing-page links.",
  },
  ALLOWED_HOSTS: {
    group: "Edge security",
    format: "comma-separated list",
    description:
      "Accepted `Host` header values for `/mcp` (DNS-rebinding defense). Must contain at least one entry.",
  },
  ALLOWED_ORIGINS: {
    group: "Edge security",
    format: "comma-separated list",
    description:
      "Accepted browser `Origin` values. Empty rejects every request that carries an `Origin`; clients that send no `Origin` are unaffected.",
  },
  MAX_BODY_BYTES: {
    group: "Edge security",
    format: "non-negative number",
    description: "Largest accepted request body; larger requests get HTTP 413.",
  },
  TIMEOUT_SOLR_MS: {
    group: "Timeouts",
    format: "milliseconds",
    description:
      "Per-request timeout for backend calls. Currently applied to both Solr and the canonical API clients.",
  },
  TIMEOUT_API_MS: {
    group: "Timeouts",
    format: "milliseconds",
    description:
      "Parsed into `timeouts.canonicalApiMs` but not currently read; canonical API calls use `TIMEOUT_SOLR_MS`.",
  },
  TIMEOUT_DEADLINE_MS: {
    group: "Timeouts",
    format: "milliseconds",
    description:
      "Overall deadline for one `/mcp` request. Values above 30000 are clamped to 30000.",
  },
  MAX_TOOL_CONCURRENCY: {
    group: "Concurrency",
    format: "count",
    description:
      "Tool calls allowed in flight per task. Calls beyond the limit fail fast with `rate_limited`.",
  },
  MAX_CANONICALIZATION_WORKERS: {
    group: "Concurrency",
    format: "count",
    description: "Concurrent canonical API look-ups per adapter while validating candidates.",
  },
  CACHE_SEARCH_TTL_MS: {
    group: "Cache",
    format: "milliseconds",
    description: "Lifetime of cached, already-validated repository search pages.",
  },
  CACHE_RECORD_TTL_MS: {
    group: "Cache",
    format: "milliseconds",
    description:
      "Lifetime of cached single records. Cached records are re-probed before they are served.",
  },
  CACHE_MAX_ENTRIES: {
    group: "Cache",
    format: "count",
    description: "Maximum entries in each bounded LRU cache.",
  },
};

const GROUP_ORDER: readonly EnvGroup[] = [
  "Service",
  "JScholarship",
  "JHRDR",
  "Edge security",
  "Timeouts",
  "Concurrency",
  "Cache",
];

interface EnvVarFacts {
  readonly name: EnvVarName;
  readonly required: boolean;
  readonly defaultValue: string | null;
  readonly allowed: readonly string[];
}

/** Read requiredness, default, and enum options from one zod field. */
function factsFor(name: EnvVarName, field: z.ZodTypeAny): EnvVarFacts {
  let current: z.ZodTypeAny = field;
  let defaultValue: string | null = null;
  let allowed: readonly string[] = [];
  for (let depth = 0; depth < 10; depth += 1) {
    if (current instanceof z.ZodDefault) {
      const value: unknown = current._def.defaultValue();
      defaultValue = typeof value === "string" ? value : JSON.stringify(value);
      current = current._def.innerType;
    } else if (current instanceof z.ZodEffects) {
      current = current._def.schema;
    } else if (current instanceof z.ZodOptional) {
      current = current._def.innerType;
    } else {
      break;
    }
  }
  if (current instanceof z.ZodEnum) {
    allowed = current.options.map(String);
  }
  const required = defaultValue === null && !field.isOptional();
  return { name, required, defaultValue, allowed };
}

function readFacts(): EnvVarFacts[] {
  return Object.entries(envSchema.shape).map(([name, field]) => {
    if (!(name in ENV_DOCS)) {
      throw new DocsScriptError(`No configuration description for ${name}`);
    }
    return factsFor(name as EnvVarName, field);
  });
}

function defaultCell(facts: EnvVarFacts): string {
  if (facts.required) {
    return "required";
  }
  if (facts.defaultValue === null || facts.defaultValue === "") {
    return "empty";
  }
  return code(facts.defaultValue);
}

function formatCell(facts: EnvVarFacts): string {
  const doc = ENV_DOCS[facts.name];
  return facts.allowed.length > 0 ? facts.allowed.map(code).join(", ") : doc.format;
}

function renderPage(all: readonly EnvVarFacts[]): string {
  const sections: string[] = [
    GENERATED_BANNER,
    "",
    "# Configuration",
    "",
    "The service is configured only through environment variables, validated at startup by the schema in `src/config/env.ts`. Validation is fail-fast: if any variable is invalid the process exits with status 1 and lists every problem at once.",
    "",
    "Repository field mappings and public-access filters are not runtime configuration. They are code, in `config/repositories/`; see [Repositories](./repositories.md).",
  ];
  for (const group of GROUP_ORDER) {
    const rows = all.filter((facts) => ENV_DOCS[facts.name].group === group);
    if (rows.length === 0) {
      continue;
    }
    sections.push(
      "",
      `## ${group}`,
      "",
      table(
        ["Variable", "Default", "Format", "Description"],
        rows.map((facts) => [
          code(facts.name),
          defaultCell(facts),
          formatCell(facts),
          ENV_DOCS[facts.name].description,
        ]),
      ),
    );
  }
  sections.push("");
  return sections.join("\n");
}

function summary(all: readonly EnvVarFacts[]): string {
  const required = all.filter((facts) => facts.required).map((facts) => code(facts.name));
  const optional = all.filter((facts) => !facts.required).map((facts) => code(facts.name));
  return [
    `Required (startup fails without them): ${required.join(", ")}.`,
    "",
    `Optional or defaulted: ${optional.join(", ")}.`,
  ].join("\n");
}

export function generateConfiguration(): Generated {
  const all = readFacts();
  return {
    files: [{ path: "docs/reference/configuration.md", content: renderPage(all) }],
    regions: [{ name: "configuration-summary", content: summary(all) }],
  };
}
