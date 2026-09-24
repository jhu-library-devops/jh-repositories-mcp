/**
 * search_items — Federated Search Tool Handler
 *
 * Orchestrates the selected repository adapters concurrently with normalized
 * per-repository requests derived from the federated cursor, merges pages
 * with balanced reciprocal-rank fusion, and assembles the canonical
 * SearchItemsOutput with cursor, repository status, and warnings.
 *
 * Requirements: 1.1-1.8, 4.1-4.7, 11, 12.4-12.5, 15.1-15.3
 */

import type { RepositoryAdapter } from "../../adapters/index";
import {
  EXHAUSTED_OFFSET,
  assembleResponse,
  computeQueryHash,
  cursorResetWarning,
  decodeCursor,
  encodeCursor,
  mergePages,
} from "../../federation/index";
import type { FederatedCursor } from "../../federation/index";
import type {
  RepositoryId,
  RepositoryPage,
  RepositoryWarning,
  SearchItemsInput,
  SearchItemsOutput,
} from "../../models/index";
import type { BackendFaultLog } from "../../observability/index";
import { backendUnavailable, invalidInput, repositoryNotAvailable } from "../errors";
import { reportBackendFault } from "./get-item";

const MAX_OUTPUT_WARNINGS = 10;

export interface ToolContext {
  adapters: Map<RepositoryId, RepositoryAdapter>;
  /** Receives the cause behind an opaque `backend_unavailable`; defaults to no-op. */
  onBackendFault?: (fault: BackendFaultLog) => void;
}

export function selectRepositories(
  context: ToolContext,
  selector: SearchItemsInput["repositories"],
): RepositoryId[] {
  const available = [...context.adapters.keys()];
  if (selector === "all") {
    return available;
  }
  return available.filter((id) => id === selector);
}

function emptyPage(repository: RepositoryId): RepositoryPage {
  return {
    repository,
    results: [],
    nextOffset: null,
    totalCandidates: 0,
    validationOmissions: 0,
    warnings: [],
  };
}

function cursorOffset(cursor: FederatedCursor, repository: RepositoryId): number {
  return repository === "jscholarship" ? cursor.jsOffset : cursor.dvOffset;
}

export async function searchItems(
  context: ToolContext,
  input: SearchItemsInput,
): Promise<SearchItemsOutput> {
  const requested = selectRepositories(context, input.repositories);
  if (requested.length === 0) {
    throw repositoryNotAvailable(input.repositories, [...context.adapters.keys()]);
  }

  const queryHash = computeQueryHash({
    query: input.query,
    repositories: input.repositories === "all" ? "all" : [input.repositories],
    field: input.field,
    filters: input.filters,
    sort: input.sort,
    limit: input.limit,
  });

  const extraWarnings: RepositoryWarning[] = [];
  let cursor: FederatedCursor | null = null;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(input.cursor);
    if (decoded === null) {
      throw invalidInput("The cursor is malformed or uses an unsupported version.");
    }
    if (decoded.queryHash !== queryHash) {
      // Stale cursor: reset to the first page with a warning (Req 11.5).
      const first = requested[0];
      if (first !== undefined) {
        extraWarnings.push(cursorResetWarning(first));
      }
    } else {
      cursor = decoded;
    }
  }

  const settled = await Promise.allSettled(
    requested.map(async (repository): Promise<[RepositoryId, RepositoryPage]> => {
      const offset = cursor === null ? 0 : cursorOffset(cursor, repository);
      if (offset === EXHAUSTED_OFFSET) {
        return [repository, emptyPage(repository)];
      }
      const adapter = context.adapters.get(repository);
      if (adapter === undefined) {
        return [repository, emptyPage(repository)];
      }
      const page = await adapter.search({
        query: input.query,
        field: input.field,
        filters: input.filters,
        sort: input.sort,
        limit: input.limit,
        offset,
      });
      return [repository, page];
    }),
  );

  const pages = new Map<RepositoryId, RepositoryPage>();
  const succeeded: RepositoryId[] = [];
  const failed: RepositoryId[] = [];
  const faults: Array<[RepositoryId, unknown]> = [];
  settled.forEach((result, index) => {
    const repository = requested[index];
    if (repository === undefined) {
      return;
    }
    if (result.status === "fulfilled") {
      pages.set(result.value[0], result.value[1]);
      succeeded.push(repository);
    } else {
      failed.push(repository);
      faults.push([repository, result.reason]);
    }
  });
  for (const [repository, cause] of faults) {
    reportBackendFault(
      context,
      "search_items",
      repository,
      cause,
      succeeded.length > 0 ? "partial_results" : "backend_unavailable",
    );
  }

  if (succeeded.length === 0) {
    throw backendUnavailable();
  }

  const mergeResult = mergePages({ pages, cursor, limit: input.limit, queryHash });
  const response = assembleResponse({
    mergeResult,
    requested,
    succeeded,
    failed,
    cursor: mergeResult.nextCursor === null ? null : encodeCursor(mergeResult.nextCursor),
    extraWarnings,
  });
  return { ...response, warnings: response.warnings.slice(0, MAX_OUTPUT_WARNINGS) };
}
