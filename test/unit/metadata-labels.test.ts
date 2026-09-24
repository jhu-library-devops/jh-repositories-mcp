/**
 * Unit Tests: Metadata Labels
 *
 * **Validates: Requirement 5.6**
 *
 * Known platform fields get their mapped reader-facing label; any other field
 * gets a readable label from its name, never the raw identifier.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { dataverseMetadataLabel } from "../../src/adapters/jhrdr/metadata-labels";
import { dspaceMetadataLabel } from "../../src/adapters/jscholarship/metadata-labels";
import { humanizeFieldName } from "../../src/adapters/metadata-labels";

describe("humanizeFieldName", () => {
  test("splits dots, underscores, and camelCase into a sentence-case phrase", () => {
    expect(humanizeFieldName("date.embargo")).toBe("Date embargo");
    expect(humanizeFieldName("timePeriodCoveredStart")).toBe("Time period covered start");
    expect(humanizeFieldName("local_funding.source")).toBe("Local funding source");
  });

  test("returns the input when nothing readable remains", () => {
    expect(humanizeFieldName("...")).toBe("...");
  });

  test("always yields a non-empty label for a non-empty name", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (name) => {
        expect(humanizeFieldName(name).length).toBeGreaterThan(0);
      }),
      { numRuns: 150 },
    );
  });
});

describe("dspaceMetadataLabel", () => {
  test("maps common Dublin Core and thesis fields", () => {
    expect(dspaceMetadataLabel("dc.contributor.author")).toBe("Author");
    expect(dspaceMetadataLabel("dc.date.issued")).toBe("Date issued");
    expect(dspaceMetadataLabel("dc.description.sponsorship")).toBe("Sponsor");
    expect(dspaceMetadataLabel("dc.identifier.uri")).toBe("Permanent link");
    expect(dspaceMetadataLabel("thesis.degree.name")).toBe("Degree");
  });

  test("labels unmapped fields from the name without the schema prefix", () => {
    expect(dspaceMetadataLabel("dc.date.embargo")).toBe("Date embargo");
    expect(dspaceMetadataLabel("local.funding")).toBe("Funding");
    expect(dspaceMetadataLabel("dspace.entity.type")).toBe("Entity type");
  });
});

describe("dataverseMetadataLabel", () => {
  test("maps common citation and geospatial fields", () => {
    expect(dataverseMetadataLabel("authorName")).toBe("Author");
    expect(dataverseMetadataLabel("dsDescriptionValue")).toBe("Description");
    expect(dataverseMetadataLabel("grantNumberAgency")).toBe("Funding agency");
    expect(dataverseMetadataLabel("geographicUnit")).toBe("Geographic unit");
  });

  test("labels unmapped fields from the camelCase typeName", () => {
    expect(dataverseMetadataLabel("westLongitude")).toBe("West longitude");
  });
});
