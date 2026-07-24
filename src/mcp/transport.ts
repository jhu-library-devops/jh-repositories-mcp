/**
 * MCP Streamable HTTP Transport — Stateless Hono Integration
 *
 * Mounts the MCP SDK's WebStandardStreamableHTTPServerTransport on Hono routes.
 * Creates a fresh McpServer and transport per request (stateless pattern).
 * No session ID is issued and no server-side state is stored between requests.
 *
 * Requirements: 12.1-12.2, 12.7-12.8
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export interface McpTransportOptions {
  /** Server name reported during MCP initialization. */
  serverName: string;
  /** Server version reported during MCP initialization. */
  serverVersion: string;
  /**
   * Optional callback to register tools on each per-request McpServer instance.
   * If not provided, a default `echo` tool is registered for testing.
   */
  registerTools?: (server: McpServer) => void;
}

/**
 * Register the default echo tool used for integration testing.
 */
function registerDefaultTools(server: McpServer): void {
  server.tool(
    "echo",
    "Echoes the input message back to the caller",
    { message: z.string().describe("The message to echo back") },
    async ({ message }) => ({
      content: [{ type: "text", text: message }],
    }),
  );
}

/**
 * Create a Hono sub-app that handles MCP Streamable HTTP at its mount point.
 *
 * The transport creates a fresh McpServer and transport per POST request,
 * ensuring fully stateless operation suitable for multi-task deployment
 * behind a load balancer without session affinity.
 */
export function createMcpTransport(options: McpTransportOptions): Hono {
  const mcpApp = new Hono();

  // POST /mcp — handles all MCP JSON-RPC messages (initialize, tools/list, tools/call, etc.)
  mcpApp.post("/", async (c) => {
    const server = new McpServer({
      name: options.serverName,
      version: options.serverVersion,
    });

    const registerTools = options.registerTools ?? registerDefaultTools;
    registerTools(server);

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode — no session ID
      enableJsonResponse: true, // JSON responses for stateless operation
    });

    await server.connect(transport);

    const response = await transport.handleRequest(c.req.raw);

    return response;
  });

  // GET /mcp — SSE stream endpoint (required by the MCP Streamable HTTP spec)
  mcpApp.get("/", async (c) => {
    // In stateless mode without a session, GET for SSE is not applicable.
    // Return 405 Method Not Allowed as per the spec for stateless servers.
    return c.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed in stateless mode" }, id: null },
      405,
    );
  });

  // DELETE /mcp — session termination (not applicable in stateless mode)
  mcpApp.delete("/", async (c) => {
    return c.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Session termination not supported in stateless mode" }, id: null },
      405,
    );
  });

  return mcpApp;
}
