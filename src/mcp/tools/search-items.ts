/**
 * search_items — Federated Search Tool Handler
 *
 * Thin MCP adapter over the registry-resolved N-way federation service. It
 * bridges the handler's `ToolContext` adapter map to an `AdapterRegistry`,
 * delegates selector resolution, cursor decode/reconcile, window allocation,
 * deadline-bounded dispatch, N-way merge, and partial-result assembly to
 * `federatedSearch`, and maps the assembled result onto the canonical
 * `SearchItemsOutput` (cursor, repository status, warnings). The handler names
 * no concrete RepositoryId; every adapter is resolved through the registry
 * (Req 1.5).
 *
 * Requirements: 1.1-1.8, 4.1-4.7, 11, 12.4-12.5, 15.1-15.3
 */

import type { AdapterRegistry, RepositoryAdapter } from "../../adapters/index";
import { createRegistryFromAdapters, federatedSearch } from "../../federation/index";
import type { RepositoryId, SearchItemsInput, SearchItemsOutput } from "../../models/index";
import type { BackendFaultLog } from "../../observability/index";
import { backendUnavailable, invalidInput, repositoryNotAvailable } from "../errors";
import { reportBackendFault } from "./get-item";

const MAX_OUTPUT_WARNINGS = 10;

export interface ToolContext {
  adapters: Map<RepositoryId, RepositoryAdapter>;
  /**
   * The immutable registry built once at process init (task 15.2). When present,
   * the federated-search handler resolves adapters and weights through it rather
   * than rebuilding one per request; when absent (e.g. in unit tests that supply
   * only an adapter map), the handler falls back to {@link createRegistryFromAdapters}
   * so behavior is unchanged.
   */
  registry?: AdapterRegistry;
  /** Receives the cause behind an opaque `backend_unavailable`; defaults to no-op. */
  onBackendFault?: (fault: BackendFaultLog) => void;
}

/**
 * Resolve the `repositories` selector to the deployment's dispatch set.
 *
 * `all` targets every configured adapter; a single id targets only that
 * adapter when it is configured here. Shared with `list_facets`,
 * `find_related_items`, and `explain_search`, which gate on an empty result to
 * raise `repositoryNotAvailable` before any backend call.
 */
export function selectRepositories(
  context: ToolContext,
  selector: SearchItemsInput["repositories"],
): RepositoryId[] {
  const available = [...context.adapters.keys()];
  if (selector === "all") {
    return available;
  }
  // An array selector (Req 2.3/9.6) is deduplicated to the distinct configured
  // ids it names; a single-id string stays the single-element filter it was.
  if (Array.isArray(selector)) {
    const requested = new Set<RepositoryId>(selector);
    return available.filter((id) => requested.has(id));
  }
  return available.filter((id) => id === selector);
}

export async function searchItems(
  context: ToolContext,
  input: SearchItemsInput,
): Promise<SearchItemsOutput> {
  // Gate on deployment scope first so an unconfigured repository raises the
  // explicit "not available on this server" error rather than an unknown-id
  // rejection (Req 9.2 backward compatibility).
  const requested = selectRepositories(context, input.repositories);
  if (requested.length === 0) {
    throw repositoryNotAvailable(input.repositories, [...context.adapters.keys()]);
  }

  const registry = context.registry ?? createRegistryFromAdapters(context.adapters);
  const result = await federatedSearch(
    registry,
    {
      query: input.query,
      field: input.field,
      filters: input.filters,
      sort: input.sort,
      limit: input.limit,
      repositories: input.repositories,
      cursor: input.cursor,
    },
    {
      onBackendFault: (fault) =>
        reportBackendFault(context, "search_items", fault.repository, fault.cause, fault.effect),
    },
  );

  // A selector or cursor rejection means the request was invalid input and no
  // backend was called (Req 2.4, 3.4).
  if (result.kind === "rejected") {
    throw invalidInput(result.rejection.message);
  }

  // Every selected adapter failed: surface the structured backend error rather
  // than an empty success (Req 6.4).
  if (result.assembly.isError) {
    throw backendUnavailable();
  }

  const response = result.assembly.response;
  return { ...response, warnings: response.warnings.slice(0, MAX_OUTPUT_WARNINGS) };
}
