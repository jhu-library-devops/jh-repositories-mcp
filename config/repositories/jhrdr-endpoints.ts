/**
 * JHRDR (Dataverse) Endpoint Configuration — STUB
 *
 * TODO: Complete this file when Dataverse infrastructure tasks are executed.
 * Values below are derived from the design document and known infrastructure
 * but have NOT been validated against the live Dataverse deployment.
 *
 * Requirements: 13.1-13.6
 */

import type { EnvironmentEndpoints } from "./jscholarship-endpoints";

// ─── Stage Endpoints (STUB) ─────────────────────────────────────────────────

/**
 * Stage environment endpoint configuration for JHRDR / Dataverse.
 *
 * TODO: Validate these values against the live Dataverse stage deployment:
 *   - Confirm Solr Cloud Map DNS resolves correctly from private subnets
 *   - Confirm Dataverse app responds on port 8080 at the expected path
 *   - Confirm health check paths and expected responses
 *   - Verify security group IDs are current
 *   - Test connectivity from the shared private subnets
 *
 * Known routing:
 *   - Dataverse Solr: Cloud Map `solr.dataverse-stage.internal:8983`
 *   - Dataverse app: Cloud Map `dataverse.dataverse-stage.internal:8080`
 *   - Health: Solr admin ping or `/` ; Dataverse app at a version/info endpoint
 */
export const jhrdrStageEndpoints = {
  environment: "stage",

  solr: {
    // Dataverse Solr via Cloud Map service discovery
    solrBaseUrl: "http://solr.dataverse-stage.internal:8983",
    solrCollection: "collection1",
    solrCollectionUrl: "http://solr.dataverse-stage.internal:8983/solr/collection1",

    // Dataverse Native API (internal, HTTP)
    apiBaseUrl: "http://dataverse.dataverse-stage.internal:8080",

    // Public-facing base URL for constructing dataset landing page links
    // TODO: Confirm the public production/stage URL for JHRDR
    publicBaseUrl: "https://archive.data.jhu.edu",

    // Health check paths
    // TODO: Confirm the exact health/version endpoint for Dataverse 6.10.1
    apiHealthPath: "/api/info/version",
    solrHealthPath: "/solr/collection1/admin/ping",
  },

  securityGroups: {
    // TODO: The EnvironmentEndpoints type uses DSpace-specific key names
    // (dspaceEcs, solr, internalAlb). For JHRDR we repurpose them as:
    //   dspaceEcs → dataverseApp (the Dataverse application SG)
    //   solr → dataverseSolr (the Dataverse Solr SG)
    //   internalAlb → not applicable for Dataverse (direct Cloud Map routing)
    dspaceEcs: {
      sgId: "sg-0a08a43d3e2769417",
      name: "dataverse-stage-app-sg",
      ingressPort: 8080,
      protocol: "tcp",
    },
    solr: {
      sgId: "sg-05cc4195182af07c1",
      name: "dataverse-stage-solr-sg",
      ingressPort: 8983,
      protocol: "tcp",
    },
    internalAlb: {
      // TODO: Dataverse may not use an internal ALB. If it does, add the SG here.
      // Placeholder — remove or populate during Dataverse infrastructure validation.
      sgId: "sg-PLACEHOLDER-dv-stage-alb",
      name: "dataverse-stage-internal-alb-sg",
      ingressPort: 8080,
      protocol: "tcp",
    },
  },

  // Same VPC and private subnets as DSpace (shared infrastructure)
  privateSubnets: [
    "subnet-00ff7878ce3580b9f", // us-east-1a
    "subnet-0c094410fcd2b5e97", // us-east-1b
  ],

  vpcId: "vpc-07a15b94194398091",
} as const satisfies EnvironmentEndpoints;

// ─── Production Endpoints (STUB) ────────────────────────────────────────────

/**
 * Production environment endpoint configuration for JHRDR / Dataverse.
 *
 * TODO: Populate with real values during production Dataverse infrastructure work.
 */
export const jhrdrProductionEndpoints = {
  environment: "production",

  solr: {
    solrBaseUrl: "http://solr.dataverse-prod.internal:8983",
    solrCollection: "collection1",
    solrCollectionUrl: "http://solr.dataverse-prod.internal:8983/solr/collection1",
    apiBaseUrl: "http://dataverse.dataverse-prod.internal:8080",
    publicBaseUrl: "https://archive.data.jhu.edu",
    apiHealthPath: "/api/info/version",
    solrHealthPath: "/solr/collection1/admin/ping",
  },

  securityGroups: {
    dspaceEcs: {
      sgId: "sg-PLACEHOLDER-dv-prod-app",
      name: "dataverse-prod-app-sg",
      ingressPort: 8080,
      protocol: "tcp",
    },
    solr: {
      sgId: "sg-PLACEHOLDER-dv-prod-solr",
      name: "dataverse-prod-solr-sg",
      ingressPort: 8983,
      protocol: "tcp",
    },
    internalAlb: {
      sgId: "sg-PLACEHOLDER-dv-prod-alb",
      name: "dataverse-prod-internal-alb-sg",
      ingressPort: 8080,
      protocol: "tcp",
    },
  },

  privateSubnets: [
    "subnet-PLACEHOLDER-prod-1a",
    "subnet-PLACEHOLDER-prod-1b",
  ],

  vpcId: "vpc-PLACEHOLDER-prod",
} as const satisfies EnvironmentEndpoints;
