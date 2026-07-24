/**
 * Environment Variable Schema and Parser
 *
 * Uses Zod to define and validate all required environment variables at startup.
 * Returns a validated AppConfig on success; throws a descriptive error on failure
 * listing all invalid fields.
 *
 * Requirements: 13.2-13.9, 14.3-14.6, 15.1, 15.8
 */

import { z } from "zod";
import type { AppConfig } from "./index";

// ─── Transforms ──────────────────────────────────────────────────────────────

/** Split a comma-separated string into a trimmed array, filtering empty entries. */
const commaSeparatedList = z
  .string()
  .transform((val) =>
    val
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

/** Validate a string looks like a URL (has a protocol and host). */
const urlString = z.string().refine(
  (val) => {
    try {
      const url = new URL(val);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "Must be a valid HTTP or HTTPS URL" },
);

/** Non-negative number from an env var string. */
const positiveNumber = (fieldName: string) =>
  z
    .string()
    .transform((val) => Number(val))
    .refine((val) => !Number.isNaN(val) && val >= 0, {
      message: `${fieldName} must be a non-negative number`,
    });

// ─── Schema ──────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // Required
  PORT: z
    .string()
    .default("3000")
    .transform((val) => Number(val))
    .refine((val) => !Number.isNaN(val) && val > 0 && val <= 65535, {
      message: "PORT must be a valid port number (1-65535)",
    }),

  ENVIRONMENT: z.enum(["stage", "production"], {
    errorMap: () => ({
      message: 'ENVIRONMENT must be "stage" or "production"',
    }),
  }),

  BUILD_VERSION: z.string().min(1, "BUILD_VERSION is required"),
  BUILD_COMMIT: z.string().min(1, "BUILD_COMMIT is required"),

  // JScholarship endpoints — REQUIRED for startup
  JSCHOLARSHIP_SOLR_URL: urlString,
  JSCHOLARSHIP_API_URL: urlString,
  JSCHOLARSHIP_PUBLIC_URL: urlString,

  // JHRDR endpoints — optional with warnings (Dataverse stubbed)
  JHRDR_SOLR_URL: z.string().default(""),
  JHRDR_API_URL: z.string().default(""),
  JHRDR_PUBLIC_URL: z.string().default("https://archive.data.jhu.edu"),

  // Security
  ALLOWED_HOSTS: commaSeparatedList.refine((arr) => arr.length > 0, {
    message: "ALLOWED_HOSTS must contain at least one host",
  }),
  ALLOWED_ORIGINS: commaSeparatedList.refine((arr) => arr.length > 0, {
    message: "ALLOWED_ORIGINS must contain at least one origin",
  }).default(""),

  // Timeouts
  TIMEOUT_SOLR_MS: positiveNumber("TIMEOUT_SOLR_MS").default("5000"),
  TIMEOUT_API_MS: positiveNumber("TIMEOUT_API_MS").default("5000"),
  TIMEOUT_DEADLINE_MS: positiveNumber("TIMEOUT_DEADLINE_MS").default("10000"),

  // Concurrency
  MAX_TOOL_CONCURRENCY: positiveNumber("MAX_TOOL_CONCURRENCY").default("10"),
  MAX_CANONICALIZATION_WORKERS: positiveNumber(
    "MAX_CANONICALIZATION_WORKERS",
  ).default("5"),

  // Cache
  CACHE_SEARCH_TTL_MS: positiveNumber("CACHE_SEARCH_TTL_MS").default("60000"),
  CACHE_RECORD_TTL_MS: positiveNumber("CACHE_RECORD_TTL_MS").default("60000"),
  CACHE_MAX_ENTRIES: positiveNumber("CACHE_MAX_ENTRIES").default("500"),

  // Security bounds
  MAX_BODY_BYTES: positiveNumber("MAX_BODY_BYTES").default("65536"),
});

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse and validate environment variables, returning a validated AppConfig.
 * Throws a descriptive error listing all invalid fields if validation fails.
 * Warns (but does not throw) when Dataverse/JHRDR vars are missing.
 */
export function loadConfig(): AppConfig {
  // Collect env vars — use process.env with defaults handled by Zod
  const raw: Record<string, string | undefined> = {
    PORT: process.env.PORT,
    ENVIRONMENT: process.env.ENVIRONMENT,
    BUILD_VERSION: process.env.BUILD_VERSION,
    BUILD_COMMIT: process.env.BUILD_COMMIT,
    JSCHOLARSHIP_SOLR_URL: process.env.JSCHOLARSHIP_SOLR_URL,
    JSCHOLARSHIP_API_URL: process.env.JSCHOLARSHIP_API_URL,
    JSCHOLARSHIP_PUBLIC_URL: process.env.JSCHOLARSHIP_PUBLIC_URL,
    JHRDR_SOLR_URL: process.env.JHRDR_SOLR_URL,
    JHRDR_API_URL: process.env.JHRDR_API_URL,
    JHRDR_PUBLIC_URL: process.env.JHRDR_PUBLIC_URL,
    ALLOWED_HOSTS: process.env.ALLOWED_HOSTS,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    TIMEOUT_SOLR_MS: process.env.TIMEOUT_SOLR_MS,
    TIMEOUT_API_MS: process.env.TIMEOUT_API_MS,
    TIMEOUT_DEADLINE_MS: process.env.TIMEOUT_DEADLINE_MS,
    MAX_TOOL_CONCURRENCY: process.env.MAX_TOOL_CONCURRENCY,
    MAX_CANONICALIZATION_WORKERS: process.env.MAX_CANONICALIZATION_WORKERS,
    CACHE_SEARCH_TTL_MS: process.env.CACHE_SEARCH_TTL_MS,
    CACHE_RECORD_TTL_MS: process.env.CACHE_RECORD_TTL_MS,
    CACHE_MAX_ENTRIES: process.env.CACHE_MAX_ENTRIES,
    MAX_BODY_BYTES: process.env.MAX_BODY_BYTES,
  };

  // Remove undefined values so Zod defaults kick in
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined && value !== "") {
      cleaned[key] = value;
    }
  }

  // Special case: ALLOWED_HOSTS and ALLOWED_ORIGINS empty string means "not set"
  // but we need to distinguish from truly absent for validation
  if (process.env.ALLOWED_HOSTS === "") {
    cleaned.ALLOWED_HOSTS = "";
  }

  const result = envSchema.safeParse(cleaned);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `  - ${path}: ${issue.message}`;
    });
    throw new Error(
      `Environment configuration validation failed:\n${issues.join("\n")}`,
    );
  }

  const env = result.data;

  // Warn about missing JHRDR vars (Dataverse is stubbed)
  const jhrdrWarnings: string[] = [];
  if (!env.JHRDR_SOLR_URL) {
    jhrdrWarnings.push("JHRDR_SOLR_URL");
  }
  if (!env.JHRDR_API_URL) {
    jhrdrWarnings.push("JHRDR_API_URL");
  }
  if (jhrdrWarnings.length > 0) {
    console.warn(
      `[config] JHRDR/Dataverse endpoints not configured (${jhrdrWarnings.join(", ")}). ` +
        "JHRDR adapter will be unavailable until Dataverse infrastructure is ready.",
    );
  }

  // Clamp TIMEOUT_DEADLINE_MS to max 30000
  const overallDeadlineMs = Math.min(env.TIMEOUT_DEADLINE_MS, 30000);

  return {
    environment: env.ENVIRONMENT,
    port: env.PORT,
    buildVersion: env.BUILD_VERSION,
    buildCommit: env.BUILD_COMMIT,

    jscholarship: {
      solrCollectionUrl: env.JSCHOLARSHIP_SOLR_URL,
      apiBaseUrl: env.JSCHOLARSHIP_API_URL,
      publicBaseUrl: env.JSCHOLARSHIP_PUBLIC_URL,
    },

    jhrdr: {
      solrCollectionUrl: env.JHRDR_SOLR_URL,
      apiBaseUrl: env.JHRDR_API_URL,
      publicBaseUrl: env.JHRDR_PUBLIC_URL,
    },

    timeouts: {
      solrMs: env.TIMEOUT_SOLR_MS,
      canonicalApiMs: env.TIMEOUT_API_MS,
      overallDeadlineMs,
    },

    concurrency: {
      maxToolConcurrency: env.MAX_TOOL_CONCURRENCY,
      maxCanonicalizationWorkers: env.MAX_CANONICALIZATION_WORKERS,
    },

    cache: {
      searchTtlMs: env.CACHE_SEARCH_TTL_MS,
      canonicalRecordTtlMs: env.CACHE_RECORD_TTL_MS,
      maxEntries: env.CACHE_MAX_ENTRIES,
    },

    security: {
      allowedHosts: env.ALLOWED_HOSTS as string[],
      allowedOrigins: env.ALLOWED_ORIGINS as string[],
      maxBodyBytes: env.MAX_BODY_BYTES,
    },
  };
}
