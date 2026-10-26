# Local test environment

`compose.yaml` at the repository root runs the MCP server against something other than the private JHU backends. Choose one profile per run. Both publish the server at `http://localhost:3000/mcp`, so a second profile fails to bind the port.

| Profile | What runs | Startup | What it exercises |
| --- | --- | --- | --- |
| `mock` | The server and `dev/mock-backend`, a Bun server that replays `test/fixtures/` | Seconds | The assembled server: transport, tool schemas, canonical resolution |
| `real` | The server, DSpace, Dataverse, Postgres, and one SolrCloud serving both repositories | Minutes, then empty until you load records | Real Solr, real public-record filtering, real canonical APIs |

## Run the stack

```bash
docker compose --profile mock up --build      # or: --profile real
curl -i localhost:3000/health/ready           # 200 once schema validation passes
docker compose --profile mock down            # add -v to delete the real stack's data
```

The image build runs `tsc` and `bun test` (see `Dockerfile`), so the first build is slow.

## Use the mock profile

The mock serves two records per repository, taken from the fixtures:

| Repository | Identifiers |
| --- | --- |
| JScholarship | `11111111-1111-1111-1111-111111111111` (Handle `1774.2/99999`) and `22222222-2222-2222-2222-222222222222` (Handle `1774.2/88888`) |
| JHRDR | `doi:10.7281/T1ABCDEF` and `doi:10.7281/T1XYZ999` |

```bash
curl -s localhost:3000/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_item","arguments":{"repository":"jhrdr","identifier":"doi:10.7281/T1XYZ999"}}}'
```

Do not use the mock to judge search behavior. Every Solr `/select` returns the same page whatever the query, so a broken filter, sort, or cursor still appears to work. The mock also never enforces the public filters and never returns a withdrawn or restricted record, so it cannot show that one is excluded. The `test/integration` suites cover that behavior.

`docker compose logs mock-backend` shows each request the server makes.

## Use the real profile

### Know the topology

One SolrCloud serves both repositories, as in the JHU deployment: two Solr nodes (`solr1`, `solr2`) on a three-node ZooKeeper ensemble (`zoo1` to `zoo3`). Each collection has one shard with a replica on each Solr node.

| Platform | Collections |
| --- | --- |
| DSpace (JScholarship) | `search`, `authority`, `oai`, `statistics`, `qaevent`, `suggestion`, `audit` |
| Dataverse (JHRDR) | `collection1` |

DSpace, Dataverse, and the server reach Solr through the network alias `solr`, which resolves to both nodes. Any node answers for any collection, so stopping one node leaves every collection serving from the other. `SOLR_HOST` pins each node's registered name (`solr1:8983_solr`), so recreating a container keeps its replicas instead of orphaning them under a new container ID. The ZooKeeper ensemble keeps its quorum while two of its three members are up.

### Know how provisioning works

On startup, `dspace-configsets` and `dataverse-configset` copy each platform's Solr configset out of its image. The one-shot `solr-init` job then:

1. Waits until both Solr nodes are live, so a collection is never created on a half-formed cluster.
2. Uploads each configset to ZooKeeper under the name `<owner>_<collection>`, for example `dspace_search` or `dataverse_collection1`.
3. Creates any missing collection with a replica on each node, and adds a replica to any node that lacks one, so a volume first created with fewer nodes converges.

No collection or configset is shared between platforms. If a collection already exists bound to a different configset, `solr-init` stops with an error. Adopting it would let one platform's schema silently serve the other's documents.

`solr-init` is safe to re-run. The server and both applications wait for it to finish, because the server validates the Solr schemas once at startup and does not retry. A server that starts before the collections exist stays at 503 on `/health/ready` until you restart it.

### Set image versions

The defaults follow the DSpace 10 and Dataverse 6.12 release lines. Override them with environment variables, for example `DSPACE_TAG=dspace-10.1 docker compose --profile real up`.

| Variable | Default | Notes |
| --- | --- | --- |
| `DSPACE_TAG` | `dspace-10_x` | The backend runs the `-test` image of this tag |
| `DATAVERSE_TAG` | `6.12.1-noble` | Applies to the application and its configbaker image |
| `SOLR_TAG` | `9.8.0` | Must suit both platforms; see below |
| `ZOOKEEPER_TAG` | `3.9` | |
| `DSPACE_POSTGRES_VERSION` | `15` | |
| `DATAVERSE_POSTGRES_VERSION` | `17` | Dataverse 6.12 requires 17 or later for new installs |

One Solr version has to serve both platforms. DSpace 10 and Dataverse 6.12 both build against Solr 9.8, which is why the cluster works. Check each platform's Solr version before you bump either tag, because a mismatch fails when the collections load. To test against the versions JHU runs, pin the tags and `SOLR_TAG` to match.

### Use the published ports

| Service | Host port | Override |
| --- | --- | --- |
| Server | `3000` | `MCP_PORT` |
| DSpace API | `8080` | `DSPACE_PORT` |
| Dataverse | `8081` | `DATAVERSE_PORT` |
| Solr `solr1` | `8983` | `SOLR_PORT` |
| Solr `solr2` | `8984` | `SOLR_PORT_2` |

Open `http://localhost:8983/solr` for the Solr admin UI and its Cloud view.

### Check the schemas

Stock DSpace and Dataverse schemas can differ from the customized JHU deployments that the profiles in `config/repositories/` describe. A missing required field leaves readiness at 503, and the response body from `curl localhost:3000/health/ready` names it. A missing optional field degrades a feature and appears as `disabledFeatures`.

Dataverse documents standalone Solr, and this stack runs it on SolrCloud. Changing its metadata blocks therefore means uploading the updated configset to ZooKeeper and reloading the collection. The standalone `update-fields.sh` flow does not apply. A Dataverse upgrade can also change the Solr schema and require a reindex.

DSpace's `solrconfig.xml` loads the ICU analysis jars through `<lib>`, which Solr 9.8 and later allow only with `-Dsolr.config.lib.enabled=true`. Both Solr nodes set it in `SOLR_OPTS`. Without it, a DSpace collection fails to load with a missing-class error in `docker compose logs solr1`.

### Load a JScholarship (DSpace) record

The real profile starts empty, and the server returns only records that are public and validated through the platform API. Create an administrator:

```bash
docker compose --profile real exec dspace /dspace/bin/dspace create-administrator \
  -e admin@example.org -f Admin -l User -p password -c en
```

Create a community, a collection, and an item through the DSpace REST API, or with the `structure-builder` and Simple Archive Format `import` commands. The item must be archived, discoverable, not withdrawn, and readable by the Anonymous group, because the server's public filters exclude anything else. Then index it:

```bash
docker compose --profile real exec dspace /dspace/bin/dspace index-discovery -b
```

### Load a JHRDR (Dataverse) dataset

`dataverse-bootstrap` creates the root collection and the `dataverseAdmin` superuser with the development profile; the container guide lists the credentials. Create an API token in the UI at `http://localhost:8081`, then create and publish a dataset:

```bash
export DV=http://localhost:8081 TOKEN=<api-token>
curl -H "X-Dataverse-key: $TOKEN" -H 'Content-Type: application/json' \
  -X POST "$DV/api/dataverses/root/datasets" --data-binary @dataset.json
curl -H "X-Dataverse-key: $TOKEN" -X POST \
  "$DV/api/datasets/:persistentId/actions/:publish?persistentId=<doi>&type=major"
```

Publish the dataset. The server returns only published, non-deaccessioned datasets, and a draft is excluded by the immutable public filters.

## Troubleshoot

| Symptom | Cause and fix |
| --- | --- |
| `/health/ready` stays 503 | Read the response body. A missing required field means the schema differs from the profile; a Solr connection error means `solr-init` has not finished or failed. Fix the cause, then run `docker compose --profile real restart mcp-real`. |
| `solr-init` exits with "different configset" | A collection with that name already exists from an earlier run with other configsets. Run `docker compose --profile real down -v` to delete the volumes and start clean. |
| `solr-init` times out waiting for nodes | A Solr node failed to join ZooKeeper. Check `docker compose logs zoo1 solr1 solr2`. |
| A container exits on start | The image tag, an environment variable name, or a healthcheck command does not match the image. The real profile is written from the platforms' container documentation, so check these first and adjust `compose.yaml`. |
