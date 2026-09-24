/**
 * Contract Tests: DSpace Canonical REST Client
 *
 * **Validates: Requirements 2.4-2.6, 5.1-5.4, 9.3-9.5, 15.9, 16.1-16.2**
 *
 * Fixture-driven tests against recorded DSpace 7 REST payload shapes:
 * public resolution by UUID and Handle, the Public_Record gate,
 * indistinguishable not-found behavior, bitstream expansion caps,
 * backend-fault fail-closed behavior, and the HEAD revalidation probe.
 */

import { describe, expect, test } from "bun:test";
import {
  DSpaceClient,
  DSpaceRequestError,
  MAX_FILE_SUMMARIES,
  isValidDspaceUuid,
  isValidHandle,
} from "../../src/adapters/jscholarship/dspace-client";
import type { FetchLike } from "../../src/adapters/jscholarship/dspace-client";
import dspaceBundles from "../fixtures/jscholarship/dspace-rest-bundles.json";
import dspaceItem from "../fixtures/jscholarship/dspace-rest-item.json";

const PUBLIC_UUID = "11111111-1111-1111-1111-111111111111";
const HANDLE = "1774.2/99999";

interface RouteTable {
  [pathAndQuery: string]: () => Response;
}

function makeClient(routes: RouteTable, log: string[] = []): DSpaceClient {
  const fetchImpl: FetchLike = async (url, init) => {
    const key = `${init.method} ${url.pathname}${url.search}`;
    log.push(key);
    const route = routes[key];
    if (!route) {
      return new Response(JSON.stringify({ status: 404 }), { status: 404 });
    }
    return route();
  };
  return new DSpaceClient({
    apiBaseUrl: new URL("http://dspace.internal:8080/server/api"),
    publicBaseUrl: new URL("https://jscholarship.library.jhu.edu"),
    requestTimeoutMs: 1000,
    fetchImpl,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const happyRoutes: RouteTable = {
  [`GET /server/api/core/items/${PUBLIC_UUID}`]: () => jsonResponse(dspaceItem),
  [`GET /server/api/core/items/${PUBLIC_UUID}/bundles?embed=bitstreams`]: () =>
    jsonResponse(dspaceBundles),
  [`GET /server/api/pid/find?id=${encodeURIComponent(`hdl:${HANDLE}`)}`]: () =>
    jsonResponse(dspaceItem),
};

describe("identifier validation happens before any I/O", () => {
  test("invalid UUID and Handle shapes resolve to null without a network call", async () => {
    const log: string[] = [];
    const client = makeClient(happyRoutes, log);
    expect(
      await client.resolveItem(
        { type: "uuid", value: "not-a-uuid' OR 1=1" },
        { expandFiles: false },
      ),
    ).toBeNull();
    expect(
      await client.resolveItem({ type: "handle", value: "../../admin" }, { expandFiles: false }),
    ).toBeNull();
    expect(log).toHaveLength(0);
  });

  test("validators accept the recorded shapes", () => {
    expect(isValidDspaceUuid(PUBLIC_UUID)).toBe(true);
    expect(isValidHandle(HANDLE)).toBe(true);
  });
});

describe("public item resolution", () => {
  test("resolves by UUID and normalizes canonical metadata", async () => {
    const client = makeClient(happyRoutes);
    const item = await client.resolveItem(
      { type: "uuid", value: PUBLIC_UUID },
      { expandFiles: true },
    );
    expect(item).not.toBeNull();
    if (!item) return;

    expect(item.id).toBe(`jscholarship:${PUBLIC_UUID}`);
    expect(item.repository).toBe("jscholarship");
    expect(item.kind).toBe("repository_item");
    expect(item.title).toBe("Climate Adaptation Strategies for Chesapeake Bay Wetlands");
    expect(item.creators.map((c) => c.name)).toEqual(["Smith, Jane A.", "Johnson, Robert K."]);
    expect(item.subjects.length).toBeGreaterThan(0);
    expect(item.persistentId).toEqual({
      type: "handle",
      value: HANDLE,
      // The 1774.2 prefix is absent from the global Handle registry, so the
      // citation URL is the repository landing page.
      url: `https://jscholarship.library.jhu.edu/handle/${HANDLE}`,
    });
    expect(item.landingPageUrl).toBe(`https://jscholarship.library.jhu.edu/handle/${HANDLE}`);
    expect(item.provenance.canonicalApi).toBe("dspace_rest");
  });

  test("resolves by Handle through the pid/find route", async () => {
    const log: string[] = [];
    const client = makeClient(happyRoutes, log);
    const item = await client.resolveItem(
      { type: "handle", value: HANDLE },
      { expandFiles: false },
    );
    expect(item).not.toBeNull();
    expect(log[0]).toContain("/server/api/pid/find?id=hdl%3A");
  });

  test("expands only public ORIGINAL bitstreams with bounded summaries", async () => {
    const client = makeClient(happyRoutes);
    const item = await client.resolveItem(
      { type: "uuid", value: PUBLIC_UUID },
      { expandFiles: true },
    );
    if (!item) throw new Error("expected item");
    expect(item.files.length).toBeGreaterThan(0);
    expect(item.files.length).toBeLessThanOrEqual(MAX_FILE_SUMMARIES);
    for (const file of item.files) {
      expect(file.restricted).toBe(false);
      expect(file.downloadUrl).toStartWith("https://jscholarship.library.jhu.edu/bitstreams/");
    }
    expect(item.fileCount).toBe(item.files.length);
    expect(item.formats).toContain("application/pdf");
    expect(item.access.status).toBe("open");
  });

  test("summary resolution skips file expansion", async () => {
    const log: string[] = [];
    const client = makeClient(happyRoutes, log);
    const item = await client.resolveItem(
      { type: "uuid", value: PUBLIC_UUID },
      { expandFiles: false },
    );
    if (!item) throw new Error("expected item");
    expect(item.files).toEqual([]);
    expect(log.some((entry) => entry.includes("/bundles"))).toBe(false);
  });
});

describe("Public_Record gate fails closed", () => {
  const gateCases: Array<[string, Record<string, unknown>]> = [
    ["withdrawn", { ...dspaceItem, withdrawn: true }],
    ["non-discoverable", { ...dspaceItem, discoverable: false }],
    ["not in archive", { ...dspaceItem, inArchive: false }],
    ["not an item", { ...dspaceItem, type: "collection" }],
  ];

  for (const [label, payload] of gateCases) {
    test(`${label} items resolve to null`, async () => {
      const client = makeClient({
        [`GET /server/api/core/items/${PUBLIC_UUID}`]: () => jsonResponse(payload),
      });
      expect(
        await client.resolveItem({ type: "uuid", value: PUBLIC_UUID }, { expandFiles: true }),
      ).toBeNull();
    });
  }

  test("nonexistent (404) and forbidden (401/403) are indistinguishable nulls", async () => {
    for (const status of [401, 403, 404]) {
      const client = makeClient({
        [`GET /server/api/core/items/${PUBLIC_UUID}`]: () => jsonResponse({ status }, status),
      });
      expect(
        await client.resolveItem({ type: "uuid", value: PUBLIC_UUID }, { expandFiles: true }),
      ).toBeNull();
    }
  });
});

describe("backend faults throw instead of masquerading as not-found", () => {
  test("5xx responses throw DSpaceRequestError", async () => {
    const client = makeClient({
      [`GET /server/api/core/items/${PUBLIC_UUID}`]: () => jsonResponse({}, 500),
    });
    await expect(
      client.resolveItem({ type: "uuid", value: PUBLIC_UUID }, { expandFiles: true }),
    ).rejects.toThrow(DSpaceRequestError);
  });

  test("malformed JSON throws DSpaceRequestError", async () => {
    const client = makeClient({
      [`GET /server/api/core/items/${PUBLIC_UUID}`]: () =>
        new Response("<html>proxy error</html>", { status: 200 }),
    });
    await expect(
      client.resolveItem({ type: "uuid", value: PUBLIC_UUID }, { expandFiles: true }),
    ).rejects.toThrow(DSpaceRequestError);
  });

  test("network failure and timeout throw DSpaceRequestError", async () => {
    const client = new DSpaceClient({
      apiBaseUrl: new URL("http://dspace.internal:8080/server/api"),
      publicBaseUrl: new URL("https://jscholarship.library.jhu.edu"),
      requestTimeoutMs: 1000,
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    await expect(
      client.resolveItem({ type: "uuid", value: PUBLIC_UUID }, { expandFiles: true }),
    ).rejects.toThrow(DSpaceRequestError);
  });
});

describe("HEAD revalidation probe (Requirement 15.9)", () => {
  test("returns true for anonymously retrievable items", async () => {
    const client = makeClient({
      [`HEAD /server/api/core/items/${PUBLIC_UUID}`]: () => new Response(null, { status: 200 }),
    });
    expect(await client.probeItemPublic(PUBLIC_UUID)).toBe(true);
  });

  test("returns false when access is gone (401/403/404)", async () => {
    for (const status of [401, 403, 404]) {
      const client = makeClient({
        [`HEAD /server/api/core/items/${PUBLIC_UUID}`]: () => new Response(null, { status }),
      });
      expect(await client.probeItemPublic(PUBLIC_UUID)).toBe(false);
    }
  });

  test("throws on backend faults so cache layers fail closed", async () => {
    const client = makeClient({
      [`HEAD /server/api/core/items/${PUBLIC_UUID}`]: () => new Response(null, { status: 503 }),
    });
    await expect(client.probeItemPublic(PUBLIC_UUID)).rejects.toThrow(DSpaceRequestError);
  });

  test("rejects malformed UUIDs without I/O", async () => {
    const log: string[] = [];
    const client = makeClient({}, log);
    expect(await client.probeItemPublic("../admin")).toBe(false);
    expect(log).toHaveLength(0);
  });
});
