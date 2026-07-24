/**
 * JScholarship Endpoint Configuration
 *
 * Defines the internal network endpoints for the JScholarship (DSpace) adapter
 * in stage and production environments. All endpoints are private VPC resources
 * accessible only from ECS tasks in the shared private subnets.
 *
 * Requirements: 13.1-13.6
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RepositoryEndpoints {
  /** Solr base URL for candidate search (internal, HTTP). */
  readonly solrBaseUrl: string;

  /** Solr collection name. */
  readonly solrCollection: string;

  /** Full Solr collection URL (solrBaseUrl + /solr/ + collection). */
  readonly solrCollectionUrl: string;

  /** DSpace REST API base URL (internal, HTTP). */
  readonly apiBaseUrl: string;

  /** Public-facing base URL for constructing landing page links. */
  readonly publicBaseUrl: string;

  /** Health check path for the canonical API. */
  readonly apiHealthPath: string;

  /** Solr health check path. */
  readonly solrHealthPath: string;
}

export interface EndpointSecurityGroup {
  /** Security group ID. */
  readonly sgId: string;

  /** Human-readable name for documentation. */
  readonly name: string;

  /** Required ingress rule: port the MCP needs access to. */
  readonly ingressPort: number;

  /** Protocol (always "tcp" for HTTP). */
  readonly protocol: "tcp";
}

export interface EnvironmentEndpoints {
  readonly environment: "stage" | "production";
  readonly solr: RepositoryEndpoints;
  readonly securityGroups: {
    /** The DSpace ECS service security group (for REST API access). */
    readonly dspaceEcs: EndpointSecurityGroup;
    /** The Solr security group (for Solr query access). */
    readonly solr: EndpointSecurityGroup;
    /** The internal ALB security group (if routing through ALB). */
    readonly internalAlb: EndpointSecurityGroup;
  };
  /** Private subnet IDs where the MCP tasks will run. */
  readonly privateSubnets: readonly string[];
  /** VPC ID shared by DSpace, Dataverse, and MCP. */
  readonly vpcId: string;
}

// ─── Stage Endpoints ─────────────────────────────────────────────────────────

/**
 * Stage environment endpoint configuration.
 *
 * DSpace internal ALB (`private-dspace-stage-alb`) routes:
 *   - Port 80 → DSpace API container (port 8080), health: /server/api
 *   - Port 8983 → Solr container (port 8983), health: /
 *
 * Solr is also registered in Cloud Map as `solr.dspace-stage.local`
 * which resolves to the internal ALB IP addresses.
 *
 * The MCP connects to Solr through the internal ALB on port 8983
 * and to DSpace REST through the internal ALB on port 80.
 */
export const jscholarshipStageEndpoints = {
  environment: "stage",

  solr: {
    // Solr via internal ALB (port 8983 listener → solr target group)
    solrBaseUrl: "http://solr.dspace-stage.local:8983",
    solrCollection: "search",
    solrCollectionUrl: "http://solr.dspace-stage.local:8983/solr/search",

    // DSpace REST via internal ALB (port 80 listener → API target group port 8080)
    apiBaseUrl: "http://internal-private-dspace-stage-alb-1049626423.us-east-1.elb.amazonaws.com",
    // Alternative using Cloud Map: "http://api.dspace-stage.local"

    // Public JScholarship URL for constructing landing page links
    publicBaseUrl: "https://jscholarship.library.jhu.edu",

    // Health check paths
    apiHealthPath: "/server/api",
    solrHealthPath: "/",
  },

  securityGroups: {
    dspaceEcs: {
      sgId: "sg-016e167e731de03cb",
      name: "dspace-stage-ecs-service-sg",
      ingressPort: 8080,
      protocol: "tcp",
    },
    solr: {
      sgId: "sg-0b6c16eeac34e071d",
      name: "dspace-stage-solr-sg",
      ingressPort: 8983,
      protocol: "tcp",
    },
    internalAlb: {
      sgId: "sg-0e22b5c256c6efb60",
      name: "private-dspace-stage-alb-sg",
      ingressPort: 80,
      protocol: "tcp",
    },
  },

  privateSubnets: [
    "subnet-00ff7878ce3580b9f", // us-east-1a
    "subnet-0c094410fcd2b5e97", // us-east-1b
  ],

  vpcId: "vpc-07a15b94194398091",
} as const satisfies EnvironmentEndpoints;

// ─── Production Endpoints ────────────────────────────────────────────────────

/**
 * Production environment endpoint configuration.
 *
 * Production uses the same architecture as stage with `dspace-prod` naming.
 * Exact ALB DNS and security group IDs are populated during infrastructure
 * deployment. Placeholder values below document the expected structure.
 */
export const jscholarshipProductionEndpoints = {
  environment: "production",

  solr: {
    solrBaseUrl: "http://solr.dspace-prod.local:8983",
    solrCollection: "search",
    solrCollectionUrl: "http://solr.dspace-prod.local:8983/solr/search",
    apiBaseUrl: "http://internal-private-dspace-prod-alb.us-east-1.elb.amazonaws.com",
    publicBaseUrl: "https://jscholarship.library.jhu.edu",
    apiHealthPath: "/server/api",
    solrHealthPath: "/",
  },

  securityGroups: {
    dspaceEcs: {
      sgId: "sg-PLACEHOLDER-prod-ecs",
      name: "dspace-prod-ecs-service-sg",
      ingressPort: 8080,
      protocol: "tcp",
    },
    solr: {
      sgId: "sg-PLACEHOLDER-prod-solr",
      name: "dspace-prod-solr-sg",
      ingressPort: 8983,
      protocol: "tcp",
    },
    internalAlb: {
      sgId: "sg-PLACEHOLDER-prod-alb",
      name: "private-dspace-prod-alb-sg",
      ingressPort: 80,
      protocol: "tcp",
    },
  },

  privateSubnets: [
    "subnet-PLACEHOLDER-prod-1a",
    "subnet-PLACEHOLDER-prod-1b",
  ],

  vpcId: "vpc-PLACEHOLDER-prod",
} as const satisfies EnvironmentEndpoints;
