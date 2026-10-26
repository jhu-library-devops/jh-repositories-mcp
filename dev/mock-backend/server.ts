/**
 * Lightweight mock of the four backends the MCP server talks to: the
 * JScholarship Solr `search` core and DSpace REST API, and the JHRDR Solr
 * `collection1` core and Dataverse Native API.
 *
 * It replays the sanitized payloads under test/fixtures/ and is meant for
 * poking at the assembled server (`compose --profile mock`), not for judging
 * search behavior: every /select returns the same canned page whatever the
 * query, so filters, sorts, paging, and relevance are NOT exercised. Public
 * filtering is likewise not enforced here; the fixtures simply contain only
 * public records.
 *
 * Routes (one process, one path prefix per repository):
 *   /jscholarship/solr/search/{select,schema/fields,schema/dynamicfields}
 *   /jscholarship/server/api/{core/items/:uuid,core/items/:uuid/bundles,pid/find}
 *   /jhrdr/solr/collection1/{select,schema/fields,schema/dynamicfields}
 *   /jhrdr/api/datasets/:persistentId/versions/:latest-published
 *   /health
 */

const FIXTURES = new URL("../../test/fixtures/", import.meta.url);
const PORT = Number(process.env.PORT ?? 8090);

async function fixture<T = Record<string, unknown>>(path: string): Promise<T> {
  return (await Bun.file(new URL(path, FIXTURES)).json()) as T;
}

async function fixtureText(path: string): Promise<string> {
  return Bun.file(new URL(path, FIXTURES)).text();
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const notFound = (): Response => json({ status: 404, error: "Not Found" }, 404);

// ─── JScholarship ────────────────────────────────────────────────────────────

const jsSolr = await fixture<{ response: { docs: Array<Record<string, unknown>> } }>(
  "jscholarship/solr-search-response.json",
);
const jsSchema = await fixture<{
  explicitFields: Record<string, unknown>;
  dynamicFieldPatterns: Record<string, unknown>;
}>("jscholarship/solr-schema.json");
const jsItemText = await fixtureText("jscholarship/dspace-rest-item.json");
const jsBundlesText = await fixtureText("jscholarship/dspace-rest-bundles.json");
const FIXTURE_UUID = "11111111-1111-1111-1111-111111111111";
const FIXTURE_HANDLE = "1774.2/99999";

/** uuid → handle for every item the canned Solr page can return. */
const jsItems = new Map<string, string>();
for (const doc of jsSolr.response.docs) {
  const uuid = doc["search.resourceid"];
  const handle = doc.handle;
  if (typeof uuid === "string" && typeof handle === "string") {
    jsItems.set(uuid, handle);
  }
}

function jsItem(uuid: string): string | null {
  const handle = jsItems.get(uuid);
  if (handle === undefined) {
    return null;
  }
  // The fixture describes one item; stamp its identifiers onto the others.
  return jsItemText.replaceAll(FIXTURE_UUID, uuid).replaceAll(FIXTURE_HANDLE, handle);
}

function jsApi(path: string, url: URL): Response {
  const bundles = /^core\/items\/([^/]+)\/bundles$/.exec(path);
  if (bundles?.[1] !== undefined) {
    return jsItems.has(bundles[1])
      ? new Response(jsBundlesText, { headers: { "content-type": "application/json" } })
      : notFound();
  }
  const item = /^core\/items\/([^/]+)$/.exec(path);
  if (item?.[1] !== undefined) {
    const body = jsItem(item[1]);
    return body === null
      ? notFound()
      : new Response(body, { headers: { "content-type": "application/json" } });
  }
  if (path === "pid/find") {
    const handle = url.searchParams.get("id")?.replace(/^hdl:/, "");
    const uuid = [...jsItems].find(([, h]) => h === handle)?.[0];
    return uuid === undefined
      ? notFound()
      : new Response(null, {
          status: 302,
          headers: { location: `/server/api/core/items/${uuid}` },
        });
  }
  return notFound();
}

// ─── JHRDR ───────────────────────────────────────────────────────────────────

const dvSolr = await fixture<{ response: { docs: Array<Record<string, unknown>> } }>(
  "jhrdr/solr-search-response.json",
);
const dvSchema = await fixture<{ explicitFields: Record<string, unknown> }>(
  "jhrdr/solr-schema.json",
);
const dvDatasetText = await fixtureText("jhrdr/dataverse-api-dataset.json");
const FIXTURE_PID = "doi:10.7281/T1ABCDEF";

const dvPids = new Set<string>(
  dvSolr.response.docs.flatMap((d) => (typeof d.identifier === "string" ? [d.identifier] : [])),
);

function dvApi(path: string, url: URL): Response {
  if (path !== "datasets/:persistentId/versions/:latest-published") {
    return notFound();
  }
  const pid = url.searchParams.get("persistentId");
  if (pid === null || !dvPids.has(pid)) {
    return notFound();
  }
  return new Response(dvDatasetText.replaceAll(FIXTURE_PID, pid), {
    headers: { "content-type": "application/json" },
  });
}

// ─── Solr (both cores) ───────────────────────────────────────────────────────

function solr(
  path: string,
  select: Record<string, unknown>,
  schema: { fields: string[]; dynamic: string[] },
): Response {
  switch (path) {
    case "select": {
      // Withdrawn/restricted examples ride along as reference data in the
      // fixture; a real Solr would never return them.
      const { _excluded_for_negative_testing: _omit, ...page } = select;
      return json(page);
    }
    case "schema/fields":
      return json({ responseHeader: { status: 0 }, fields: schema.fields.map((name) => ({ name })) });
    case "schema/dynamicfields":
      return json({
        responseHeader: { status: 0 },
        dynamicFields: schema.dynamic.map((name) => ({ name })),
      });
    default:
      return notFound();
  }
}

const fieldNames = (explicit: Record<string, unknown>): string[] =>
  Object.keys(explicit).filter((k) => !k.startsWith("$"));

// ─── Router ──────────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    console.log(`${request.method} ${path}${url.search}`);

    if (path === "/health") {
      return json({ status: "ok" });
    }

    const js = /^\/jscholarship\/(.*)$/.exec(path)?.[1];
    if (js !== undefined) {
      if (js.startsWith("server/api/")) {
        return jsApi(js.slice("server/api/".length), url);
      }
      if (js.startsWith("solr/search/")) {
        return solr(js.slice("solr/search/".length), jsSolr as Record<string, unknown>, {
          fields: fieldNames(jsSchema.explicitFields),
          dynamic: Object.keys(jsSchema.dynamicFieldPatterns),
        });
      }
    }

    const dv = /^\/jhrdr\/(.*)$/.exec(path)?.[1];
    if (dv !== undefined) {
      if (dv.startsWith("api/")) {
        return dvApi(dv.slice("api/".length), url);
      }
      if (dv.startsWith("solr/collection1/")) {
        return solr(dv.slice("solr/collection1/".length), dvSolr as Record<string, unknown>, {
          fields: fieldNames(dvSchema.explicitFields),
          dynamic: [],
        });
      }
    }

    return notFound();
  },
});

console.log(`mock backend listening on :${server.port}`);
