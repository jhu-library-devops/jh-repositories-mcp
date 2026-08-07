/**
 * Contract Tests: Dataverse Canonical Native API Client
 *
 * **Validates: Requirements 3.4-3.8, 5.1-5.4, 9.3-9.5, 14.1, 15.9, 16.1-16.2**
 *
 * Fixture-driven tests against recorded Dataverse 6.10.1 Native API payload
 * shapes: latest-published resolution, the Public_Record gate (RELEASED only,
 * anonymous only, no API keys ever sent), restricted-file exclusion,
 * indistinguishable not-found behavior, backend-fault fail-closed behavior,
 * and the minimal-GET revalidation probe.
 */

import { describe, expect, test } from "bun:test";
import {
  DataverseClient,
  DataverseRequestError,
  normalizePersistentId,
} from "../../src/adapters/jhrdr/dataverse-client";
import type { FetchLike } from "../../src/adapters/jhrdr/dataverse-client";
import dataverseDataset from "../fixtures/jhrdr/dataverse-api-dataset.json";

const DOI = "doi:10.7281/T1ABCDEF";
const VERSION_PATH = "/api/datasets/:persistentId/versions/:latest-published";

type Route = () => Response;

interface LoggedCall {
  key: string;
  headers: Record<string, string>;
}

function makeClient(routes: Record<string, Route>, log: LoggedCall[] = []): DataverseClient {
  const fetchImpl: FetchLike = async (url, init) => {
    const key = `${init.method} ${url.pathname}${url.search}`;
    log.push({ key, headers: Object.fromEntries(new Headers(init.headers).entries()) });
    const route = routes[key];
    if (!route) {
      return json({ status: "ERROR", message: "not found" }, 404);
    }
    return route();
  };
  return new DataverseClient({
    apiBaseUrl: new URL("http://dataverse.internal:8080/api"),
    publicBaseUrl: new URL("https://archive.data.jhu.edu"),
    requestTimeoutMs: 1000,
    fetchImpl,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const happyKey = `GET ${VERSION_PATH}?persistentId=${encodeURIComponent(DOI)}`;
const probeKey = `GET ${VERSION_PATH}?persistentId=${encodeURIComponent(DOI)}&excludeFiles=true`;

describe("identifier validation happens before any I/O", () => {
  test("malformed persistent identifiers resolve to null without a network call", async () => {
    const log: LoggedCall[] = [];
    const client = makeClient({}, log);
    expect(await client.resolveDataset("not-a-doi", { expandFiles: true })).toBeNull();
    expect(await client.resolveDataset("10.x/../admin", { expandFiles: true })).toBeNull();
    expect(log).toHaveLength(0);
  });

  test("normalizePersistentId accepts bare and prefixed DOIs and Handles", () => {
    expect(normalizePersistentId("10.7281/T1ABCDEF")).toBe(DOI);
    expect(normalizePersistentId(DOI)).toBe(DOI);
    expect(normalizePersistentId("1774.2/99999")).toBe("hdl:1774.2/99999");
    expect(normalizePersistentId("junk")).toBeNull();
  });
});

describe("public dataset resolution", () => {
  test("resolves the latest published version and normalizes citation metadata", async () => {
    const log: LoggedCall[] = [];
    const client = makeClient({ [happyKey]: () => json(dataverseDataset) }, log);
    const item = await client.resolveDataset(DOI, { expandFiles: true });
    expect(item).not.toBeNull();
    if (!item) return;

    expect(item.id).toBe(`jhrdr:${DOI}`);
    expect(item.repository).toBe("jhrdr");
    expect(item.kind).toBe("dataset");
    expect(item.title).toBe("Baltimore Housing Vacancy Survey Microdata 2020-2024");
    expect(item.creators).toEqual([
      { name: "Chen, Wei", affiliation: "Johns Hopkins University", identifier: null },
      {
        name: "Okafor, Adaeze",
        affiliation: "Johns Hopkins Bloomberg School of Public Health",
        identifier: null,
      },
    ]);
    expect(item.subjects).toContain("Social Sciences");
    expect(item.subjects).toContain("housing vacancy");
    expect(item.persistentId).toEqual({
      type: "doi",
      value: "10.7281/T1ABCDEF",
      url: "https://doi.org/10.7281/T1ABCDEF",
    });
    expect(item.landingPageUrl).toBe(
      `https://archive.data.jhu.edu/dataset.xhtml?persistentId=${encodeURIComponent(DOI)}`,
    );
    expect(item.access.license).toBe("CC0 1.0");
    expect(item.date).toEqual({ value: "2024-06-02", display: "2024-06-02", precision: "day" });
    expect(item.provenance.canonicalApi).toBe("dataverse_native_api");
    // The version request always targets :latest-published, never :draft/:latest.
    expect(log[0]?.key).toContain(":latest-published");
  });

  test("never sends credentials or API-key headers (Requirement 14.1)", async () => {
    const log: LoggedCall[] = [];
    const client = makeClient({ [happyKey]: () => json(dataverseDataset) }, log);
    await client.resolveDataset(DOI, { expandFiles: true });
    const headerNames = Object.keys(log[0]?.headers ?? {}).map((h) => h.toLowerCase());
    expect(headerNames).not.toContain("x-dataverse-key");
    expect(headerNames).not.toContain("authorization");
  });

  test("excludes restricted files, caps summaries, and counts only public files", async () => {
    const client = makeClient({ [happyKey]: () => json(dataverseDataset) });
    const item = await client.resolveDataset(DOI, { expandFiles: true });
    if (!item) throw new Error("expected dataset");
    expect(item.files.map((f) => f.name)).toEqual(["vacancy-survey-2020-2024.csv", "codebook.pdf"]);
    expect(item.files.map((f) => f.name)).not.toContain("respondent-identifiers.csv");
    expect(item.fileCount).toBe(2);
    expect(item.formats.sort()).toEqual(["application/pdf", "text/csv"]);
    for (const file of item.files) {
      expect(file.restricted).toBe(false);
      expect(file.downloadUrl).toStartWith("https://archive.data.jhu.edu/api/access/datafile/");
    }
  });

  test("summary resolution asks the API to exclude files", async () => {
    const log: LoggedCall[] = [];
    const client = makeClient(
      {
        [probeKey]: () =>
          json({ status: "OK", data: { ...dataverseDataset.data, files: undefined } }),
      },
      log,
    );
    const item = await client.resolveDataset(DOI, { expandFiles: false });
    if (!item) throw new Error("expected dataset");
    expect(item.files).toEqual([]);
    expect(log[0]?.key).toContain("excludeFiles=true");
  });
});

describe("Public_Record gate fails closed", () => {
  test("non-RELEASED version states resolve to null even if the API returns them", async () => {
    for (const versionState of ["DRAFT", "DEACCESSIONED"]) {
      const client = makeClient({
        [happyKey]: () => json({ status: "OK", data: { ...dataverseDataset.data, versionState } }),
      });
      expect(await client.resolveDataset(DOI, { expandFiles: true })).toBeNull();
    }
  });

  test("nonexistent, draft-only, and restricted datasets are indistinguishable nulls", async () => {
    for (const status of [401, 403, 404]) {
      const client = makeClient({
        [happyKey]: () => json({ status: "ERROR" }, status),
      });
      expect(await client.resolveDataset(DOI, { expandFiles: true })).toBeNull();
    }
  });
});

describe("backend faults throw instead of masquerading as not-found", () => {
  test("5xx responses throw DataverseRequestError", async () => {
    const client = makeClient({ [happyKey]: () => json({}, 502) });
    await expect(client.resolveDataset(DOI, { expandFiles: true })).rejects.toThrow(
      DataverseRequestError,
    );
  });

  test("malformed JSON and unexpected shapes throw DataverseRequestError", async () => {
    const malformed = makeClient({
      [happyKey]: () => new Response("<html>gateway</html>", { status: 200 }),
    });
    await expect(malformed.resolveDataset(DOI, { expandFiles: true })).rejects.toThrow(
      DataverseRequestError,
    );

    const wrongShape = makeClient({ [happyKey]: () => json({ unexpected: true }) });
    await expect(wrongShape.resolveDataset(DOI, { expandFiles: true })).rejects.toThrow(
      DataverseRequestError,
    );
  });

  test("network failure throws DataverseRequestError", async () => {
    const client = new DataverseClient({
      apiBaseUrl: new URL("http://dataverse.internal:8080/api"),
      publicBaseUrl: new URL("https://archive.data.jhu.edu"),
      requestTimeoutMs: 1000,
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    await expect(client.resolveDataset(DOI, { expandFiles: true })).rejects.toThrow(
      DataverseRequestError,
    );
  });
});

describe("minimal-GET revalidation probe (Requirement 15.9)", () => {
  test("returns true only for RELEASED, anonymously retrievable datasets", async () => {
    const client = makeClient({
      [probeKey]: () => json({ status: "OK", data: { versionState: "RELEASED" } }),
    });
    expect(await client.probeDatasetPublic(DOI)).toBe(true);
  });

  test("returns false when access is gone or the version is no longer released", async () => {
    for (const status of [401, 403, 404]) {
      const client = makeClient({ [probeKey]: () => json({ status: "ERROR" }, status) });
      expect(await client.probeDatasetPublic(DOI)).toBe(false);
    }
    const deaccessioned = makeClient({
      [probeKey]: () => json({ status: "OK", data: { versionState: "DEACCESSIONED" } }),
    });
    expect(await deaccessioned.probeDatasetPublic(DOI)).toBe(false);
  });

  test("throws on backend faults so cache layers fail closed", async () => {
    const client = makeClient({ [probeKey]: () => json({}, 503) });
    await expect(client.probeDatasetPublic(DOI)).rejects.toThrow(DataverseRequestError);
  });
});
