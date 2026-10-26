# Local test environment

`compose.yaml` at the repo root offers two ways to run the MCP server against
something other than the private JHU backends. Pick one profile per run; both
publish the MCP at `http://localhost:3000/mcp`.

| Profile | What runs | Startup | Fidelity |
| --- | --- | --- | --- |
| `mock` | The MCP plus `dev/mock-backend`, a Bun server replaying `test/fixtures/` | seconds | Canned: every Solr `/select` returns the same page, so filters, sorts, paging and relevance are **not** exercised |
| `real` | The MCP plus DSpace, Dataverse, Postgres, and a two-node SolrCloud on a three-node ZooKeeper ensemble serving both | minutes, empty until loaded | Real Solr, real public-record filtering, real canonical APIs |

```bash
docker compose --profile mock up --build      # or: --profile real
curl -i localhost:3000/health/ready           # 200 once schema validation passes
docker compose --profile mock down            # add -v to drop the real stack's data
```

The image build runs `tsc` and `bun test` (see `Dockerfile`), so the first
build is slow.

## Mock profile

Two records per repository are available, taken from the fixtures:

- JScholarship: `11111111-1111-1111-1111-111111111111` (handle `1774.2/99999`)
  and `22222222-2222-2222-2222-222222222222` (handle `1774.2/88888`)
- JHRDR: `doi:10.7281/T1ABCDEF` and `doi:10.7281/T1XYZ999`

```bash
curl -s localhost:3000/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_item","arguments":{"repository":"jhrdr","identifier":"doi:10.7281/T1XYZ999"}}}'
```

The mock does not enforce public filtering and never returns withdrawn or
restricted records; use the `test/integration` suites for that behavior.
`docker compose logs mock-backend` shows each request the MCP makes.

## Real profile

**Status:** written from the DSpace, Dataverse and Solr container documentation
but not yet booted end to end. Expect to adjust image tags or environment names.

**One SolrCloud for both repositories.** A two-node SolrCloud
(`solr1` and `solr2`) on a three-node ZooKeeper ensemble (`zoo1` to `zoo3`)
hosts DSpace's collections (`search`,
`authority`, `oai`, `statistics`, `qaevent`, `suggestion`, `audit`) and
Dataverse's `collection1`, as in the JHU deployment. On startup
`dspace-configsets` and `dataverse-configset` copy each platform's Solr
configset out of its image, and the one-shot `solr-init` job uploads them to
ZooKeeper and creates any missing collection (one shard with a replica on each
Solr node). It first waits until both Solr nodes are live, and on a re-run it
adds a replica to any node that lacks one, so a volume first created with fewer
nodes converges. It is safe to re-run. No collection or configset is shared: each collection belongs to one
platform and has its own configset, named `<owner>_<collection>`
(`dspace_search`, `dataverse_collection1`, ...). If a collection already exists
bound to a different configset, `solr-init` fails rather than adopting it.

This is a development stack, so it tracks the **latest** releases: DSpace 10.x
(`DSPACE_TAG`, default `dspace-10_x`; the backend runs the `-test` image of that
tag) and Dataverse 6.12.x (`DATAVERSE_TAG`, default `6.12.1-noble`). Both
currently build against Solr 9.8 (`SOLR_TAG`, default `9.8.0`), which is why one
cluster can serve both; re-check that when bumping either tag. Other overrides:
`ZOOKEEPER_TAG`, `DSPACE_POSTGRES_VERSION` (15), `DATAVERSE_POSTGRES_VERSION`
(17; Dataverse 6.12 needs 17+ for new installs). To test against the version
JHU runs instead, pin the tags (and `SOLR_TAG`) accordingly.

Caveats:

- Dataverse's documentation describes standalone Solr, so SolrCloud is the
  least-trodden path here. Changing its metadata blocks later means uploading
  the updated configset to ZooKeeper and reloading the collection, not the
  standalone `update-fields.sh` flow. A new Dataverse release can also change
  the Solr schema and require a reindex.
- DSpace's `solrconfig.xml` loads the ICU analysis jars through `<lib>`, which
  Solr 9.8+ only allows with `-Dsolr.config.lib.enabled=true`; the `solr`
  service sets it in `SOLR_OPTS`. If a DSpace collection fails to load, check
  `docker compose logs solr` for a missing-class error first.
- The JHU deployments are customized; stock images may lack fields the
  profiles in `config/repositories/` expect (see below).

The applications and the MCP reach Solr through the network alias `solr`, which
resolves to both nodes; any node can answer for any collection. `SOLR_HOST` pins
each node's registered name (`solr1:8983_solr`), so recreating a container keeps
its replicas. Losing one Solr node leaves every collection serving from the
other, but a single ZooKeeper failure is also tolerated only while two of three
members stay up.

Ports: DSpace API `8080`, Dataverse `8081`, Solr nodes `8983` (`solr1`) and
`8984` (`solr2`) (see `compose.yaml` for the override variables). Open
`http://localhost:8983/solr` for the Solr admin UI and its Cloud view.

Things to know:

- The MCP validates the Solr schemas **once at startup** and does not retry.
  `mcp-real` therefore waits for `solr-init` to finish creating the collections. If readiness is 503 anyway,
  `curl localhost:3000/health/ready` lists the missing required fields, then
  `docker compose --profile real restart mcp-real`.
- A stock DSpace or Dataverse schema may differ from the JHU deployments the
  profiles in `config/repositories/` were written against (JHU customizes
  both). Missing *required* fields fail readiness; missing optional ones
  degrade features and are reported as `disabledFeatures`.
- Both repositories start empty. The MCP only returns records that are public
  and validated through the platform API.

### Load a JScholarship (DSpace) record

```bash
docker compose --profile real exec dspace /dspace/bin/dspace create-administrator \
  -e admin@example.org -f Admin -l User -p password -c en
```

Create a community, collection and item through the DSpace REST API or the
`structure-builder` and Simple Archive Format `import` CLI commands, then
index them. Items must be archived, discoverable, not withdrawn, and readable
by the Anonymous group.

```bash
docker compose --profile real exec dspace /dspace/bin/dspace index-discovery -b
```

### Load a JHRDR (Dataverse) dataset

`dataverse-bootstrap` creates the root collection and the `dataverseAdmin`
superuser (development profile; see the container guide for credentials).
Create an API token in the UI at `http://localhost:8081`, then create and
publish a dataset:

```bash
export DV=http://localhost:8081 TOKEN=<api-token>
curl -H "X-Dataverse-key: $TOKEN" -H 'Content-Type: application/json' \
  -X POST "$DV/api/dataverses/root/datasets" --data-binary @dataset.json
curl -H "X-Dataverse-key: $TOKEN" -X POST \
  "$DV/api/datasets/:persistentId/actions/:publish?persistentId=<doi>&type=major"
```

Only published, non-deaccessioned datasets are returned by the MCP; drafts are
excluded by the immutable public filters.
