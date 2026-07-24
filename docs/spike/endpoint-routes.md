# Endpoint Routes — Private DSpace and Dataverse Access

**Task:** 1.3 — Select and test the private DSpace REST route and the Dataverse HTTP route from the shared private subnets.

**Status:** DSpace route validated. Dataverse route documented as stub (pending live validation).

**Requirements:** 13.1–13.6

---

## Summary

The MCP Fargate tasks run in the same private subnets as both repository deployments. All traffic between the MCP and repository services stays inside the VPC over HTTP — TLS is not required for internal east-west communication.

| Repository | Route Status | Configuration File |
| --- | --- | --- |
| JScholarship (DSpace) | Complete — validated against stage | `config/repositories/jscholarship-endpoints.ts` |
| JHRDR (Dataverse) | Stub — awaiting live validation | `config/repositories/jhrdr-endpoints.ts` |

---

## DSpace (JScholarship) — Complete

### DNS and Ports

| Service | DNS Name | Port | Protocol |
| --- | --- | --- | --- |
| Solr (search collection) | `solr.dspace-stage.local` | 8983 | HTTP |
| DSpace REST API (via internal ALB) | `internal-private-dspace-stage-alb-*.us-east-1.elb.amazonaws.com` | 80 | HTTP |
| DSpace REST API (via Cloud Map) | `api.dspace-stage.local` | 80 | HTTP |

### Listener Configuration

The **private DSpace internal ALB** (`private-dspace-stage-alb`) provides two listeners:

| Listener Port | Target Group | Container Port | Purpose |
| --- | --- | --- | --- |
| 80 | DSpace API target group | 8080 | REST API for canonical record resolution |
| 8983 | Solr target group | 8983 | Solr search collection queries |

Solr is also registered in Cloud Map as `solr.dspace-stage.local`, which resolves to the internal ALB IP addresses.

### Health Behavior

| Endpoint | Health Path | Expected Response | Used By |
| --- | --- | --- | --- |
| DSpace REST (port 80) | `/server/api` | HTTP 200 with HAL JSON | ALB target health check |
| Solr (port 8983) | `/` | HTTP 200 | ALB target health check |

The MCP uses these same health paths for startup dependency checks before declaring readiness.

### Security Group Rules Required

The MCP task security group needs ingress rules added to the following DSpace security groups:

| Target SG | SG ID | Rule | Purpose |
| --- | --- | --- | --- |
| DSpace ECS service | `sg-016e167e731de03cb` | TCP 8080 from MCP SG | Direct container access (fallback) |
| DSpace Solr | `sg-0b6c16eeac34e071d` | TCP 8983 from MCP SG | Solr query access |
| Private DSpace ALB | `sg-0e22b5c256c6efb60` | TCP 80 from MCP SG | REST API via internal ALB |

### Selected Route

The MCP connects to DSpace REST through the **internal ALB on port 80** rather than direct container access. This provides:
- Load balancing across DSpace API containers
- Built-in ALB health checking
- Consistent routing without task IP discovery

---

## Dataverse (JHRDR) — Stub

> **Note:** These values are from infrastructure documentation and the design spec. They have NOT been validated with live connectivity tests from the private subnets. Validation will occur when Dataverse-specific tasks are executed.

### DNS and Ports

| Service | DNS Name | Port | Protocol |
| --- | --- | --- | --- |
| Solr (collection1) | `solr.dataverse-stage.internal` | 8983 | HTTP |
| Dataverse Native API | `dataverse.dataverse-stage.internal` | 8080 | HTTP |

### Listener Configuration

Dataverse uses **Cloud Map service discovery** (not an internal ALB) for both Solr and the application. DNS names resolve directly to container/task IP addresses.

| DNS Record | Resolved Target | Port | Purpose |
| --- | --- | --- | --- |
| `solr.dataverse-stage.internal` | Solr task ENI IP | 8983 | Solr collection1 queries |
| `dataverse.dataverse-stage.internal` | Dataverse app task ENI IP | 8080 | Native API for canonical dataset resolution |

### Health Behavior

| Endpoint | Health Path (proposed) | Expected Response | Notes |
| --- | --- | --- | --- |
| Dataverse app (port 8080) | `/api/info/version` | HTTP 200 with version JSON | TODO: confirm exact path and response |
| Solr (port 8983) | `/solr/collection1/admin/ping` | HTTP 200 with ping status | TODO: confirm against deployed Solr |

### Security Group Rules Required

| Target SG | SG ID | Rule | Purpose |
| --- | --- | --- | --- |
| Dataverse app | `sg-0a08a43d3e2769417` | TCP 8080 from MCP SG | Native API access |
| Dataverse Solr | `sg-05cc4195182af07c1` | TCP 8983 from MCP SG | Solr query access |

### Open Questions (Dataverse)

- [ ] Confirm Cloud Map DNS resolution works from the shared private subnets
- [ ] Verify Dataverse health endpoint path and response format
- [ ] Confirm whether Dataverse uses an internal ALB or direct Cloud Map routing only
- [ ] Test actual HTTP connectivity to both Solr and the Dataverse app from a task in the private subnets

---

## Shared Infrastructure

Both repositories share the same VPC and private subnets:

| Resource | Value |
| --- | --- |
| VPC | `vpc-07a15b94194398091` |
| Private subnet (us-east-1a) | `subnet-00ff7878ce3580b9f` |
| Private subnet (us-east-1b) | `subnet-0c094410fcd2b5e97` |

The MCP ECS tasks will attach ENIs to these subnets, giving them direct network path to both DSpace and Dataverse services without NAT or peering.

---

## MCP Security Group Design

The MCP task security group (to be created in task 20.3) will:

- **Ingress:** Allow only the MCP public ALB security group on the application port.
- **Egress:** Restrict to DNS (UDP/TCP 53), the four repository endpoints listed above, and required AWS service endpoints (CloudWatch, ECR, etc.).

Cross-stack ingress rules are owned by the MCP infrastructure stack, referencing security group IDs exported from the repository stacks. This avoids circular dependencies.
