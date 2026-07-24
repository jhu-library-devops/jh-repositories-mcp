/**
 * JHU Repository MCP Server — Entry Point
 *
 * Validates environment configuration at startup, then starts
 * a Hono HTTP server on the configured port. Performs schema
 * validation against deployed Solr collections before becoming ready.
 *
 * Requirements: 12.1-12.2, 12.7-12.8, 13.9
 */

import { Hono } from "hono";
import { loadConfig } from "./config/env";
import type { AppConfig } from "./config/index";
import { createMcpTransport } from "./mcp/transport";
import { JScholarshipAdapter } from "./adapters/jscholarship/index";
import type { SchemaValidationResult } from "./models/index";

// ─── Configuration ───────────────────────────────────────────────────────────

let config: AppConfig;

try {
  config = loadConfig();
} catch (error) {
  console.error(
    "[startup] Configuration validation failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}

// ─── Schema Validation State ─────────────────────────────────────────────────

interface ReadinessState {
  ready: boolean;
  validated: boolean;
  results: SchemaValidationResult[];
  error?: string;
}

const readinessState: ReadinessState = {
  ready: false,
  validated: false,
  results: [],
};

// ─── Application ─────────────────────────────────────────────────────────────

const app = new Hono();

// Health check — dependency-free liveness endpoint
app.get("/health/live", (c) => c.json({ status: "ok" }));

// Readiness endpoint — reflects schema validation status
app.get("/health/ready", (c) => {
  if (!readinessState.validated) {
    return c.json(
      {
        status: "not_ready",
        reason: "Schema validation has not completed",
        build: {
          version: config.buildVersion,
          commit: config.buildCommit,
        },
      },
      503,
    );
  }

  if (!readinessState.ready) {
    return c.json(
      {
        status: "not_ready",
        reason: readinessState.error ?? "Schema validation failed",
        results: readinessState.results,
        build: {
          version: config.buildVersion,
          commit: config.buildCommit,
        },
      },
      503,
    );
  }

  return c.json({
    status: "ready",
    results: readinessState.results,
    build: {
      version: config.buildVersion,
      commit: config.buildCommit,
    },
  });
});

// ─── MCP Transport ───────────────────────────────────────────────────────────

const mcpTransport = createMcpTransport({
  serverName: "jhu-repository-mcp",
  serverVersion: config.buildVersion,
});

app.route("/mcp", mcpTransport);

// ─── Startup Schema Validation ───────────────────────────────────────────────

async function performSchemaValidation(): Promise<void> {
  const results: SchemaValidationResult[] = [];

  try {
    // Validate JScholarship schema
    if (config.jscholarship.solrCollectionUrl) {
      const jsAdapter = new JScholarshipAdapter({
        solrCollectionUrl: config.jscholarship.solrCollectionUrl,
        schemaTimeoutMs: config.timeouts.solrMs,
      });

      const jsResult = await jsAdapter.validateSchema();
      results.push(jsResult);

      if (!jsResult.valid) {
        console.error(
          "[startup] JScholarship schema validation failed. Missing required fields:",
          jsResult.missingRequired,
        );
      }

      if (jsResult.missingOptional.length > 0) {
        console.warn(
          "[startup] JScholarship optional fields missing (features disabled):",
          jsResult.missingOptional,
          "→ disabled features:",
          jsResult.disabledFeatures,
        );
      }
    }

    // TODO: Validate JHRDR schema when profile is implemented (task 4.4)

    readinessState.results = results;
    readinessState.validated = true;

    // Ready only if all validated schemas pass
    const allValid = results.every((r) => r.valid);
    readinessState.ready = allValid;

    if (!allValid) {
      const failedRepos = results
        .filter((r) => !r.valid)
        .map((r) => r.repository);
      readinessState.error = `Schema validation failed for: ${failedRepos.join(", ")}`;
    }
  } catch (error) {
    readinessState.validated = true;
    readinessState.ready = false;
    readinessState.error =
      `Schema validation error: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[startup] Schema validation error:", readinessState.error);
  }
}

// Run schema validation asynchronously at startup
performSchemaValidation();

// ─── Export ──────────────────────────────────────────────────────────────────

export { app, readinessState, performSchemaValidation };

export default {
  port: config.port,
  fetch: app.fetch,
};

console.log(
  `jhu-repository-mcp v${config.buildVersion} (${config.buildCommit}) ` +
    `listening on port ${config.port} [${config.environment}]`,
);
