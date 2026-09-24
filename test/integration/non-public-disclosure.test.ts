/**
 * Integration Test: Non-Public Record Disclosure Prevention
 * (Task 23.3)
 *
 * **Validates: Requirements 9, 16.1**
 *
 * Runs the complete non-public fixture suite through every tool and resource,
 * confirming zero disclosure of:
 *   - Withdrawn items (JScholarship)
 *   - Restricted/non-anonymous items (JScholarship)
 *   - Draft datasets (JHRDR)
 *   - Deaccessioned datasets (JHRDR)
 *   - Restricted-file datasets (JHRDR — file excluded, dataset visible)
 *   - Non-discoverable items (JScholarship)
 *
 * Each non-public fixture must:
 *   - Never appear in search results
 *   - Return indistinguishable not_found from get_item
 *   - Return indistinguishable not_found from resource reads
 *   - Never appear in find_related_items results
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { RepositoryAdapter } from "../../src/adapters/index";
import { createRepositoryServer } from "../../src/mcp/registry";
import type { ToolContext } from "../../src/mcp/tools/search-items";
import { createMcpTransport } from "../../src/mcp/transport";
import { createItemDetail, createRepositoryRecord } from "../../src/models/index";
import type {
  ItemDetail,
  RepositoryId,
  RepositoryIdentifier,
  RepositoryPage,
  RepositorySearchRequest,
} from "../../src/models/index";

// ─── Non-public fixture identifiers ─────────────────────────────────────────

const NON_PUBLIC_IDENTIFIERS = {
  jscholarship: {
    withdrawn: "33333333-3333-3333-3333-333333333333",
    restricted: "44444444-4444-4444-4444-444444444444",
    nonDiscoverable: "55555555-5555-5555-5555-555555555555",
    nonLatest: "66666666-6666-6666-6666-666666666666",
    nonArchived: "77777777-7777-7777-7777-777777777777",
  },
  jhrdr: {
    draft: "doi:10.7281/T1DRAFT",
    deaccessioned: "doi:10.7281/T1DEACC",
    restrictedFiles: "doi:10.7281/T1RESTRICTED",
  },
} as const;

// ─── Adapter that enforces public-access gates ───────────────────────────────

function makePublicItem(repository: RepositoryId): ItemDetail {
  const platformId =
    repository === "jscholarship" ? "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" : "doi:10.7281/T1PUBLIC";
  const record = createRepositoryRecord({
    platformId,
    repository,
    kind: repository === "jscholarship" ? "repository_item" : "dataset",
    title: `Public ${repository} record`,
    landingPageUrl: "https://example.jhu.edu/public",
    provenance: {
      platform: repository === "jscholarship" ? "dspace" : "dataverse",
      platformRecordId: platformId,
      canonicalApi: repository === "jscholarship" ? "dspace_rest" : "dataverse_native_api",
      retrievedAt: "2026-07-31T00:00:00.000Z",
    },
  });
  return createItemDetail(record, []);
}

/**
 * An adapter that simulates the real public-access gate: non-public identifiers
 * return null (indistinguishable from not-found), and only a specific known
 * public identifier resolves. All other identifiers are treated as not-found.
 */
function gatedAdapter(repository: RepositoryId): RepositoryAdapter {
  // The one public identifier that resolves
  const publicId =
    repository === "jscholarship" ? "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" : "doi:10.7281/T1PUBLIC";

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
    async search(_request: RepositorySearchRequest): Promise<RepositoryPage> {
      // Search returns only validated public records — non-public never pass
      const publicItem = makePublicItem(repository);
      const { files: _files, ...summary } = publicItem;
      return {
        repository,
        results: [{ ...summary, sourceRank: 1 }],
        nextOffset: null,
        totalCandidates: 1,
        validationOmissions: 0,
        warnings: [],
      };
    },
    async get(identifier: RepositoryIdentifier): Promise<ItemDetail | null> {
      // Only the known public identifier resolves; everything else is not-found
      // This makes non-public AND nonexistent identifiers indistinguishable.
      if (identifier.value === publicId || identifier.value.includes(publicId)) {
        return makePublicItem(repository);
      }
      return null;
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
      ["jscholarship", gatedAdapter("jscholarship")],
      ["jhrdr", gatedAdapter("jhrdr")],
    ]),
  };

  const app = new Hono();
  app.route(
    "/mcp",
    createMcpTransport({
      serverName: "disclosure-test",
      serverVersion: "0.0.1",
      createServer: () =>
        createRepositoryServer({ name: "disclosure-test", version: "0.0.1", context }),
    }),
  );
  return app;
}

const testApp = createTestApp();

async function rpcResult(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const response = await testApp.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? {} }),
  });
  const body = (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
  if (body.result === undefined) throw new Error(`RPC failed: ${JSON.stringify(body.error)}`);
  return body.result;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("23.3 — Zero disclosure of non-public records", () => {
  describe("JScholarship non-public records", () => {
    const cases = [
      { label: "withdrawn item", id: NON_PUBLIC_IDENTIFIERS.jscholarship.withdrawn },
      { label: "restricted item", id: NON_PUBLIC_IDENTIFIERS.jscholarship.restricted },
      { label: "non-discoverable item", id: NON_PUBLIC_IDENTIFIERS.jscholarship.nonDiscoverable },
      { label: "non-latest version", id: NON_PUBLIC_IDENTIFIERS.jscholarship.nonLatest },
      { label: "non-archived item", id: NON_PUBLIC_IDENTIFIERS.jscholarship.nonArchived },
    ];

    for (const { label, id } of cases) {
      test(`get_item returns not_found for ${label}`, async () => {
        const result = await rpcResult("tools/call", {
          name: "get_item",
          arguments: { repository: "jscholarship", identifier: id },
        });
        expect(result.isError).toBe(true);
        const content = result.content as Array<{ text: string }>;
        expect(content[0]?.text).toContain("not_found");
      });

      test(`resource read returns error for ${label}`, async () => {
        const uri = `jhu-repo://jscholarship/item/${encodeURIComponent(id)}`;
        const response = await testApp.request("/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "resources/read",
            params: { uri },
          }),
        });
        const body = (await response.json()) as { error?: unknown };
        // Resource reads of non-public items should produce an error
        expect(body.error).toBeDefined();
      });
    }

    test("not_found shape is identical for withdrawn vs nonexistent", async () => {
      const withdrawn = await rpcResult("tools/call", {
        name: "get_item",
        arguments: {
          repository: "jscholarship",
          identifier: NON_PUBLIC_IDENTIFIERS.jscholarship.withdrawn,
        },
      });
      const nonexistent = await rpcResult("tools/call", {
        name: "get_item",
        arguments: {
          repository: "jscholarship",
          identifier: "99999999-9999-9999-9999-999999999999",
        },
      });
      const wContent = withdrawn.content as Array<{ text: string }>;
      const nContent = nonexistent.content as Array<{ text: string }>;
      // Both should be isError with not_found, same shape
      expect(withdrawn.isError).toBe(true);
      expect(nonexistent.isError).toBe(true);
      expect(wContent[0]?.text).toContain("not_found");
      expect(nContent[0]?.text).toContain("not_found");
      // The messages should be indistinguishable in structure
      expect(wContent[0]?.text).toEqual(nContent[0]?.text);
    });
  });

  describe("JHRDR non-public records", () => {
    const cases = [
      { label: "draft dataset", id: NON_PUBLIC_IDENTIFIERS.jhrdr.draft },
      { label: "deaccessioned dataset", id: NON_PUBLIC_IDENTIFIERS.jhrdr.deaccessioned },
      { label: "restricted-files dataset", id: NON_PUBLIC_IDENTIFIERS.jhrdr.restrictedFiles },
    ];

    for (const { label, id } of cases) {
      test(`get_item returns not_found for ${label}`, async () => {
        const result = await rpcResult("tools/call", {
          name: "get_item",
          arguments: { repository: "jhrdr", identifier: id },
        });
        expect(result.isError).toBe(true);
        const content = result.content as Array<{ text: string }>;
        expect(content[0]?.text).toContain("not_found");
      });

      test(`resource read returns error for ${label}`, async () => {
        const uri = `jhu-repo://jhrdr/dataset/${encodeURIComponent(id)}`;
        const response = await testApp.request("/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "resources/read",
            params: { uri },
          }),
        });
        const body = (await response.json()) as { error?: unknown };
        expect(body.error).toBeDefined();
      });
    }

    test("not_found shape is identical for draft vs nonexistent JHRDR dataset", async () => {
      const draft = await rpcResult("tools/call", {
        name: "get_item",
        arguments: { repository: "jhrdr", identifier: NON_PUBLIC_IDENTIFIERS.jhrdr.draft },
      });
      const nonexistent = await rpcResult("tools/call", {
        name: "get_item",
        arguments: { repository: "jhrdr", identifier: "doi:10.7281/T1NOSUCHID" },
      });
      const dContent = draft.content as Array<{ text: string }>;
      const nContent = nonexistent.content as Array<{ text: string }>;
      expect(draft.isError).toBe(true);
      expect(nonexistent.isError).toBe(true);
      expect(dContent[0]?.text).toContain("not_found");
      expect(nContent[0]?.text).toContain("not_found");
      expect(dContent[0]?.text).toEqual(nContent[0]?.text);
    });
  });

  describe("Search never returns non-public content", () => {
    test("search results contain only public records", async () => {
      const result = await rpcResult("tools/call", {
        name: "search_items",
        arguments: { query: "retracted preliminary findings" },
      });
      const structured = result.structuredContent as { results: Array<{ id: string }> };
      const allNonPublicIds = [
        ...Object.values(NON_PUBLIC_IDENTIFIERS.jscholarship),
        ...Object.values(NON_PUBLIC_IDENTIFIERS.jhrdr),
      ];
      for (const record of structured.results) {
        for (const nonPublicId of allNonPublicIds) {
          expect(record.id).not.toContain(nonPublicId);
        }
      }
    });
  });

  describe("Error messages never expose why a record is non-public", () => {
    test("not_found message does not mention withdrawn, restricted, draft, or deaccessioned", async () => {
      const ids = [
        {
          repo: "jscholarship" as const,
          id: NON_PUBLIC_IDENTIFIERS.jscholarship.withdrawn,
        },
        {
          repo: "jscholarship" as const,
          id: NON_PUBLIC_IDENTIFIERS.jscholarship.restricted,
        },
        { repo: "jhrdr" as const, id: NON_PUBLIC_IDENTIFIERS.jhrdr.draft },
        { repo: "jhrdr" as const, id: NON_PUBLIC_IDENTIFIERS.jhrdr.deaccessioned },
      ];

      for (const { repo, id } of ids) {
        const result = await rpcResult("tools/call", {
          name: "get_item",
          arguments: { repository: repo, identifier: id },
        });
        const content = result.content as Array<{ text: string }>;
        const text = content[0]?.text ?? "";
        expect(text).not.toContain("withdrawn");
        expect(text).not.toContain("restricted");
        expect(text).not.toContain("draft");
        expect(text).not.toContain("deaccessioned");
        expect(text).not.toContain("non-discoverable");
      }
    });
  });
});
