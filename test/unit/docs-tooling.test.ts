/**
 * Documentation tooling: link rewriting for the site, source matching for the
 * impact and freshness reports, injected regions, schema flattening, and the
 * pinned terraform-docs version.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { rewriteRepositoryLink } from "../../docs/.vitepress/links";
import { TERRAFORM_DOCS_VERSION } from "../../scripts/docs/generators/infrastructure";
import { flattenSchema } from "../../scripts/docs/json-schema";
import { DocsScriptError, REPO_ROOT } from "../../scripts/docs/lib";
import { applyRegions } from "../../scripts/docs/regions";
import { sourceMatches } from "../../scripts/docs/sources";

const REPO = "https://github.com/jhu-library-devops/jh-repositories-mcp";

describe("rewriteRepositoryLink", () => {
  it("leaves links between published pages unchanged", () => {
    expect(rewriteRepositoryLink("./federation.md#the-cursor", "architecture/overview.md")).toBe(
      "./federation.md#the-cursor",
    );
    expect(rewriteRepositoryLink("../adr/README.md", "guides/x.md")).toBe("../adr/README.md");
  });

  it("rewrites links that leave the site to GitHub", () => {
    expect(rewriteRepositoryLink("../../CONTEXT.md", "architecture/overview.md")).toBe(
      `${REPO}/blob/main/CONTEXT.md`,
    );
    expect(rewriteRepositoryLink("../src/mcp/instructions.ts#L3", "related-resources.md")).toBe(
      `${REPO}/blob/main/src/mcp/instructions.ts#L3`,
    );
    expect(rewriteRepositoryLink("../../test/fixtures/", "guides/x.md")).toBe(
      `${REPO}/tree/main/test/fixtures`,
    );
  });

  it("rewrites links into unpublished directories", () => {
    expect(rewriteRepositoryLink("./spike/endpoint-routes.md", "index.md")).toBe(
      `${REPO}/blob/main/docs/spike/endpoint-routes.md`,
    );
  });

  it("leaves absolute URLs and anchors unchanged", () => {
    expect(rewriteRepositoryLink("https://example.org/a", "index.md")).toBe(
      "https://example.org/a",
    );
    expect(rewriteRepositoryLink("#caching", "index.md")).toBe("#caching");
  });
});

describe("sourceMatches", () => {
  it("matches files, directories, and globs", () => {
    expect(sourceMatches("src/index.ts", "src/index.ts")).toBe(true);
    expect(sourceMatches("src/index.ts", "src/index.test.ts")).toBe(false);
    expect(sourceMatches("src/federation/", "src/federation/index.ts")).toBe(true);
    expect(sourceMatches("src/federation", "src/federation/index.ts")).toBe(true);
    expect(sourceMatches("src/federation/", "src/federationx.ts")).toBe(false);
    expect(sourceMatches("config/repositories/*.ts", "config/repositories/jhrdr-profile.ts")).toBe(
      true,
    );
  });
});

describe("applyRegions", () => {
  const regions = new Map([["sample", "| a |\n| - |"]]);

  it("replaces the body of a region", () => {
    const text = "intro\n<!-- docs:inject sample -->\nstale\n<!-- /docs:inject -->\nend";
    expect(applyRegions("x.md", text, regions)).toBe(
      "intro\n<!-- docs:inject sample -->\n| a |\n| - |\n<!-- /docs:inject -->\nend",
    );
  });

  it("leaves markers inside fenced code blocks alone", () => {
    const text = "```md\n<!-- docs:inject sample -->\nexample\n<!-- /docs:inject -->\n```";
    expect(applyRegions("x.md", text, regions)).toBe(text);
  });

  it("rejects unknown and unclosed regions", () => {
    expect(() => applyRegions("x.md", "<!-- docs:inject other -->\n", regions)).toThrow(
      DocsScriptError,
    );
    expect(() => applyRegions("x.md", "<!-- docs:inject sample -->\nno close", regions)).toThrow(
      "no closing marker",
    );
  });
});

describe("flattenSchema", () => {
  it("flattens nested objects and arrays with requiredness and defaults", () => {
    const rows = flattenSchema({
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: 10 },
        limit: { type: "integer", default: 5, minimum: 1 },
        results: {
          type: "array",
          items: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        },
      },
    });
    expect(rows.map((row) => row.path)).toEqual(["query", "limit", "results", "results[].id"]);
    expect(rows[0]).toMatchObject({ required: true, constraints: "min length 1, max length 10" });
    expect(rows[1]).toMatchObject({ required: false, defaultValue: "5" });
    expect(rows[3]).toMatchObject({ type: "string", required: true });
  });
});

describe("terraform-docs pin", () => {
  it("matches between the generator and the CI setup action", () => {
    const action = readFileSync(
      join(REPO_ROOT, ".github/actions/setup-terraform-docs/action.yml"),
      "utf8",
    );
    expect(action).toContain(`VERSION: "${TERRAFORM_DOCS_VERSION}"`);
  });
});
