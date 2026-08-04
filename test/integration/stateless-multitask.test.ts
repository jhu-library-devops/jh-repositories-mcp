/**
 * Integration Test: Multi-task Stateless Operation
 * (Task 23.2)
 *
 * **Validates: Requirement 12.2**
 *
 * Confirms stateless operation by:
 *   - Sending multiple concurrent requests to the same server
 *   - Verifying no state leaks between sequential requests
 *   - Running requests across two independent server instances (simulating
 *     multiple Fargate tasks) without session affinity
 *   - Proving that tool calls do not require prior initialization on the
 *     same transport instance
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { RepositoryAdapter } from "../../src/adapters/index";
import { createRepositoryServer } from "../../src/mcp/registry";
import type { ToolContext } from "../../src/mcp/tools/search-items";
import { createMcpTransport } from "../../src/mcp/transport";
import { createItemDetail, createRepositoryRecord } from "../../src/models/index";
import type { ItemDetail, RepositoryId, RepositoryPage } from "../../src/models/index";
import { deadlineMiddleware, edgeMiddleware } from "../../src/security/index";

// ─── Stub adapter that tracks invocation count per request ───────────────────

let invocationCounter = 0;

function makeItem(repository: RepositoryId): ItemDetail {
  const record = createRepositoryRecord({
    platformId: `${repository}-item-${++invocationCounter}`,
    repository,
    kind: repository === "jscholarship" ? "repository_item" : "dataset",
    title: `${repository} result ${invocationCounter}`,
    landingPageUrl: "https://example.jhu.edu/x",
    provenance: {
      platform: repository === "jscholarship" ? "dspace" : "dataverse",
      platformRecordId: `${repository}-item-${invocationCounter}`,
      canonicalApi: repository === "jscholarship" ? "dspace_rest" : "dataverse_native_api",
      retrievedAt: new Date().toISOString(),
    },
  });
  return createItemDetail(record, []);
}

function stubAdapter(repository: RepositoryId): RepositoryAdapter {
  return {
    id: repository,
    async validateSchema() {
      return {
        repository,
        valid: true,
        missingRequired: [],
        missingOptional: [],
        disabledFeatures: [],
      };
    },
    async search() {
      const item = makeItem(repository);
      const { files: _files, ...summary } = item;
      return {
        repository,
        results: [{ ...summary, sourceRank: 1 }],
        nextOffset: null,
        totalCandidates: 1,
        validationOmissions: 0,
        warnings: [],
      };
    },
    async get() {
      return makeItem(repository);
    },
    async facets() {
      return { repository, facets: [], warnings: [] };
    },
    async related() {
      return {
        repository,
        results: [],
        nextOffset: null,
        totalCandidates: 0,
        validationOmissions: 0,
        warnings: [],
      };
    },
  };
}

function createApp(): Hono {
  const context: ToolContext = {
    adapters: new Map([
      ["jscholarship", stubAdapter("jscholarship")],
      ["jhrdr", stubAdapter("jhrdr")],
    ]),
  };

  const app = new Hono();
  app.use(
    "/mcp/*",
    edgeMiddleware({ allowedHosts: [], allowedOrigins: [], maxBodyBytes: 64 * 1024 }),
  );
  app.use("/mcp/*", deadlineMiddleware(5000));
  app.route(
    "/mcp",
    createMcpTransport({
      serverName: "stateless-test",
      serverVersion: "0.0.1",
      createServer: () =>
        createRepositoryServer({ name: "stateless-test", version: "0.0.1", context }),
    }),
  );
  return app;
}

// ─── Two independent server instances ────────────────────────────────────────

let server1: ReturnType<typeof Bun.serve>;
let server2: ReturnType<typeof Bun.serve>;
let url1: string;
let url2: string;

beforeAll(() => {
  server1 = Bun.serve({ port: 0, fetch: createApp().fetch });
  server2 = Bun.serve({ port: 0, fetch: createApp().fetch });
  url1 = `http://localhost:${server1.port}`;
  url2 = `http://localhost:${server2.port}`;
});

afterAll(() => {
  server1.stop(true);
  server2.stop(true);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

let nextId = 1;

async function rpcTo(
  baseUrl: string,
  method: string,
  params?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params: params ?? {} }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
  if (body.error) throw new Error(`RPC error: ${JSON.stringify(body.error)}`);
  return body.result ?? {};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("23.2 — Multi-task stateless operation", () => {
  test("concurrent requests to the same server return independent results", async () => {
    const requests = Array.from({ length: 5 }, (_, i) =>
      rpcTo(url1, "tools/call", {
        name: "search_items",
        arguments: { query: `concurrent query ${i}` },
      }),
    );
    const results = await Promise.all(requests);

    // All should succeed independently
    for (const result of results) {
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(Array.isArray(structured.results)).toBe(true);
    }
  });

  test("sequential requests do not leak state between calls", async () => {
    // First call to server1 with one query
    const r1 = await rpcTo(url1, "tools/call", {
      name: "search_items",
      arguments: { query: "first query", repositories: "jscholarship" },
    });
    const s1 = r1.structuredContent as { repositories: { requested: string[] } };
    expect(s1.repositories.requested).toEqual(["jscholarship"]);

    // Second call to server1 with different parameters
    const r2 = await rpcTo(url1, "tools/call", {
      name: "search_items",
      arguments: { query: "second query", repositories: "jhrdr" },
    });
    const s2 = r2.structuredContent as { repositories: { requested: string[] } };
    expect(s2.repositories.requested).toEqual(["jhrdr"]);

    // Third call with 'all' — should not have leftover state from previous calls
    const r3 = await rpcTo(url1, "tools/call", {
      name: "search_items",
      arguments: { query: "third query" },
    });
    const s3 = r3.structuredContent as { repositories: { requested: string[] } };
    expect(s3.repositories.requested).toEqual(["jscholarship", "jhrdr"]);
  });

  test("tool calls succeed without prior initialization on the same server", async () => {
    // Directly call tools/call without initialize — stateless mode supports this
    const result = await rpcTo(url2, "tools/call", {
      name: "search_items",
      arguments: { query: "no prior init" },
    });
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(Array.isArray(structured.results)).toBe(true);
  });

  test("requests across two server instances produce consistent tool surfaces", async () => {
    const tools1 = await rpcTo(url1, "tools/list");
    const tools2 = await rpcTo(url2, "tools/list");

    const names1 = (tools1.tools as Array<{ name: string }>).map((t) => t.name).sort();
    const names2 = (tools2.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names1).toEqual(names2);
  });

  test("interleaved requests across servers maintain correctness", async () => {
    // Server 1: initialize
    await rpcTo(url1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "interleave-test", version: "1.0" },
    });

    // Server 2: tool call without init
    const r1 = await rpcTo(url2, "tools/call", {
      name: "search_items",
      arguments: { query: "from server 2" },
    });
    expect(r1.isError).toBeUndefined();

    // Server 1: another tool call
    const r2 = await rpcTo(url1, "tools/call", {
      name: "get_item",
      arguments: { repository: "jhrdr", identifier: "doi:10.7281/T1ABC" },
    });
    expect(r2.isError).toBeUndefined();

    // Server 2: prompts
    const prompts = await rpcTo(url2, "prompts/list");
    expect((prompts.prompts as unknown[]).length).toBe(2);

    // Server 1: resources
    const templates = await rpcTo(url1, "resources/templates/list");
    expect((templates.resourceTemplates as unknown[]).length).toBe(2);
  });

  test("no Mcp-Session-Id is returned from either server", async () => {
    const response1 = await fetch(`${url1}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 9000,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "session-check", version: "1" },
        },
      }),
    });
    expect(response1.headers.get("mcp-session-id")).toBeNull();

    const response2 = await fetch(`${url2}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 9001,
        method: "tools/list",
        params: {},
      }),
    });
    expect(response2.headers.get("mcp-session-id")).toBeNull();
  });
});
