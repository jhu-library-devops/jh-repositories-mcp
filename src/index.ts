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
import { withCaching } from "./adapters/caching";
import { JhrdrAdapter } from "./adapters/jhrdr/index";
import { JScholarshipAdapter } from "./adapters/jscholarship/index";
import { loadConfig } from "./config/env";
import type { AppConfig } from "./config/index";
import { createRepositoryServer } from "./mcp/registry";
import type { ToolContext } from "./mcp/tools/search-items";
import { createMcpTransport } from "./mcp/transport";
import type { SchemaValidationResult } from "./models/index";
import { logger } from "./observability/index";
import { createSemaphore, deadlineMiddleware, edgeMiddleware } from "./security/index";

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

// ─── Version endpoint (task 16.3) ────────────────────────────────────────────

app.get("/version", (c) => c.json({ version: config.buildVersion, commit: config.buildCommit }));

// ─── Adapter Context ─────────────────────────────────────────────────────────

const cachingOptions = {
  searchTtlMs: config.cache.searchTtlMs,
  canonicalRecordTtlMs: config.cache.canonicalRecordTtlMs,
  maxEntries: config.cache.maxEntries,
};

const toolContext: ToolContext = {
  adapters: new Map(),
  onBackendFault: (fault) => logger.backendFault(fault),
};
toolContext.adapters.set(
  "jscholarship",
  withCaching(
    new JScholarshipAdapter({
      solrCollectionUrl: config.jscholarship.solrCollectionUrl,
      dspaceApiUrl: config.jscholarship.apiBaseUrl,
      publicBaseUrl: config.jscholarship.publicBaseUrl,
      requestTimeoutMs: config.timeouts.solrMs,
      canonicalConcurrency: config.concurrency.maxCanonicalizationWorkers,
    }),
    cachingOptions,
  ),
);
if (config.jhrdr.solrCollectionUrl && config.jhrdr.apiBaseUrl && config.jhrdr.publicBaseUrl) {
  toolContext.adapters.set(
    "jhrdr",
    withCaching(
      new JhrdrAdapter({
        solrCollectionUrl: config.jhrdr.solrCollectionUrl,
        dataverseApiUrl: config.jhrdr.apiBaseUrl,
        publicBaseUrl: config.jhrdr.publicBaseUrl,
        requestTimeoutMs: config.timeouts.solrMs,
        canonicalConcurrency: config.concurrency.maxCanonicalizationWorkers,
      }),
      cachingOptions,
    ),
  );
}

const toolSemaphore = createSemaphore(config.concurrency.maxToolConcurrency);

// ─── MCP Transport (edge middleware + per-request wired server) ──────────────

app.use(
  "/mcp/*",
  edgeMiddleware({
    allowedHosts: config.security.allowedHosts,
    allowedOrigins: config.security.allowedOrigins,
    maxBodyBytes: config.security.maxBodyBytes,
  }),
);
app.use("/mcp/*", deadlineMiddleware(config.timeouts.overallDeadlineMs));

const mcpTransport = createMcpTransport({
  serverName: "jhu-repository-mcp",
  serverVersion: config.buildVersion,
  createServer: (requestId) =>
    createRepositoryServer({
      name: "jhu-repository-mcp",
      version: config.buildVersion,
      context: toolContext,
      toolSemaphore,
      requestId,
    }),
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
        dspaceApiUrl: config.jscholarship.apiBaseUrl,
        publicBaseUrl: config.jscholarship.publicBaseUrl,
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

    // Validate JHRDR schema (optional deployment: skipped when unconfigured)
    if (config.jhrdr.solrCollectionUrl && config.jhrdr.apiBaseUrl && config.jhrdr.publicBaseUrl) {
      const dvAdapter = new JhrdrAdapter({
        solrCollectionUrl: config.jhrdr.solrCollectionUrl,
        dataverseApiUrl: config.jhrdr.apiBaseUrl,
        publicBaseUrl: config.jhrdr.publicBaseUrl,
        schemaTimeoutMs: config.timeouts.solrMs,
      });

      const dvResult = await dvAdapter.validateSchema();
      results.push(dvResult);

      if (!dvResult.valid) {
        console.error(
          "[startup] JHRDR schema validation failed. Missing required fields:",
          dvResult.missingRequired,
        );
      }

      if (dvResult.missingOptional.length > 0) {
        console.warn(
          "[startup] JHRDR optional fields missing (features disabled):",
          dvResult.missingOptional,
          "→ disabled features:",
          dvResult.disabledFeatures,
        );
      }
    }

    readinessState.results = results;
    readinessState.validated = true;

    // Ready only if all validated schemas pass
    const allValid = results.every((r) => r.valid);
    readinessState.ready = allValid;

    if (!allValid) {
      const failedRepos = results.filter((r) => !r.valid).map((r) => r.repository);
      readinessState.error = `Schema validation failed for: ${failedRepos.join(", ")}`;
    }
  } catch (error) {
    readinessState.validated = true;
    readinessState.ready = false;
    readinessState.error = `Schema validation error: ${error instanceof Error ? error.message : String(error)}`;
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

process.on("SIGTERM", () => {
  // Stop advertising readiness so the load balancer drains this task, then
  // allow in-flight requests one deadline window before exiting.
  readinessState.ready = false;
  readinessState.error = "Draining: SIGTERM received";
  console.log("[shutdown] SIGTERM received; draining");
  setTimeout(() => process.exit(0), config.timeouts.overallDeadlineMs).unref();
});

console.log(
  `jhu-repository-mcp v${config.buildVersion} (${config.buildCommit}) ` +
    `listening on port ${config.port} [${config.environment}]`,
);
