/**
 * Configuration Module — Public Interface
 *
 * Re-exports repository endpoint and profile configuration.
 * Provides a unified config-loading interface for the application.
 *
 * Requirements: 13.2-13.9, 10.2
 */

// Re-export endpoint configurations
export {
  jscholarshipStageEndpoints,
  jscholarshipProductionEndpoints,
  type RepositoryEndpoints,
  type EndpointSecurityGroup,
  type EnvironmentEndpoints,
} from "../../config/repositories/jscholarship-endpoints";

export {
  jhrdrStageEndpoints,
  jhrdrProductionEndpoints,
} from "../../config/repositories/jhrdr-endpoints";

// Re-export profile configuration
export {
  jscholarshipProfile,
  DSPACE_ANONYMOUS_GROUP,
  DSPACE_ARCHIVED_STATUS,
  type RepositoryProfile,
  type WeightedField,
  type SolrSort,
  type SolrFilterFactory,
} from "../../config/repositories/jscholarship-profile";

export {
  jhrdrProfile,
  DATAVERSE_PUBLISHED_STATUS,
  DATAVERSE_DEACCESSIONED_STATUS,
  DATAVERSE_ANONYMOUS_DISCOVERABLE,
} from "../../config/repositories/jhrdr-profile";

// Re-export environment validation
export { loadConfig } from "./env";

// ─── Environment Type ────────────────────────────────────────────────────────

export type Environment = "stage" | "production";

// ─── Application Configuration ───────────────────────────────────────────────

/**
 * Top-level application configuration, validated from environment variables.
 * Requirements: 13.2-13.9, 14.3-14.6, 15.1, 15.8
 */
export interface AppConfig {
  environment: Environment;
  port: number;
  buildVersion: string;
  buildCommit: string;

  /** Internal endpoint URLs — resolved from environment. */
  jscholarship: {
    solrCollectionUrl: string;
    apiBaseUrl: string;
    publicBaseUrl: string;
  };
  jhrdr: {
    solrCollectionUrl: string;
    apiBaseUrl: string;
    publicBaseUrl: string;
  };

  /** Timeout and resilience bounds. */
  timeouts: {
    solrMs: number;
    canonicalApiMs: number;
    overallDeadlineMs: number;
  };

  /** Concurrency limits. */
  concurrency: {
    maxToolConcurrency: number;
    maxCanonicalizationWorkers: number;
  };

  /** Cache configuration. */
  cache: {
    searchTtlMs: number;
    canonicalRecordTtlMs: number;
    maxEntries: number;
  };

  /** Security. */
  security: {
    allowedHosts: string[];
    allowedOrigins: string[];
    maxBodyBytes: number;
  };
}
