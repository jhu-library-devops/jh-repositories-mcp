# ADR-014: Local Test Environment Mirrors the Deployed Solr and Postgres Topology

**Date:** 2026-10-26
**Status:** Accepted
**Deciders:** Platform engineering
**Supersedes:** N/A

## Context and Problem Statement

The server reads two Solr collections owned by two platforms and validates every candidate through each platform's public API ([ADR-005](./ADR-005-solr-candidates-canonical-api-gate.md)). A developer who wants to run it end to end needs DSpace, Dataverse, Solr, and Postgres on one machine. The DSpace and Dataverse projects each publish a compose file for their own development, and each starts its own standalone Solr and its own Postgres. The deployed stack differs: one SolrCloud serves both platforms, and the server validates each collection's schema once at startup. We had to decide how the local environment should be shaped, and whether to offer anything lighter than the full stack.

## Decision Drivers

- Failures that come from SolrCloud (a missing configset, a collection that does not exist yet, a half-formed cluster) should show up locally and not first in a deployed environment
- No collection or configset may be shared between platforms, so one platform's schema can never silently serve the other's documents
- A change to the transport, the tool schemas, or canonical resolution should be checkable in seconds, without minutes of platform startup
- One command should start it, and the platform versions should be easy to pin and bump

## Considered Options

1. **Mirror the deployed topology in one compose file, with a fixture-backed mock profile beside it.** Chosen. One SolrCloud (two Solr nodes on a three-node ZooKeeper ensemble) serves both platforms, with one owner per collection. One Postgres instance holds both platforms' databases.
2. **Run each platform's own compose file unchanged, with its standalone Solr and Postgres.** Rejected: it exercises standalone Solr, which the deployed stack does not use, so SolrCloud-specific failures stay hidden, and it needs two compose projects with separate networks and ports that the server must be joined to.
3. **A single-node SolrCloud with one ZooKeeper.** Rejected: it hides replica placement and the wait for every node to join, which are the conditions that leave a collection half-created.
4. **One Postgres instance per platform.** Rejected: DSpace and Dataverse share no tables, so a second instance adds a container and a version to track without isolating anything the separate databases and roles do not already isolate.
5. **A mock only.** Rejected: a mock replays canned pages and cannot show that a public filter excludes a withdrawn record or that a schema validates, which are the properties the real backends exist to test.

## Decision Outcome

A `real` profile starts DSpace, Dataverse, one Postgres 17 instance, and one SolrCloud. Each platform ships its Solr configset in its own image, and a one-shot provisioning job uploads each under the name `<owner>_<collection>` and creates every collection with a replica on each Solr node. The job stops with an error when a collection already exists bound to a different configset, because adopting it would let one platform's schema serve the other's documents. The server and both platforms wait for the job, because the server validates schemas once at startup and does not retry. A `mock` profile replays the sanitized fixtures through one small server and is for checking the assembled server, not search behavior.

### Positive Consequences

- A missing configset, an absent collection, or an unready cluster fails locally the way it would in a deployed environment.
- Collection and configset ownership is explicit in the names, and a clash fails provisioning instead of passing silently.
- The `mock` profile starts in seconds and needs no platform images.
- Platform versions are one variable each, and the stack runs from one command.

### Negative Consequences

- One Solr version has to serve both platforms. DSpace 10 and Dataverse 6.12 both build against Solr 9.8; bumping either can break the other, and the break appears when the collections load.
- Dataverse documents standalone Solr, so its metadata-block workflow changes: you upload the updated configset to ZooKeeper and reload the collection.
- One Postgres version has to suit both platforms. Dataverse 6.12 requires 17 or later for new installs, and DSpace's own compose file uses 15, so the shared instance relies on DSpace supporting 17. If a DSpace release does not, the platforms need separate instances again.
- The platforms restart together, and deleting the volumes removes both databases.
- Stock DSpace and Dataverse schemas can differ from the customized deployed ones, so readiness can fail locally on a field the profiles expect.
- The `real` profile is assembled from the platforms' container documentation. Image tags, environment variable names, and healthchecks need adjusting when a platform changes them.
- The `mock` profile never enforces the public filters, so it must not be read as evidence that a filter works. The integration suites carry that evidence.

## Links

- [Run the server locally](../guides/local-development.md)
- [Canonical gate](../architecture/canonical-gate.md)
