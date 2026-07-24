/**
 * JScholarship Profile Correctness Tests
 *
 * These tests validate the JScholarship RepositoryProfile against the Solr schema
 * fixture and acceptance criteria. They document the required properties as
 * executable assertions.
 *
 * Will run once the project scaffold (task 2.1) creates package.json and tsconfig.json.
 * Uses Bun's built-in test runner (bun test).
 *
 * Requirements: 2.1, 2.3, 9.1-9.8, 16.1
 */

import { describe, expect, test } from "bun:test";
import {
  DSPACE_ANONYMOUS_GROUP,
  DSPACE_ARCHIVED_STATUS,
  jscholarshipProfile,
} from "../../config/repositories/jscholarship-profile";
import solrSchema from "../fixtures/jscholarship/solr-schema.json";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns all field names available in the schema, including dynamic patterns.
 * A field name matches a dynamic pattern if it ends with the pattern's suffix
 * (e.g., "subject_filter" matches "*_filter").
 */
function fieldExistsInSchema(fieldName: string): boolean {
  // Check explicit fields
  if (fieldName in solrSchema.explicitFields) {
    return true;
  }

  // Check dynamic patterns
  for (const pattern of Object.keys(solrSchema.dynamicFieldPatterns)) {
    // Patterns like "*_filter", "*.year"
    const suffix = pattern.replace("*", "");
    if (fieldName.endsWith(suffix)) {
      return true;
    }
  }

  // Special cases: "score" is a Solr pseudo-field always available
  if (fieldName === "score") {
    return true;
  }

  // Discovery search fields (title, author, subject, abstract) are configured
  // in discovery.xml and exist as logical search fields even if not in schema.xml
  const discoverySearchFields = Object.values(
    solrSchema.discoveryConfiguration.searchFilters
  ).map((f) => (f as { indexFieldName: string }).indexFieldName);
  if (discoverySearchFields.includes(fieldName)) {
    return true;
  }

  return false;
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("JScholarship RepositoryProfile", () => {
  describe("Profile structure", () => {
    test("has correct repository identity", () => {
      expect(jscholarshipProfile.id).toBe("jscholarship");
      expect(jscholarshipProfile.platform).toBe("dspace");
      expect(jscholarshipProfile.solrCollection).toBe("search");
    });

    test("declares a version", () => {
      expect(jscholarshipProfile.version).toBeTruthy();
    });
  });

  describe("All filter fields exist in the schema", () => {
    const filterFields = Object.entries(jscholarshipProfile.filterFields);

    test("has at least one filter field defined", () => {
      expect(filterFields.length).toBeGreaterThan(0);
    });

    for (const [concept, solrField] of filterFields) {
      test(`filter "${concept}" → "${solrField}" exists in schema`, () => {
        expect(fieldExistsInSchema(solrField)).toBe(true);
      });
    }
  });

  describe("All facet fields exist in the schema", () => {
    const facetFields = Object.entries(jscholarshipProfile.facetFields);

    test("has at least one facet field defined", () => {
      expect(facetFields.length).toBeGreaterThan(0);
    });

    for (const [concept, solrField] of facetFields) {
      test(`facet "${concept}" → "${solrField}" exists in schema`, () => {
        expect(fieldExistsInSchema(solrField)).toBe(true);
      });
    }
  });

  describe("All query fields exist in the schema", () => {
    const queryFieldSets = Object.entries(jscholarshipProfile.queryFields);

    test("has at least one query field set defined", () => {
      expect(queryFieldSets.length).toBeGreaterThan(0);
    });

    for (const [concept, fields] of queryFieldSets) {
      for (const wf of fields) {
        test(`query "${concept}" → "${wf.field}" exists in schema`, () => {
          expect(fieldExistsInSchema(wf.field)).toBe(true);
        });
      }
    }
  });

  describe("All sort fields exist in the schema", () => {
    const sortFields = Object.entries(jscholarshipProfile.sortFields);

    for (const [option, sort] of sortFields) {
      test(`sort "${option}" → "${sort.field}" exists in schema`, () => {
        expect(fieldExistsInSchema(sort.field)).toBe(true);
      });
    }
  });

  describe("All related fields exist in the schema", () => {
    for (const field of jscholarshipProfile.relatedFields) {
      test(`related field "${field}" exists in schema`, () => {
        expect(fieldExistsInSchema(field)).toBe(true);
      });
    }
  });

  describe("All return fields exist in the schema", () => {
    for (const field of jscholarshipProfile.returnFields) {
      test(`return field "${field}" exists in schema`, () => {
        expect(fieldExistsInSchema(field)).toBe(true);
      });
    }
  });

  describe("Immutable public filters cover all access conditions", () => {
    const filters = jscholarshipProfile.immutablePublicFilters;
    const allFq = filters.map((f) => f.fq);

    test("restricts to Item resource type", () => {
      expect(allFq).toContain("search.resourcetype:Item");
    });

    test("requires latest version", () => {
      expect(allFq).toContain("latestVersion:true");
    });

    test("excludes withdrawn items", () => {
      expect(allFq).toContain("-withdrawn:true");
    });

    test("excludes non-discoverable items", () => {
      expect(allFq).toContain("-discoverable:false");
    });

    test("requires archived status", () => {
      expect(allFq).toContain(`database_status:${DSPACE_ARCHIVED_STATUS}`);
    });

    test("requires anonymous group read access", () => {
      expect(allFq).toContain(`read:${DSPACE_ANONYMOUS_GROUP}`);
    });

    test("has exactly 6 filter conditions (no gaps)", () => {
      expect(filters.length).toBe(6);
    });

    test("every filter references a field that exists in the schema", () => {
      for (const filter of filters) {
        // Extract field name from fq (handles negation prefix)
        const fqClean = filter.fq.replace(/^-/, "");
        const fieldName = fqClean.split(":")[0];
        expect(fieldExistsInSchema(fieldName)).toBe(true);
      }
    });
  });

  describe("Fulltext field is excluded from all allowlists", () => {
    test("fulltext is explicitly disabled", () => {
      expect(jscholarshipProfile.fulltextDecision.enabled).toBe(false);
    });

    test("fulltext field is identified", () => {
      expect(jscholarshipProfile.fulltextDecision.field).toBe("fulltext");
    });

    test("fulltext is NOT in any query field set", () => {
      for (const [_concept, fields] of Object.entries(
        jscholarshipProfile.queryFields
      )) {
        const fieldNames = fields.map((f) => f.field);
        expect(fieldNames).not.toContain("fulltext");
      }
    });

    test("fulltext is NOT in filter fields", () => {
      const filterFieldValues = Object.values(jscholarshipProfile.filterFields);
      expect(filterFieldValues).not.toContain("fulltext");
    });

    test("fulltext is NOT in facet fields", () => {
      const facetFieldValues = Object.values(jscholarshipProfile.facetFields);
      expect(facetFieldValues).not.toContain("fulltext");
    });

    test("fulltext is NOT in sort fields", () => {
      const sortFieldValues = Object.values(jscholarshipProfile.sortFields).map(
        (s) => s.field
      );
      expect(sortFieldValues).not.toContain("fulltext");
    });

    test("fulltext is NOT in related fields", () => {
      expect(jscholarshipProfile.relatedFields).not.toContain("fulltext");
    });

    test("fulltext is NOT in return fields", () => {
      expect(jscholarshipProfile.returnFields).not.toContain("fulltext");
    });

    test("rationale references DS-3498", () => {
      expect(jscholarshipProfile.fulltextDecision.rationale).toContain(
        "DS-3498"
      );
    });
  });

  describe("Identity fields are complete", () => {
    test("UUID field is defined", () => {
      expect(jscholarshipProfile.identityFields.uuid).toBe("search.resourceid");
    });

    test("Handle field is defined", () => {
      expect(jscholarshipProfile.identityFields.handle).toBe("handle");
    });

    test("Resource type field is defined", () => {
      expect(jscholarshipProfile.identityFields.resourceType).toBe(
        "search.resourcetype"
      );
    });

    test("all identity fields exist in schema", () => {
      for (const field of Object.values(jscholarshipProfile.identityFields)) {
        expect(fieldExistsInSchema(field)).toBe(true);
      }
    });

    test("all identity fields are in returnFields", () => {
      for (const field of Object.values(jscholarshipProfile.identityFields)) {
        expect(jscholarshipProfile.returnFields).toContain(field);
      }
    });
  });

  describe("Required schema fields are a subset of return + gate fields", () => {
    test("all public gate fields are in requiredSchemaFields", () => {
      const gateFields = jscholarshipProfile.immutablePublicFilters.map((f) => {
        const fqClean = f.fq.replace(/^-/, "");
        return fqClean.split(":")[0];
      });

      for (const gateField of gateFields) {
        expect(
          jscholarshipProfile.requiredSchemaFields as readonly string[],
        ).toContain(gateField);
      }
    });

    test("all identity fields are in requiredSchemaFields", () => {
      for (const field of Object.values(jscholarshipProfile.identityFields)) {
        expect(jscholarshipProfile.requiredSchemaFields).toContain(field);
      }
    });
  });

  describe("Constants are correct", () => {
    test("anonymous group value is 'g0'", () => {
      expect(DSPACE_ANONYMOUS_GROUP).toBe("g0");
    });

    test("archived status value is 'ARCHIVED'", () => {
      expect(DSPACE_ARCHIVED_STATUS).toBe("ARCHIVED");
    });
  });
});
