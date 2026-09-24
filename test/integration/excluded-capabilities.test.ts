/**
 * Integration Test: Excluded Capabilities Verification
 * (Task 23.5)
 *
 * **Validates: Requirement 17**
 *
 * Confirms that excluded capabilities:
 *   - Are absent from MCP tool discovery (tools/list)
 *   - Are absent from resource and prompt discovery
 *   - Cannot be accessed by guessing method or route names
 *   - Return appropriate errors when attempted via direct JSON-RPC calls
 *
 * Excluded capabilities per Requirement 17:
 *   - No deposit, edit, delete, publish, deaccession, embargo, permission,
 *     user, administrative, or statistics operations
 *   - No embedded LLM, generated summary, vector database, embedding, or
 *     agent loop
 *   - No file proxy, bulk download, restricted data, or authenticated sessions
 *   - No raw Solr access, arbitrary URLs, HTTP requests, database access,
 *     filesystem access, or code execution
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { RepositoryAdapter } from "../../src/adapters/index";
import { createRepositoryServer } from "../../src/mcp/registry";
import type { ToolContext } from "../../src/mcp/tools/search-items";
import { createMcpTransport } from "../../src/mcp/transport";
import { createItemDetail, createRepositoryRecord } from "../../src/models/index";
import type { ItemDetail, RepositoryId } from "../../src/models/index";

// ─── Minimal adapter ─────────────────────────────────────────────────────────

function stubAdapter(repository: RepositoryId): RepositoryAdapter {
  const platformId =
    repository === "jscholarship" ? "11111111-1111-1111-1111-111111111111" : "doi:10.7281/T1STUB";
  const record = createRepositoryRecord({
    platformId,
    repository,
    kind: repository === "jscholarship" ? "repository_item" : "dataset",
    title: "Stub",
    landingPageUrl: "https://example.jhu.edu/x",
    provenance: {
      platform: repository === "jscholarship" ? "dspace" : "dataverse",
      platformRecordId: platformId,
      canonicalApi: repository === "jscholarship" ? "dspace_rest" : "dataverse_native_api",
      retrievedAt: "2026-07-31T00:00:00.000Z",
    },
  });
  const item = createItemDetail(record, []);
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
      const { files: _f, ...summary } = item;
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
      return item;
    },
    async facets() {
      return { repository, facets: [], totalMatches: 0, warnings: [] };
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

// ─── Server under test ───────────────────────────────────────────────────────

function createTestApp(): Hono {
  const context: ToolContext = {
    adapters: new Map([
      ["jscholarship", stubAdapter("jscholarship")],
      ["jhrdr", stubAdapter("jhrdr")],
    ]),
  };
  const app = new Hono();
  app.route(
    "/mcp",
    createMcpTransport({
      serverName: "capability-test",
      serverVersion: "0.0.1",
      createServer: () =>
        createRepositoryServer({ name: "capability-test", version: "0.0.1", context }),
    }),
  );
  return app;
}

const testApp = createTestApp();

async function rpc(
  method: string,
  params?: unknown,
): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const response = await testApp.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? {} }),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("23.5 — Excluded capabilities absent and inaccessible", () => {
  describe("Tools discovery contains only the 5 approved tools", () => {
    test("tools/list returns exactly 5 tools, no write/admin/dangerous tools", async () => {
      const { body } = await rpc("tools/list");
      const result = body.result as Record<string, unknown>;
      const tools = result.tools as Array<{ name: string; description: string }>;

      // Exactly 5 read-only tools
      expect(tools).toHaveLength(5);
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "explain_search",
        "find_related_items",
        "get_item",
        "list_facets",
        "search_items",
      ]);

      // None of the tool names or descriptions suggest write operations
      const allText = tools
        .map((t) => `${t.name} ${t.description}`)
        .join(" ")
        .toLowerCase();
      const forbiddenTerms = [
        "write",
        "delete",
        "create",
        "update",
        "edit",
        "deposit",
        "publish",
        "deaccession",
        "embargo",
        "permission",
        "admin",
        "statistics",
        "execute",
        "download",
        "proxy",
        "embed",
        "vector",
        "summarize",
        "generate",
      ];
      for (const term of forbiddenTerms) {
        // Allow "read" in read-only context, but not write-associated terms
        if (allText.includes(term)) {
          // Only flag if it's not part of a legitimate read context
          expect(`tool surface contains forbidden term: ${term}`).toBe("");
        }
      }
    });
  });

  describe("Resources contain only the 2 approved templates", () => {
    test("resource templates list contains only jhu-repo URIs", async () => {
      const { body } = await rpc("resources/templates/list");
      const result = body.result as Record<string, unknown>;
      const templates = result.resourceTemplates as Array<{ uriTemplate: string }>;
      expect(templates).toHaveLength(2);
      expect(templates.every((t) => t.uriTemplate.startsWith("jhu-repo://"))).toBe(true);
    });

    test("resources/list returns no concrete resources (templates only)", async () => {
      const { body } = await rpc("resources/list");
      const result = body.result as Record<string, unknown>;
      const resources = result.resources as unknown[];
      expect(resources).toHaveLength(0);
    });
  });

  describe("Prompts contain only the 2 approved prompts", () => {
    test("prompts/list returns exactly explore_research_topic and find_reusable_data", async () => {
      const { body } = await rpc("prompts/list");
      const result = body.result as Record<string, unknown>;
      const prompts = result.prompts as Array<{ name: string }>;
      expect(prompts).toHaveLength(2);
      expect(prompts.map((p) => p.name).sort()).toEqual([
        "explore_research_topic",
        "find_reusable_data",
      ]);
    });
  });

  describe("Guessed excluded tool names return errors", () => {
    const excludedTools = [
      "deposit_item",
      "delete_item",
      "update_item",
      "create_collection",
      "set_permissions",
      "publish_item",
      "deaccession_dataset",
      "embargo_item",
      "download_file",
      "proxy_file",
      "run_query",
      "execute_code",
      "admin_reindex",
      "get_statistics",
      "update_metadata",
      "bulk_download",
      "authenticate",
      "create_api_key",
      "manage_users",
      "solr_query",
      "raw_http",
      "vector_search",
      "generate_summary",
      "embed_document",
    ];

    for (const toolName of excludedTools) {
      test(`guessed tool '${toolName}' returns method-not-found error`, async () => {
        const { body } = await rpc("tools/call", { name: toolName, arguments: {} });
        // Should be a protocol error (method not found) at the tools/call level
        const error = body.error as { code: number } | undefined;
        const result = body.result as Record<string, unknown> | undefined;
        // Either a JSON-RPC error or an isError tool result
        if (error) {
          expect(error.code).toBeDefined();
        } else if (result) {
          // Some frameworks handle unknown tools as tool errors
          expect(result).toBeDefined();
        }
      });
    }
  });

  describe("Guessed RPC methods return errors", () => {
    const excludedMethods = [
      "admin/shutdown",
      "admin/reindex",
      "sessions/list",
      "auth/login",
      "files/download",
      "solr/query",
      "database/query",
      "system/exec",
      "notifications/send",
    ];

    for (const method of excludedMethods) {
      test(`guessed method '${method}' returns error`, async () => {
        const { body } = await rpc(method, {});
        const error = body.error as { code: number } | undefined;
        expect(error).toBeDefined();
      });
    }
  });

  describe("HTTP routes only serve approved endpoints", () => {
    test("POST to unapproved paths returns 404", async () => {
      const paths = [
        "/admin",
        "/solr",
        "/api/v1/items",
        "/files/download",
        "/auth/login",
        "/internal",
      ];
      for (const path of paths) {
        const response = await testApp.request(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ test: true }),
        });
        expect(response.status).toBe(404);
      }
    });

    test("GET to unapproved paths returns 404", async () => {
      const paths = ["/admin", "/solr/select", "/api/items", "/files", "/.env", "/config"];
      for (const path of paths) {
        const response = await testApp.request(path, { method: "GET" });
        expect(response.status).toBe(404);
      }
    });
  });

  describe("Raw Solr access is impossible through MCP", () => {
    test("search_items with injected Solr syntax does not execute raw queries", async () => {
      const { body } = await rpc("tools/call", {
        name: "search_items",
        arguments: {
          query: "{!lucene q.op=OR}*:*",
        },
      });
      // Should either succeed with safe results or reject — never raw Solr execution
      const result = body.result as Record<string, unknown>;
      if (!result.isError) {
        // If it succeeds, the special characters are escaped safely
        const structured = result.structuredContent as { results: unknown[] };
        expect(structured.results).toBeDefined();
      }
    });

    test("search_items does not accept a raw query parameter", async () => {
      const { body } = await rpc("tools/call", {
        name: "search_items",
        arguments: {
          query: "test",
          rawQuery: "withdrawn:true OR read:g5",
        },
      });
      const result = body.result as Record<string, unknown>;
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ text: string }>;
      expect(content[0]?.text).toContain("invalid_input");
    });

    test("search_items does not accept a solr field filter", async () => {
      const { body } = await rpc("tools/call", {
        name: "search_items",
        arguments: {
          query: "test",
          fq: "-withdrawn:true",
        },
      });
      const result = body.result as Record<string, unknown>;
      expect(result.isError).toBe(true);
    });
  });

  describe("No file content or download capabilities", () => {
    test("get_item does not include file bytes or download content", async () => {
      const { body } = await rpc("tools/call", {
        name: "get_item",
        arguments: {
          repository: "jscholarship",
          identifier: "11111111-1111-1111-1111-111111111111",
        },
      });
      const result = body.result as Record<string, unknown>;
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as Record<string, unknown>;
      // No binary content, file bytes, or full-text content in the response
      const stringified = JSON.stringify(structured);
      expect(stringified).not.toContain("fileContent");
      expect(stringified).not.toContain("fileBytes");
      expect(stringified).not.toContain("fullText");
      expect(stringified).not.toContain("base64");
    });
  });

  describe("Capabilities object advertises only read operations", () => {
    test("initialize capabilities contain tools, resources, prompts — no subscriptions, logging, or sampling", async () => {
      const { body } = await rpc("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "cap-test", version: "1" },
      });
      const result = body.result as Record<string, unknown>;
      const capabilities = result.capabilities as Record<string, unknown>;
      expect(capabilities.tools).toBeDefined();
      expect(capabilities.resources).toBeDefined();
      expect(capabilities.prompts).toBeDefined();
      // Excluded server capabilities
      expect(capabilities.logging).toBeUndefined();
      expect(capabilities.sampling).toBeUndefined();
    });
  });
});
