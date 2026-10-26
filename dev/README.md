# Local test environment

`compose.yaml` at the repo root offers two ways to run the MCP server against
something other than the private JHU backends. Pick one profile per run; both
publish the MCP at `http://localhost:3000/mcp`.

| Profile | What runs | Startup | Fidelity |
| --- | --- | --- | --- |
| `mock` | The MCP plus `dev/mock-backend`, a Bun server replaying `test/fixtures/` | seconds | Canned: every Solr `/select` returns the same page, so filters, sorts, paging and relevance are **not** exercised |
| `real` | The MCP plus DSpace, Dataverse, their Solr cores and Postgres | minutes, empty until loaded | Real Solr, real public-record filtering, real canonical APIs |

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

**Status:** written from the DSpace and Dataverse container documentation but
not yet booted end to end. Expect to adjust image tags or environment names.
Override tags with `DSPACE_TAG` (default `dspace-8_x`), `DATAVERSE_TAG`
(default `6.10.1`, the version in the fixtures) and `DATAVERSE_SOLR_TAG`.

Ports: DSpace API `8080`, DSpace Solr `8983`, Dataverse `8081`, Dataverse Solr
`8984` (see `compose.yaml` for the override variables).

Things to know:

- The MCP validates the Solr schemas **once at startup** and does not retry.
  `mcp-real` therefore waits for both Solr cores. If readiness is 503 anyway,
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
