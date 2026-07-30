/**
 * Repository Resource Templates
 *
 * Implements the two v1 MCP resource templates:
 *   jhu-repo://jscholarship/item/{encodedIdentifier}
 *   jhu-repo://jhrdr/dataset/{encodedIdentifier}
 *
 * Resource reads resolve through the same canonical get_item path as the
 * tool — identical Public_Record gating and indistinguishable not-found.
 *
 * Requirements: 8.3-8.4, 9.3-9.5
 */

import type { ItemDetail, RepositoryId } from "../models/index";
import { getItem } from "./tools/get-item";
import type { ToolContext } from "./tools/search-items";

export const JSCHOLARSHIP_ITEM_TEMPLATE = "jhu-repo://jscholarship/item/{encodedIdentifier}";
export const JHRDR_DATASET_TEMPLATE = "jhu-repo://jhrdr/dataset/{encodedIdentifier}";

export interface ParsedResourceUri {
  repository: RepositoryId;
  identifier: string;
}

/**
 * Parse a jhu-repo:// resource URI into its repository and percent-decoded
 * identifier, or null when it matches neither template.
 */
export function parseResourceUri(uri: string): ParsedResourceUri | null {
  const match = /^jhu-repo:\/\/(jscholarship\/item|jhrdr\/dataset)\/(.{1,300})$/.exec(uri);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  const repository: RepositoryId = match[1] === "jscholarship/item" ? "jscholarship" : "jhrdr";
  let identifier: string;
  try {
    identifier = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  return { repository, identifier };
}

/** Build the canonical resource URI for a record (used in tool result links). */
export function resourceUriFor(repository: RepositoryId, identifier: string): string {
  const encoded = encodeURIComponent(identifier);
  return repository === "jscholarship"
    ? `jhu-repo://jscholarship/item/${encoded}`
    : `jhu-repo://jhrdr/dataset/${encoded}`;
}

/**
 * Read a repository resource by URI through canonical get_item resolution.
 * Throws the same ToolFailure shapes as the tool (invalid_input, not_found,
 * backend_unavailable).
 */
export async function readRepositoryResource(
  context: ToolContext,
  uri: string,
): Promise<ItemDetail> {
  const parsed = parseResourceUri(uri);
  if (parsed === null) {
    throw new Error("Unrecognized resource URI");
  }
  return getItem(context, { repository: parsed.repository, identifier: parsed.identifier });
}
