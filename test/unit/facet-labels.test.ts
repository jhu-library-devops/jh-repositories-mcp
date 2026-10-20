/**
 * Unit Tests: DSpace Facet Label Decoding
 *
 * **Validates: Requirements 6.1, 6.3**
 *
 * Discovery stores *_filter values as `lowercase\n|||\nDisplay[###authority]`;
 * only the display value may reach a facet label.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { decodeFacetLabel } from "../../src/adapters/jscholarship/index";

describe("decodeFacetLabel", () => {
  test("returns the display value after the separator", () => {
    expect(decodeFacetLabel("philadelphia\n|||\nPhiladelphia")).toBe("Philadelphia");
  });

  test("drops an appended authority key", () => {
    expect(decodeFacetLabel("flags\n|||\nFlags###http://id.loc.gov/x")).toBe("Flags");
  });

  test("keeps a display value ending in # when an authority follows", () => {
    expect(decodeFacetLabel("c#\n|||\nC####http://id.loc.gov/x")).toBe("C#");
  });

  test("passes plain values through", () => {
    expect(decodeFacetLabel("2022")).toBe("2022");
    expect(decodeFacetLabel("0a1b2c3d-1111-2222-3333-444455556666")).toBe(
      "0a1b2c3d-1111-2222-3333-444455556666",
    );
  });

  test("never leaks the separator or an authority key", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 60 }).filter((s) => !s.includes("|||") && !s.includes("###")),
        // Authority keys are URIs or UUIDs: they never contain "#".
        fc.option(
          fc.string({ minLength: 1, maxLength: 40 }).filter((s) => !s.includes("#")),
          { nil: undefined },
        ),
        (display, authority) => {
          const raw = `${display.toLowerCase()}\n|||\n${display}${authority === undefined ? "" : `###${authority}`}`;
          const label = decodeFacetLabel(raw);
          expect(label).toBe(display.trim());
          expect(label.includes("|||")).toBe(false);
        },
      ),
      { numRuns: 150 },
    );
  });
});
