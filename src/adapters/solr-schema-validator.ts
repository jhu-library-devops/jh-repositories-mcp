/**
 * Solr Schema Validator
 *
 * Validates that the deployed Solr schema contains the fields required
 * by a RepositoryProfile. Used at startup to gate readiness.
 *
 * - Required fields missing → validation fails (readiness fails)
 * - Optional fields missing → logged as warning, features disabled
 *
 * Requirements: 6.2, 10.7, 13.9
 */

import type { RepositoryProfile } from "../../config/repositories/jscholarship-profile";
import type { RepositoryId, SchemaValidationResult } from "../models/index";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A fetch-like function that accepts a URL and optional init, returning a Response.
 * This type is used instead of `typeof fetch` to allow easy mocking in tests
 * without requiring platform-specific extensions (e.g. Bun's `preconnect`).
 */
export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface SolrSchemaValidatorOptions {
  /** Full URL to the Solr schema/fields endpoint (without the /fields suffix). */
  schemaUrl: string;
  /** The profile to validate against. */
  profile: RepositoryProfile;
  /** Timeout for the schema API call in ms. Defaults to 5000. */
  timeoutMs?: number;
  /** Injectable fetch function for testing. Defaults to global fetch. */
  fetchFn?: FetchFn;
}

/** Shape of Solr's /schema/fields response. */
interface SolrFieldsResponse {
  fields: Array<{ name: string; type?: string; [key: string]: unknown }>;
}

/** Shape of Solr's /schema/dynamicfields response. */
interface SolrDynamicFieldsResponse {
  dynamicFields: Array<{ name: string; type?: string; [key: string]: unknown }>;
}

// ─── Feature Mapping ─────────────────────────────────────────────────────────

/**
 * Maps optional field names to the feature they support.
 * Used to populate `disabledFeatures` when optional fields are missing.
 */
function featureForOptionalField(fieldName: string): string {
  if (fieldName.endsWith("_mlt")) {
    return `related_records_${fieldName.replace("_mlt", "")}`;
  }
  return `feature_${fieldName}`;
}

// ─── Dynamic Field Matching ──────────────────────────────────────────────────

/**
 * Check if a field name matches any dynamic field pattern.
 * Solr dynamic fields use patterns like `*_mlt`, `*_filter`, `*_sort`.
 */
function matchesDynamicPattern(
  fieldName: string,
  dynamicPatterns: string[],
): boolean {
  for (const pattern of dynamicPatterns) {
    if (pattern.startsWith("*")) {
      const suffix = pattern.slice(1);
      if (fieldName.endsWith(suffix)) {
        return true;
      }
    } else if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      if (fieldName.startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
}

// ─── Validator ───────────────────────────────────────────────────────────────

/**
 * Validate that the deployed Solr schema contains the fields
 * required by the RepositoryProfile.
 *
 * - Required fields missing → validation fails (readiness fails)
 * - Optional fields missing → logged as warning, features disabled
 */
export async function validateSolrSchema(
  options: SolrSchemaValidatorOptions,
): Promise<SchemaValidationResult> {
  const {
    schemaUrl,
    profile,
    timeoutMs = 5000,
    fetchFn = globalThis.fetch,
  } = options;

  const fieldsUrl = `${schemaUrl}/fields`;
  const dynamicFieldsUrl = `${schemaUrl}/dynamicfields`;

  // Fetch static fields
  const fieldNames = await fetchFieldNames(fieldsUrl, timeoutMs, fetchFn);

  // Fetch dynamic field patterns
  const dynamicPatterns = await fetchDynamicFieldPatterns(
    dynamicFieldsUrl,
    timeoutMs,
    fetchFn,
  );

  // Check required fields against deployed schema
  const missingRequired: string[] = [];
  for (const field of profile.requiredSchemaFields) {
    if (
      !fieldNames.has(field) &&
      !matchesDynamicPattern(field, dynamicPatterns)
    ) {
      missingRequired.push(field);
    }
  }

  // Check optional fields against deployed schema
  const missingOptional: string[] = [];
  const disabledFeatures: string[] = [];
  for (const field of profile.optionalSchemaFields) {
    if (
      !fieldNames.has(field) &&
      !matchesDynamicPattern(field, dynamicPatterns)
    ) {
      missingOptional.push(field);
      disabledFeatures.push(featureForOptionalField(field));
    }
  }

  return {
    repository: profile.id as RepositoryId,
    valid: missingRequired.length === 0,
    missingRequired,
    missingOptional,
    disabledFeatures,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchFieldNames(
  url: string,
  timeoutMs: number,
  fetchFn: FetchFn,
): Promise<Set<string>> {
  const response = await fetchWithTimeout(url, timeoutMs, fetchFn);

  if (!response.ok) {
    throw new SolrSchemaError(
      `Solr schema fields request failed: HTTP ${response.status} ${response.statusText}`,
      url,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SolrSchemaError(
      "Solr schema fields response is not valid JSON",
      url,
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("fields" in body) ||
    !Array.isArray((body as SolrFieldsResponse).fields)
  ) {
    throw new SolrSchemaError(
      "Solr schema fields response missing expected 'fields' array",
      url,
    );
  }

  const fields = (body as SolrFieldsResponse).fields;
  return new Set(fields.map((f) => f.name));
}

async function fetchDynamicFieldPatterns(
  url: string,
  timeoutMs: number,
  fetchFn: FetchFn,
): Promise<string[]> {
  const response = await fetchWithTimeout(url, timeoutMs, fetchFn);

  if (!response.ok) {
    throw new SolrSchemaError(
      `Solr dynamic fields request failed: HTTP ${response.status} ${response.statusText}`,
      url,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SolrSchemaError(
      "Solr dynamic fields response is not valid JSON",
      url,
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("dynamicFields" in body) ||
    !Array.isArray((body as SolrDynamicFieldsResponse).dynamicFields)
  ) {
    throw new SolrSchemaError(
      "Solr dynamic fields response missing expected 'dynamicFields' array",
      url,
    );
  }

  const dynamicFields = (body as SolrDynamicFieldsResponse).dynamicFields;
  return dynamicFields.map((f) => f.name);
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  fetchFn: FetchFn,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchFn(url, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SolrSchemaError(
        `Solr schema request timed out after ${timeoutMs}ms`,
        url,
      );
    }
    throw new SolrSchemaError(
      `Solr schema request failed: ${error instanceof Error ? error.message : String(error)}`,
      url,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ─── Error Type ──────────────────────────────────────────────────────────────

/**
 * Error thrown when Solr schema validation encounters a network or response issue.
 * Distinguished from a schema mismatch (which produces a valid SchemaValidationResult
 * with `valid: false`) — this represents an inability to even check the schema.
 */
export class SolrSchemaError extends Error {
  readonly url: string;
  readonly httpStatus?: number;

  constructor(message: string, url: string, httpStatus?: number) {
    super(message);
    this.name = "SolrSchemaError";
    this.url = url;
    this.httpStatus = httpStatus;
  }
}
