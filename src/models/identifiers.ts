/**
 * Record ID Namespacing
 *
 * Namespaced record IDs ensure identifiers from different repositories
 * cannot collide. Format: "repository:platformId"
 *
 * Examples:
 *   "jscholarship:abc123"
 *   "jhrdr:doi:10.7281/T1/EXAMPLE"
 *
 * Requirements: 4.3
 */

import type { RepositoryId } from "./index";

/** The separator used between repository and platform ID. */
const NAMESPACE_SEPARATOR = ":";

/** Valid repository IDs for parsing. */
const VALID_REPOSITORIES: ReadonlySet<string> = new Set<string>([
  "jscholarship",
  "jhrdr",
]);

/**
 * Create a namespaced record ID.
 *
 * @param repository - The repository that owns this record.
 * @param platformId - The platform-specific identifier (UUID, Handle, DOI, etc.).
 * @returns A namespaced ID in the format "repository:platformId".
 * @throws If repository or platformId is empty.
 */
export function createRecordId(
  repository: RepositoryId,
  platformId: string,
): string {
  if (!repository) {
    throw new Error("repository must not be empty");
  }
  if (!platformId) {
    throw new Error("platformId must not be empty");
  }
  return `${repository}${NAMESPACE_SEPARATOR}${platformId}`;
}

/**
 * Parse a namespaced record ID back into its components.
 *
 * The format is "repository:platformId" where repository is one of the
 * known RepositoryId values. The platformId may itself contain colons
 * (e.g., DOIs like "doi:10.7281/T1/EXAMPLE").
 *
 * @param id - The namespaced record ID to parse.
 * @returns The parsed components, or null if the format is invalid.
 */
export function parseRecordId(
  id: string,
): { repository: RepositoryId; platformId: string } | null {
  if (!id) {
    return null;
  }

  const separatorIndex = id.indexOf(NAMESPACE_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }

  const repositoryPart = id.slice(0, separatorIndex);
  const platformId = id.slice(separatorIndex + 1);

  if (!VALID_REPOSITORIES.has(repositoryPart)) {
    return null;
  }

  if (!platformId) {
    return null;
  }

  return {
    repository: repositoryPart as RepositoryId,
    platformId,
  };
}

/**
 * Check if two record IDs refer to the same namespaced record.
 *
 * By design, IDs from different repositories never collide due to the
 * namespace prefix. Two IDs collide only if they are byte-identical
 * (same repository AND same platform ID).
 *
 * @param id1 - First namespaced record ID.
 * @param id2 - Second namespaced record ID.
 * @returns true if the IDs are identical (same namespace and platform ID).
 */
export function recordIdsCollide(id1: string, id2: string): boolean {
  return id1 === id2;
}
