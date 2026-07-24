/**
 * MCP Streamable HTTP Transport — Integration Test
 *
 * Verifies stateless MCP operation over HTTP using the Bun Web Standard transport.
 * Proves:
 *   1. MCP initialization succeeds
 *   2. Tool listing returns registered tools
 *   3. Tool invocation (echo) works
 *   4. A second server instance handles requests without session state
 *
 * Requirements: 12.1-12.2, 12.7-12.8
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { createMcpTransport } from "../../src/mcp/transport";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createTestApp() {
  const app = new Hono();

  app.get("/health/live", (c) => c.json({ status: "ok" }));

  const mcpTransport = createMcpTransport({
    serverName: "test-mcp-server",
    serverVersion: "0.0.1-test",
  });

  app.route("/mcp", mcpTransport);

  return app;
}

interface ServerInstance {
  server: ReturnType<typeof Bun.serve>;
  url: string;
}

function startServer(app: Hono): ServerInstance {
  const server = Bun.serve({
    port: 0, // Random available port
    fetch: app.fetch,
  });
  const url = `http://localhost:${server.port}`;
  return { server, url };
}

async function mcpPost(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

// ─── JSON-RPC Message Factories ──────────────────────────────────────────────

function initializeRequest(id: number) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  };
}

function initializedNotification() {
  return {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  };
}

function toolsListRequest(id: number) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/list",
    params: {},
  };
}

function toolCallRequest(id: number, toolName: string, args: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args,
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MCP Streamable HTTP Transport — Stateless Operation", () => {
  let server1: ServerInstance;
  let server2: ServerInstance;

  beforeAll(() => {
    const app1 = createTestApp();
    const app2 = createTestApp();
    server1 = startServer(app1);
    server2 = startServer(app2);
  });

  afterAll(() => {
    server1.server.stop(true);
    server2.server.stop(true);
  });

  test("health endpoint responds on test server", async () => {
    const res = await fetch(`${server1.url}/health/live`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("MCP initialize returns protocol version and server info", async () => {
    const res = await mcpPost(server1.url, initializeRequest(1));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.result).toBeDefined();
    expect(body.result.protocolVersion).toBeDefined();
    expect(body.result.serverInfo).toBeDefined();
    expect(body.result.serverInfo.name).toBe("test-mcp-server");
    expect(body.result.serverInfo.version).toBe("0.0.1-test");
  });

  test("no Mcp-Session-Id header is returned in stateless mode", async () => {
    const res = await mcpPost(server1.url, initializeRequest(2));
    expect(res.status).toBe(200);

    // Stateless mode: no session ID in response headers
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeNull();
  });

  test("tools/list returns the echo tool", async () => {
    // In stateless mode, each request creates a fresh server,
    // so we can send tools/list without prior initialization on the same transport.
    // But per MCP protocol, the client should initialize first.
    // Since each request is its own server, we batch initialize + tools/list.
    const initRes = await mcpPost(server1.url, initializeRequest(10));
    expect(initRes.status).toBe(200);

    const listRes = await mcpPost(server1.url, toolsListRequest(11));
    expect(listRes.status).toBe(200);

    const body = await listRes.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(11);
    expect(body.result).toBeDefined();
    expect(body.result.tools).toBeArray();
    expect(body.result.tools.length).toBeGreaterThanOrEqual(1);

    const echoTool = body.result.tools.find(
      (t: { name: string }) => t.name === "echo",
    );
    expect(echoTool).toBeDefined();
    expect(echoTool.description.toLowerCase()).toContain("echo");
  });

  test("tools/call echo returns the input message", async () => {
    const res = await mcpPost(
      server1.url,
      toolCallRequest(20, "echo", { message: "hello from test" }),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(20);
    expect(body.result).toBeDefined();
    expect(body.result.content).toBeArray();
    expect(body.result.content[0].type).toBe("text");
    expect(body.result.content[0].text).toBe("hello from test");
  });

  test("second server instance handles requests without session affinity", async () => {
    // This proves no session state is needed between processes:
    // Server 2 can handle a tools/call without ever receiving an initialize.
    const res = await mcpPost(
      server2.url,
      toolCallRequest(30, "echo", { message: "cross-process stateless" }),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(30);
    expect(body.result).toBeDefined();
    expect(body.result.content[0].text).toBe("cross-process stateless");
  });

  test("different servers return same tool surface", async () => {
    const res1 = await mcpPost(server1.url, toolsListRequest(40));
    const res2 = await mcpPost(server2.url, toolsListRequest(41));

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();

    // Both return the same tools
    const tools1 = body1.result.tools.map((t: { name: string }) => t.name).sort();
    const tools2 = body2.result.tools.map((t: { name: string }) => t.name).sort();
    expect(tools1).toEqual(tools2);
  });

  test("sequential tool calls across servers maintain no state", async () => {
    // Initialize on server1
    const initRes = await mcpPost(server1.url, initializeRequest(50));
    expect(initRes.status).toBe(200);

    // Call echo on server1
    const call1 = await mcpPost(
      server1.url,
      toolCallRequest(51, "echo", { message: "first" }),
    );
    const body1 = await call1.json();
    expect(body1.result.content[0].text).toBe("first");

    // Call echo on server2 (different process, no initialize)
    const call2 = await mcpPost(
      server2.url,
      toolCallRequest(52, "echo", { message: "second" }),
    );
    const body2 = await call2.json();
    expect(body2.result.content[0].text).toBe("second");

    // Back to server1
    const call3 = await mcpPost(
      server1.url,
      toolCallRequest(53, "echo", { message: "third" }),
    );
    const body3 = await call3.json();
    expect(body3.result.content[0].text).toBe("third");
  });

  test("GET /mcp returns 405 in stateless mode", async () => {
    const res = await fetch(`${server1.url}/mcp`, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(405);
  });

  test("DELETE /mcp returns 405 in stateless mode", async () => {
    const res = await fetch(`${server1.url}/mcp`, {
      method: "DELETE",
    });
    expect(res.status).toBe(405);
  });
});
