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
import {
  type AdapterRegistration,
  type FederationLimits,
  type RegistryFatalError,
  buildRegistry,
} from "./adapters/index";
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

/**
 * Maximum registered adapter count (Req 10.1, design default 8). No env knob
 * exists yet, so the design default is used directly; the initial registered set
 * (`jscholarship` + optional `jhrdr`) is always well within it.
 */
const MAX_REGISTERED_ADAPTERS = 8;

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
  /**
   * Set once the startup registry build completes (task 15.2). A non-null
   * `registryError` means the build failed; `/health/ready` then reports
   * not-ready with the structured code even if schema validation passed
   * (Req 1.1).
   */
  registryBuilt: boolean;
  registryError?: RegistryFatalError;
}

const readinessState: ReadinessState = {
  ready: false,
  validated: false,
  results: [],
  registryBuilt: false,
};

// ─── Application ─────────────────────────────────────────────────────────────

const app = new Hono();

// Health check — dependency-free liveness endpoint
app.get("/health/live", (c) => c.json({ status: "ok" }));

// Readiness endpoint — reflects schema validation status
app.get("/health/ready", (c) => {
  const build = { version: config.buildVersion, commit: config.buildCommit };

  // The registry must have been built before readiness can report healthy
  // (Req 1.1). A fatal build error is surfaced with its structured code.
  if (!readinessState.registryBuilt) {
    return c.json(
      {
        status: "not_ready",
        reason: "Adapter registry has not been built",
        build,
      },
      503,
    );
  }

  if (readinessState.registryError !== undefined) {
    return c.json(
      {
        status: "not_ready",
        reason: readinessState.registryError.message,
        code: readinessState.registryError.code,
        build,
      },
      503,
    );
  }

  if (!readinessState.validated) {
    return c.json(
      {
        status: "not_ready",
        reason: "Schema validation has not completed",
        build,
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
        build,
      },
      503,
    );
  }

  return c.json({
    status: "ready",
    results: readinessState.results,
    build,
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

// ─── Startup Registry Build (task 15.2) ──────────────────────────────────────

/**
 * Build the immutable Adapter_Registry once at process init, before readiness
 * reports healthy (Req 1.1). The registry becomes the single source of dispatch
 * eligibility for the MCP handlers (attached to `toolContext.registry`).
 *
 * On a `RegistryFatalError` (duplicate id, no adapter, all-schema-invalid,
 * weight out of range, over-max count, or cursor-size bound) the process exits
 * non-zero so an orchestrator never routes traffic to a misconfigured task
 * (design.md "Startup and Readiness", error table). The structured code is
 * recorded on the readiness state first so a `/health/ready` probe racing the
 * exit still reports the reason rather than a bare 503.
 */
async function buildStartupRegistry(): Promise<void> {
  const limits: Pick<FederationLimits, "maxAdapters"> = { maxAdapters: MAX_REGISTERED_ADAPTERS };
  const registrations: AdapterRegistration[] = [...toolContext.adapters.values()].map(
    (adapter) => ({ adapter }),
  );

  let result: Awaited<ReturnType<typeof buildRegistry>>;
  try {
    result = await buildRegistry(registrations, limits);
  } catch (error) {
    // buildRegistry returns fatal errors rather than throwing; an unexpected
    // throw is still fatal — fail readiness and terminate.
    readinessState.registryError = {
      code: "no_adapter_registered",
      message: `Registry build failed: ${error instanceof Error ? error.message : String(error)}`,
    };
    readinessState.registryBuilt = true;
    readinessState.ready = false;
    console.error("[startup] Adapter registry build threw:", readinessState.registryError.message);
    process.exitCode = 1;
    return;
  }

  if (result.fatalError !== null) {
    readinessState.registryError = result.fatalError;
    readinessState.registryBuilt = true;
    readinessState.ready = false;
    console.error(
      `[startup] Adapter registry build failed (${result.fatalError.code}): ${result.fatalError.message}`,
    );
    // Terminate with a non-zero exit so the task is not routed traffic.
    process.exitCode = 1;
    return;
  }

  toolContext.registry = result.registry;
  readinessState.registryBuilt = true;
  console.log(
    `[startup] Adapter registry built: ${result.registry.registeredIds().join(", ")} ` +
      `(${result.registry.eligibleIds().length} eligible)`,
  );
}

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

// Build the registry first (the readiness gate + eligibility source), then run
// the detailed schema validation that populates the readiness results payload.
// Both complete before readiness reports healthy (Req 1.1).
buildStartupRegistry().then(() => performSchemaValidation());

// ─── Export ──────────────────────────────────────────────────────────────────

export { app, readinessState, performSchemaValidation, buildStartupRegistry };

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
