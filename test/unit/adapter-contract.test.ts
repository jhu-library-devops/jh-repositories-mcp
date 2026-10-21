/**
 * Adapter Contract Surface — Unit Tests
 *
 * **Validates: Requirements 8.6, 8.7, 8.9**
 *
 * Both platform adapters must conform to contract version 2: declare
 * `contractVersion === ADAPTER_CONTRACT_VERSION` (= 2), expose the now-required
 * `probePublic` as a callable method, and return a well-formed
 * `SchemaValidationResult` from `validateSchema` for both a success case (all
 * required fields present) and a missing-required-field case. Schema validation
 * is driven through an injected fetch that reflects each profile's declared
 * required fields, so the assertions stay robust against profile changes.
 */

import { describe, expect, test } from "bun:test";
import { jhrdrProfile } from "../../config/repositories/jhrdr-profile";
import { jscholarshipProfile } from "../../config/repositories/jscholarship-profile";
import { ADAPTER_CONTRACT_VERSION, type RepositoryAdapter } from "../../src/adapters/index";
import { JhrdrAdapter } from "../../src/adapters/jhrdr/index";
import { JScholarshipAdapter } from "../../src/adapters/jscholarship/index";
import type { FetchFn } from "../../src/adapters/solr-schema-validator";
import type { RepositoryId, SchemaValidationResult } from "../../src/models/index";

// ─── Mock Schema Endpoints ───────────────────────────────────────────────────

/**
 * Build a fetch that answers Solr's `/schema/fields` and `/schema/dynamicfields`
 * endpoints. The static fields returned are exactly `presentFields`; no dynamic
 * patterns are advertised, so field presence is fully determined by the caller.
 */
function schemaFetch(presentFields: readonly string[]): FetchFn {
  return async (input: string | URL | Request): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = url.endsWith("/dynamicfields")
      ? { dynamicFields: [] }
      : { fields: presentFields.map((name) => ({ name, type: "text_general" })) };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

interface AdapterCase {
  readonly id: RepositoryId;
  readonly requiredFields: readonly string[];
  make(fetchFn: FetchFn): RepositoryAdapter;
}

const jscholarshipCase: AdapterCase = {
  id: "jscholarship",
  requiredFields: jscholarshipProfile.requiredSchemaFields,
  make: (fetchFn) =>
    new JScholarshipAdapter({
      solrCollectionUrl: "http://solr.internal:8983/solr/search",
      dspaceApiUrl: "http://dspace.internal:8080/server/api",
      publicBaseUrl: "https://jscholarship.library.jhu.edu",
      fetchFn,
    }),
};

const jhrdrCase: AdapterCase = {
  id: "jhrdr",
  requiredFields: jhrdrProfile.requiredSchemaFields,
  make: (fetchFn) =>
    new JhrdrAdapter({
      solrCollectionUrl: "http://solr.dataverse.internal:8983/solr/collection1",
      dataverseApiUrl: "http://dataverse.internal:8080/api",
      publicBaseUrl: "https://archive.data.jhu.edu",
      fetchFn,
    }),
};

const adapterCases: readonly AdapterCase[] = [jscholarshipCase, jhrdrCase];

/** Assert the shape every `SchemaValidationResult` must satisfy (Req 8.9). */
function expectWellFormed(result: SchemaValidationResult, repository: RepositoryId): void {
  expect(result.repository).toBe(repository);
  expect(typeof result.valid).toBe("boolean");
  expect(Array.isArray(result.missingRequired)).toBe(true);
  expect(Array.isArray(result.missingOptional)).toBe(true);
  expect(Array.isArray(result.disabledFeatures)).toBe(true);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("adapter contract surface (v2)", () => {
  for (const adapterCase of adapterCases) {
    describe(adapterCase.id, () => {
      test("declares contract version 2", () => {
        const adapter = adapterCase.make(schemaFetch(adapterCase.requiredFields));
        expect(adapter.contractVersion).toBe(2);
        expect(adapter.contractVersion).toBe(ADAPTER_CONTRACT_VERSION);
        expect(adapter.id).toBe(adapterCase.id);
      });

      test("exposes a callable probePublic", () => {
        const adapter = adapterCase.make(schemaFetch(adapterCase.requiredFields));
        expect(typeof adapter.probePublic).toBe("function");
        expect(adapter.probePublic.length).toBe(1);
      });

      test("validateSchema returns a well-formed result when all required fields are present", async () => {
        const adapter = adapterCase.make(schemaFetch(adapterCase.requiredFields));
        const result = await adapter.validateSchema();

        expectWellFormed(result, adapterCase.id);
        expect(result.valid).toBe(true);
        expect(result.missingRequired).toEqual([]);
      });

      test("validateSchema returns a well-formed result reporting a missing required field", async () => {
        const [omitted, ...present] = adapterCase.requiredFields;
        if (omitted === undefined) throw new Error("profile declares no required fields");

        const adapter = adapterCase.make(schemaFetch(present));
        const result = await adapter.validateSchema();

        expectWellFormed(result, adapterCase.id);
        expect(result.valid).toBe(false);
        expect(result.missingRequired).toContain(omitted);
      });
    });
  }
});
