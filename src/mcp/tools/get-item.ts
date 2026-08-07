/**
 * get_item — Canonical Record Resolution Tool Handler
 *
 * Routes namespaced IDs, UUIDs, Handles, DOIs, and Dataverse persistent
 * identifiers to the correct repository adapter, classifies identifier shape
 * before any backend I/O, and enforces the indistinguishable not-found rule:
 * nonexistent and non-public records produce the same error shape.
 *
 * Requirements: 4.3, 5.1-5.5, 9.3-9.5, 12.5
 */

import type { RepositoryIdentifier } from "../../models/index";
import { parseRecordId } from "../../models/index";
import type { GetItemInput, ItemDetail } from "../../models/index";
import { ToolFailure, backendUnavailable, invalidInput, notFound } from "../errors";
import type { ToolContext } from "./search-items";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOI_SHAPE = /^(doi:)?10\.\d{4,9}\/\S{1,128}$/;
const HANDLE_SHAPE = /^(hdl:)?[0-9][0-9.]{0,20}\/[A-Za-z0-9._-]{1,64}$/;

/**
 * Classify a raw identifier string into a typed RepositoryIdentifier for the
 * given repository, or null when its shape matches nothing the repository
 * supports. Namespaced IDs must agree with the requested repository — a
 * mismatch is treated as malformed input, not probed against a backend.
 */
export function classifyIdentifier(
  repository: GetItemInput["repository"],
  raw: string,
): RepositoryIdentifier | null {
  const parsed = parseRecordId(raw);
  if (parsed !== null) {
    if (parsed.repository !== repository) {
      return null;
    }
    return { repository, type: "namespaced", value: raw };
  }
  if (repository === "jscholarship") {
    if (UUID_SHAPE.test(raw)) {
      return { repository, type: "uuid", value: raw };
    }
    if (HANDLE_SHAPE.test(raw) && !raw.startsWith("hdl:")) {
      return { repository, type: "handle", value: raw };
    }
    return null;
  }
  if (DOI_SHAPE.test(raw)) {
    return { repository, type: "doi", value: raw };
  }
  if (HANDLE_SHAPE.test(raw)) {
    return { repository, type: "persistent_id", value: raw };
  }
  return null;
}

export async function getItem(context: ToolContext, input: GetItemInput): Promise<ItemDetail> {
  const identifier = classifyIdentifier(input.repository, input.identifier);
  if (identifier === null) {
    throw invalidInput(
      "The identifier is not a recognized namespaced ID, UUID, Handle, DOI, or persistent identifier for the selected repository.",
    );
  }

  const adapter = context.adapters.get(input.repository);
  if (adapter === undefined) {
    throw invalidInput("The requested repository is not available on this server.");
  }

  let item: ItemDetail | null;
  try {
    item = await adapter.get(identifier);
  } catch (cause) {
    if (cause instanceof ToolFailure) {
      throw cause;
    }
    // Backend faults surface as a structured error with no internal detail
    // (Requirements 5.5, 15.3) — never as not_found.
    throw backendUnavailable();
  }

  if (item === null) {
    throw notFound();
  }
  return item;
}
