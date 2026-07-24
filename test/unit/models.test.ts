/**
 * Domain Model Unit Tests
 *
 * TDD tests for task 3.1: runtime model helpers (identifiers and factories).
 * Requirements: 4.1-4.6, 5.1-5.5
 */

import { describe, test, expect } from "bun:test";
import {
  createRecordId,
  parseRecordId,
  recordIdsCollide,
  createRepositoryRecord,
  createItemDetail,
} from "../../src/models/index";
import type {
  RepositoryRecord,
  PublicFileSummary,
  Provenance,
} from "../../src/models/index";

// ─── Identifier Tests ────────────────────────────────────────────────────────

describe("createRecordId()", () => {
  test("produces 'repository:platformId' format for jscholarship", () => {
    const id = createRecordId("jscholarship", "abc123");
    expect(id).toBe("jscholarship:abc123");
  });

  test("produces 'repository:platformId' format for jhrdr", () => {
    const id = createRecordId("jhrdr", "doi:10.7281/T1/EXAMPLE");
    expect(id).toBe("jhrdr:doi:10.7281/T1/EXAMPLE");
  });

  test("throws when platformId is empty", () => {
    expect(() => createRecordId("jscholarship", "")).toThrow(
      /platformId must not be empty/,
    );
  });

  test("preserves colons in platform IDs (DOIs, handles)", () => {
    const id = createRecordId("jhrdr", "hdl:20.500.12345/67890");
    expect(id).toBe("jhrdr:hdl:20.500.12345/67890");
  });
});

describe("parseRecordId()", () => {
  test("round-trips a jscholarship UUID", () => {
    const id = createRecordId("jscholarship", "550e8400-e29b-41d4-a716-446655440000");
    const parsed = parseRecordId(id);
    expect(parsed).toEqual({
      repository: "jscholarship",
      platformId: "550e8400-e29b-41d4-a716-446655440000",
    });
  });

  test("round-trips a jhrdr DOI with colons", () => {
    const id = createRecordId("jhrdr", "doi:10.7281/T1/EXAMPLE");
    const parsed = parseRecordId(id);
    expect(parsed).toEqual({
      repository: "jhrdr",
      platformId: "doi:10.7281/T1/EXAMPLE",
    });
  });

  test("returns null for empty string", () => {
    expect(parseRecordId("")).toBeNull();
  });

  test("returns null for string without separator", () => {
    expect(parseRecordId("noSeparatorHere")).toBeNull();
  });

  test("returns null for unknown repository prefix", () => {
    expect(parseRecordId("unknown:abc123")).toBeNull();
  });

  test("returns null when platformId portion is empty", () => {
    expect(parseRecordId("jscholarship:")).toBeNull();
  });

  test("returns null for just a colon", () => {
    expect(parseRecordId(":")).toBeNull();
  });
});

describe("recordIdsCollide()", () => {
  test("identical IDs collide", () => {
    const id = createRecordId("jscholarship", "abc123");
    expect(recordIdsCollide(id, id)).toBe(true);
  });

  test("same platformId in different repositories never collide", () => {
    const jsId = createRecordId("jscholarship", "abc123");
    const jhrdrId = createRecordId("jhrdr", "abc123");
    expect(recordIdsCollide(jsId, jhrdrId)).toBe(false);
  });

  test("different platformIds in same repository do not collide", () => {
    const id1 = createRecordId("jscholarship", "item-1");
    const id2 = createRecordId("jscholarship", "item-2");
    expect(recordIdsCollide(id1, id2)).toBe(false);
  });
});

// ─── Factory Tests ───────────────────────────────────────────────────────────

/** Minimal provenance for test records. */
const testProvenance: Provenance = {
  platform: "dspace",
  platformRecordId: "550e8400-e29b-41d4-a716-446655440000",
  canonicalApi: "dspace_rest",
  retrievedAt: "2024-01-15T10:30:00Z",
};

describe("createRepositoryRecord()", () => {
  test("fills nullable optionals with null when omitted", () => {
    const record = createRepositoryRecord({
      platformId: "abc123",
      repository: "jscholarship",
      kind: "repository_item",
      title: "Test Item",
      landingPageUrl: "https://jscholarship.library.jhu.edu/handle/1774/12345",
      provenance: testProvenance,
    });

    expect(record.abstract).toBeNull();
    expect(record.persistentId).toBeNull();
    expect(record.citation).toBeNull();
    expect(record.snippet).toBeNull();
    expect(record.sourceRank).toBeNull();
  });

  test("fills multi-valued arrays with [] when omitted", () => {
    const record = createRepositoryRecord({
      platformId: "abc123",
      repository: "jscholarship",
      kind: "repository_item",
      title: "Test Item",
      landingPageUrl: "https://jscholarship.library.jhu.edu/handle/1774/12345",
      provenance: testProvenance,
    });

    expect(record.creators).toEqual([]);
    expect(record.subjects).toEqual([]);
    expect(record.resourceTypes).toEqual([]);
    expect(record.formats).toEqual([]);
    expect(record.matchedFields).toEqual([]);
  });

  test("namespaces the id correctly", () => {
    const record = createRepositoryRecord({
      platformId: "550e8400-e29b-41d4-a716-446655440000",
      repository: "jscholarship",
      kind: "repository_item",
      title: "Test Item",
      landingPageUrl: "https://jscholarship.library.jhu.edu/handle/1774/12345",
      provenance: testProvenance,
    });

    expect(record.id).toBe(
      "jscholarship:550e8400-e29b-41d4-a716-446655440000",
    );
  });

  test("preserves provided values without overriding", () => {
    const record = createRepositoryRecord({
      platformId: "abc123",
      repository: "jhrdr",
      kind: "dataset",
      title: "Research Dataset",
      landingPageUrl: "https://archive.data.jhu.edu/dataset.xhtml?persistentId=doi:10.7281/T1/EXAMPLE",
      provenance: {
        platform: "dataverse",
        platformRecordId: "doi:10.7281/T1/EXAMPLE",
        canonicalApi: "dataverse_native_api",
        retrievedAt: "2024-01-15T10:30:00Z",
      },
      creators: [{ name: "Jane Doe", affiliation: "JHU", identifier: null }],
      abstract: "A research dataset about climate.",
      subjects: ["Climate", "Research"],
      citation: "Doe, J. (2024). Research Dataset.",
    });

    expect(record.repository).toBe("jhrdr");
    expect(record.kind).toBe("dataset");
    expect(record.creators).toHaveLength(1);
    expect(record.creators[0].name).toBe("Jane Doe");
    expect(record.abstract).toBe("A research dataset about climate.");
    expect(record.subjects).toEqual(["Climate", "Research"]);
    expect(record.citation).toBe("Doe, J. (2024). Research Dataset.");
  });

  test("provides default date with unknown precision", () => {
    const record = createRepositoryRecord({
      platformId: "abc123",
      repository: "jscholarship",
      kind: "repository_item",
      title: "Test Item",
      landingPageUrl: "https://jscholarship.library.jhu.edu/handle/1774/12345",
      provenance: testProvenance,
    });

    expect(record.date).toEqual({
      value: null,
      display: null,
      precision: "unknown",
    });
  });

  test("provides default collection context", () => {
    const record = createRepositoryRecord({
      platformId: "abc123",
      repository: "jscholarship",
      kind: "repository_item",
      title: "Test Item",
      landingPageUrl: "https://jscholarship.library.jhu.edu/handle/1774/12345",
      provenance: testProvenance,
    });

    expect(record.collection).toEqual({
      id: null,
      name: null,
      path: [],
    });
  });

  test("provides default access info with open status", () => {
    const record = createRepositoryRecord({
      platformId: "abc123",
      repository: "jscholarship",
      kind: "repository_item",
      title: "Test Item",
      landingPageUrl: "https://jscholarship.library.jhu.edu/handle/1774/12345",
      provenance: testProvenance,
    });

    expect(record.access).toEqual({
      status: "open",
      license: null,
      terms: null,
    });
  });

  test("defaults fileCount to 0", () => {
    const record = createRepositoryRecord({
      platformId: "abc123",
      repository: "jscholarship",
      kind: "repository_item",
      title: "Test Item",
      landingPageUrl: "https://jscholarship.library.jhu.edu/handle/1774/12345",
      provenance: testProvenance,
    });

    expect(record.fileCount).toBe(0);
  });
});

describe("createItemDetail()", () => {
  test("extends record with files array", () => {
    const record = createRepositoryRecord({
      platformId: "abc123",
      repository: "jscholarship",
      kind: "repository_item",
      title: "Test Item",
      landingPageUrl: "https://jscholarship.library.jhu.edu/handle/1774/12345",
      provenance: testProvenance,
    });

    const files: PublicFileSummary[] = [
      {
        id: "file-001",
        name: "paper.pdf",
        format: "application/pdf",
        sizeBytes: 1024000,
        restricted: false,
        downloadUrl: "https://jscholarship.library.jhu.edu/bitstreams/file-001/download",
      },
    ];

    const detail = createItemDetail(record, files);

    expect(detail.id).toBe(record.id);
    expect(detail.title).toBe("Test Item");
    expect(detail.files).toHaveLength(1);
    expect(detail.files[0].name).toBe("paper.pdf");
  });

  test("accepts empty files array", () => {
    const record = createRepositoryRecord({
      platformId: "abc123",
      repository: "jscholarship",
      kind: "repository_item",
      title: "Test Item",
      landingPageUrl: "https://jscholarship.library.jhu.edu/handle/1774/12345",
      provenance: testProvenance,
    });

    const detail = createItemDetail(record, []);
    expect(detail.files).toEqual([]);
  });

  test("preserves all record fields in the detail", () => {
    const record = createRepositoryRecord({
      platformId: "doi:10.7281/T1/XYZ",
      repository: "jhrdr",
      kind: "dataset",
      title: "Research Data",
      landingPageUrl: "https://archive.data.jhu.edu/dataset.xhtml?persistentId=doi:10.7281/T1/XYZ",
      provenance: {
        platform: "dataverse",
        platformRecordId: "doi:10.7281/T1/XYZ",
        canonicalApi: "dataverse_native_api",
        retrievedAt: "2024-02-01T12:00:00Z",
      },
      subjects: ["Biology"],
      creators: [
        { name: "John Smith", affiliation: "JHU APL", identifier: "0000-0001-2345-6789" },
      ],
    });

    const detail = createItemDetail(record, []);

    expect(detail.repository).toBe("jhrdr");
    expect(detail.kind).toBe("dataset");
    expect(detail.subjects).toEqual(["Biology"]);
    expect(detail.creators[0].identifier).toBe("0000-0001-2345-6789");
    expect(detail.provenance.platform).toBe("dataverse");
  });
});
