/**
 * Integration Tests: MCP Registry over Streamable HTTP
 *
 * **Validates: Requirements 1.7, 8.3-8.4, 12.1-12.5, 14.2-14.5, 16.2, 17**
 *
 * Drives the fully wired low-level server through the stateless transport:
 * initialization, tools/list with closed JSON Schemas and read-only
 * annotations, tools/call with structuredContent + compact text + resource
 * links, strict unknown-property rejection, resource templates and reads,
 * prompts, capability absence, and the edge middleware.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { RepositoryAdapter } from "../../src/adapters/index";
import { SERVER_INSTRUCTIONS } from "../../src/mcp/instructions";
import { FILES_UNAVAILABLE_NOTE, createRepositoryServer } from "../../src/mcp/registry";
import type { ToolContext } from "../../src/mcp/tools/search-items";
import { createMcpTransport } from "../../src/mcp/transport";
import { createItemDetail, createRepositoryRecord } from "../../src/models/index";
import type { ItemDetail, RepositoryId } from "../../src/models/index";
import { deadlineMiddleware, edgeMiddleware } from "../../src/security/index";

// ─── Stub context ────────────────────────────────────────────────────────────

const DEGRADED_ID = "jscholarship:99999999-9999-9999-9999-999999999999";

function detail(repository: RepositoryId): ItemDetail {
  const record = createRepositoryRecord({
    platformId:
      repository === "jscholarship" ? "11111111-1111-1111-1111-111111111111" : "doi:10.7281/T1X",
    repository,
    kind: repository === "jscholarship" ? "repository_item" : "dataset",
    title: `Sample ${repository} record`,
    landingPageUrl: "https://example.jhu.edu/x",
    provenance: {
      platform: repository === "jscholarship" ? "dspace" : "dataverse",
      platformRecordId:
        repository === "jscholarship" ? "11111111-1111-1111-1111-111111111111" : "doi:10.7281/T1X",
      canonicalApi: repository === "jscholarship" ? "dspace_rest" : "dataverse_native_api",
      retrievedAt: "2026-07-30T00:00:00.000Z",
    },
  });
  return createItemDetail(record, [], {
    metadata: [
      { field: "dc.description.sponsorship", values: ["National Science Foundation"] },
      { field: "dc.subject", values: ["Wetlands", "Climate"] },
    ],
  });
}

function stubAdapter(repository: RepositoryId): RepositoryAdapter {
  const item = detail(repository);
  const { files: _files, filesStatus: _filesStatus, metadata: _metadata, ...summary } = item;
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
      return {
        repository,
        results: [{ ...summary, sourceRank: 1 }],
        nextOffset: null,
        totalCandidates: 1,
        validationOmissions: 0,
        warnings: [],
      };
    },
    async get(identifier) {
      // One sentinel ID stands in for an item whose file list failed to load.
      if (identifier.value === DEGRADED_ID) {
        return createItemDetail(item, [], { metadata: item.metadata, filesStatus: "unavailable" });
      }
      return item;
    },
    async facets() {
      return {
        repository,
        facets: [
          {
            facet: "subject" as const,
            values: [{ label: "Wetlands", count: 3, repositoryBreakdown: { [repository]: 3 } }],
          },
        ],
        warnings: [],
      };
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

const context: ToolContext = {
  adapters: new Map([
    ["jscholarship", stubAdapter("jscholarship")],
    ["jhrdr", stubAdapter("jhrdr")],
  ]),
};

// ─── Server under test ───────────────────────────────────────────────────────

function createApp(): Hono {
  const app = new Hono();
  app.use(
    "/mcp/*",
    edgeMiddleware({
      allowedHosts: [],
      allowedOrigins: ["https://chat.jhu.edu"],
      maxBodyBytes: 64 * 1024,
    }),
  );
  app.use("/mcp/*", deadlineMiddleware(5000));
  app.route(
    "/mcp",
    createMcpTransport({
      serverName: "test",
      serverVersion: "0.0.1",
      createServer: () => createRepositoryServer({ name: "test", version: "0.0.1", context }),
    }),
  );
  return app;
}

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: createApp().fetch });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

let nextId = 1;

async function rpc(method: string, params?: unknown, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params: params ?? {} }),
  });
  return response;
}

async function rpcResult(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const response = await rpc(method, params);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
  expect(body.error).toBeUndefined();
  if (body.result === undefined) throw new Error("expected result");
  return body.result;
}

const INIT_PARAMS = {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "test-client", version: "1.0" },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MCP registry over stateless HTTP", () => {
  test("initializes and advertises tools, resources, and prompts capabilities", async () => {
    const result = await rpcResult("initialize", INIT_PARAMS);
    const capabilities = result.capabilities as Record<string, unknown>;
    expect(Object.keys(capabilities).sort()).toEqual(["prompts", "resources", "tools"]);
  });

  test("initialize returns server instructions carrying the scope and citation rules", async () => {
    const result = await rpcResult("initialize", INIT_PARAMS);

    // The SDK must actually forward ServerOptions.instructions onto the
    // initialize result — this is the only guidance channel that reaches a
    // session which never invokes a prompt.
    expect(typeof result.instructions).toBe("string");
    expect(result.instructions).toBe(SERVER_INSTRUCTIONS);

    // Guard the load-bearing guidance rather than the exact prose: coverage
    // honesty, indistinguishable not-found, untrusted metadata, and the
    // onward-referral hosts a model would otherwise reconstruct from stale
    // training data.
    const instructions = result.instructions as string;
    expect(instructions).toContain("not a general literature or data index");
    expect(instructions).toContain("lower bounds");
    expect(instructions).toContain("untrusted text from external depositors");
    expect(instructions).toContain("catalyst.library.jhu.edu");
    expect(instructions).toContain("digitalcollections.library.jhu.edu");

    // Referral is the ceiling: the host model hands over a URL rather than
    // querying other JHU systems for the researcher.
    expect(instructions).toContain("Refer, do not retrieve");

    // Failures reach the researcher in plain language, not as internal codes.
    expect(instructions).toContain("Explain problems in plain language");
    expect(instructions).toContain("file list couldn't be loaded");
  });

  test("server instructions mention the retired digital collections host only as retired", () => {
    // digital.library.jhu.edu moved to AM Quartex, so a reconstructed
    // Islandora item path 404s. The host may appear only as a warning.
    const mentions = SERVER_INSTRUCTIONS.split("\n").filter((line) =>
      line.includes("digital.library.jhu.edu"),
    );
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toContain("retired");
    expect(SERVER_INSTRUCTIONS).not.toContain("islandora");
  });

  test("tools/list returns exactly the five read-only tools with closed schemas", async () => {
    const result = await rpcResult("tools/list");
    const tools = result.tools as Array<Record<string, unknown>>;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "explain_search",
      "find_related_items",
      "get_item",
      "list_facets",
      "search_items",
    ]);
    for (const tool of tools) {
      const inputSchema = tool.inputSchema as Record<string, unknown>;
      expect(inputSchema.additionalProperties).toBe(false);
      const annotations = tool.annotations as Record<string, unknown>;
      expect(annotations.readOnlyHint).toBe(true);
      expect(annotations.destructiveHint).toBe(false);
      expect(tool.outputSchema).toBeDefined();
    }
  });

  test("get_item returns full metadata in structuredContent and the text block", async () => {
    const result = await rpcResult("tools/call", {
      name: "get_item",
      arguments: {
        repository: "jscholarship",
        identifier: "jscholarship:11111111-1111-1111-1111-111111111111",
      },
    });
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as { metadata: unknown };
    expect(structured.metadata).toEqual([
      { field: "dc.description.sponsorship", values: ["National Science Foundation"] },
      { field: "dc.subject", values: ["Wetlands", "Climate"] },
    ]);
    const content = result.content as Array<Record<string, unknown>>;
    const text = String(content[0]?.text);
    expect(text).toContain("Metadata:");
    expect(text).toContain("dc.description.sponsorship: National Science Foundation");
    expect(text).toContain("dc.subject: Wetlands | Climate");
    expect((result.structuredContent as { filesStatus: unknown }).filesStatus).toBe("complete");
  });

  test("get_item with an unloadable file list shows metadata and a plain-language note", async () => {
    const result = await rpcResult("tools/call", {
      name: "get_item",
      arguments: { repository: "jscholarship", identifier: DEGRADED_ID },
    });
    // Not an error: the record itself resolved.
    expect(result.isError).toBeUndefined();
    const text = String((result.content as Array<Record<string, unknown>>)[0]?.text);
    expect(text).toContain(FILES_UNAVAILABLE_NOTE);
    expect(text).toContain("dc.description.sponsorship: National Science Foundation");
    // No operator vocabulary reaches the chat.
    for (const term of [
      "filesStatus",
      "unavailable",
      "backend",
      "bundles",
      "HTTP",
      "DSpace",
      "Access: ",
    ]) {
      expect(text).not.toContain(term);
    }
    expect((result.structuredContent as { filesStatus: unknown }).filesStatus).toBe("unavailable");
  });

  test("search_items returns structuredContent, compact text, and resource links", async () => {
    const result = await rpcResult("tools/call", {
      name: "search_items",
      arguments: { query: "wetlands" },
    });
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(Array.isArray(structured.results)).toBe(true);
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0]?.type).toBe("text");
    expect(String(content[0]?.text)).toContain("Sample jscholarship record");
    // Full metadata belongs to get_item only; search results stay summaries.
    for (const record of structured.results as Array<Record<string, unknown>>) {
      expect(record).not.toHaveProperty("metadata");
    }
    const links = content.filter((c) => c.type === "resource_link");
    expect(links.length).toBeGreaterThan(0);
    expect(String(links[0]?.uri)).toStartWith("jhu-repo://");
  });

  test("unknown properties are rejected, not stripped (closed schemas)", async () => {
    const result = await rpcResult("tools/call", {
      name: "search_items",
      arguments: { query: "x", rawSolr: "read:*" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<Record<string, unknown>>;
    expect(String(content[0]?.text)).toContain("invalid_input");
  });

  test("unknown tools produce a method-not-found protocol error", async () => {
    const response = await rpc("tools/call", { name: "delete_item", arguments: {} });
    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error).toBeDefined();
  });

  test("zero-result searches read as a non-error message", async () => {
    const emptyContext: ToolContext = {
      adapters: new Map([
        [
          "jscholarship",
          {
            ...stubAdapter("jscholarship"),
            async search() {
              return {
                repository: "jscholarship" as const,
                results: [],
                nextOffset: null,
                totalCandidates: 0,
                validationOmissions: 0,
                warnings: [],
              };
            },
          },
        ],
      ]),
    };
    const app = new Hono();
    app.route(
      "/mcp",
      createMcpTransport({
        serverName: "t",
        serverVersion: "0",
        createServer: () =>
          createRepositoryServer({ name: "t", version: "0", context: emptyContext }),
      }),
    );
    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_items", arguments: { query: "nothing" } },
      }),
    });
    const body = (await response.json()) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };
    expect(body.result.isError).toBeUndefined();
    expect(body.result.content[0]?.text).toContain("No matching public records were found");
  });

  test("resource templates list both jhu-repo URIs and reads resolve canonically", async () => {
    const templates = await rpcResult("resources/templates/list");
    const uris = (templates.resourceTemplates as Array<{ uriTemplate: string }>).map(
      (t) => t.uriTemplate,
    );
    expect(uris).toEqual([
      "jhu-repo://jscholarship/item/{encodedIdentifier}",
      "jhu-repo://jhrdr/dataset/{encodedIdentifier}",
    ]);

    const read = await rpcResult("resources/read", {
      uri: "jhu-repo://jscholarship/item/11111111-1111-1111-1111-111111111111",
    });
    const contents = read.contents as Array<{ mimeType: string; text: string }>;
    expect(contents[0]?.mimeType).toBe("application/json");
    expect(JSON.parse(contents[0]?.text ?? "{}").title).toBe("Sample jscholarship record");
  });

  test("prompts list and resolve with fenced arguments", async () => {
    const list = await rpcResult("prompts/list");
    expect((list.prompts as Array<{ name: string }>).map((p) => p.name).sort()).toEqual([
      "explore_research_topic",
      "find_reusable_data",
    ]);
    const prompt = await rpcResult("prompts/get", {
      name: "explore_research_topic",
      arguments: { topic: "urban heat islands" },
    });
    const messages = prompt.messages as Array<{ role: string; content: { text: string } }>;
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content.text).toContain("urban heat islands");
    expect(messages[0]?.content.text).toContain("untrusted data");
  });

  test("edge middleware rejects disallowed origins and oversized bodies", async () => {
    const badOrigin = await rpc("tools/list", undefined, { origin: "https://evil.example" });
    expect(badOrigin.status).toBe(403);

    const tooLarge = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 999,
        method: "tools/call",
        params: { name: "search_items", arguments: { query: "x".repeat(100_000) } },
      }),
    });
    expect(tooLarge.status).toBe(413);

    const goodOrigin = await rpc("tools/list", undefined, { origin: "https://chat.jhu.edu" });
    expect(goodOrigin.status).toBe(200);
  });

  test("excluded capabilities are absent from discovery", async () => {
    const result = await rpcResult("tools/list");
    const names = (result.tools as Array<{ name: string }>).map((t) => t.name).join(",");
    expect(names).not.toMatch(/write|delete|admin|deposit|update|execute/);
  });
});
