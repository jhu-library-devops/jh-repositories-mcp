/**
 * JHU Repository MCP Server — Entry Point
 *
 * Minimal scaffold that proves dependencies resolve and starts
 * a Hono HTTP server on a configurable port.
 *
 * Business logic, tool registration, and MCP transport mounting
 * are implemented in later tasks.
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const app = new Hono();

// Health check — dependency-free liveness endpoint
app.get("/health/live", (c) => c.json({ status: "ok" }));

// Readiness endpoint (will add schema validation checks in later tasks)
app.get("/health/ready", (c) => c.json({ status: "ok" }));

// Prove MCP SDK resolves — server instance created but not mounted yet
const _mcpServer = new McpServer({
  name: "jhu-repository-mcp",
  version: "0.0.0",
});

const port = Number(process.env["PORT"] ?? 3000);

export default {
  port,
  fetch: app.fetch,
};

console.log(`jhu-repository-mcp listening on port ${port}`);
