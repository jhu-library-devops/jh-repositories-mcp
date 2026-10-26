/**
 * explain_search — Search Interpretation Tool Handler
 *
 * A pure interpretation of validated domain concepts: which repositories
 * would be searched, which human-readable concepts the query targets, which
 * filters apply or are unsupported per repository, and the sort. Contains no
 * backend I/O and never emits Solr fields, hostnames, immutable filters,
 * credentials, or raw query syntax.
 *
 * Requirements: 8.1-8.2, 12.4
 */

import { explainRepositoryStrategy } from "../../adapters/explain";
import { UnsafeQueryError } from "../../adapters/solr-query";
import type { ExplainSearchInput, ExplainSearchOutput, RepositoryId } from "../../models/index";
import { invalidInput, repositoryNotAvailable } from "../errors";
import { type ToolContext, selectRepositories } from "./search-items";

/**
 * Human-readable description per registered RepositoryId, advertised by
 * `explain_search` for client discovery (Req 9.5). A new adapter adds its id
 * here; an id absent from this map falls back to its id so the list never omits
 * a registered repository.
 */
const REPOSITORY_DESCRIPTIONS: Readonly<Record<RepositoryId, string>> = {
  jscholarship: "JScholarship — JHU institutional repository of publications and theses",
  jhrdr: "JHRDR — Johns Hopkins Research Data Repository (research datasets)",
};

/**
 * List every registered adapter's id and human-readable description, sorted
 * lexicographically by id to match the registry's `registeredIds()` order
 * (Req 9.5). Derived from the context's adapter map so a newly registered
 * adapter appears here with no further change.
 */
function availableRepositories(context: ToolContext): ExplainSearchOutput["availableRepositories"] {
  return [...context.adapters.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((repository) => ({
      repository,
      description: REPOSITORY_DESCRIPTIONS[repository] ?? repository,
    }));
}

export function explainSearch(
  context: ToolContext,
  input: ExplainSearchInput,
): ExplainSearchOutput {
  const requested = selectRepositories(context, input.repositories);
  if (requested.length === 0) {
    throw repositoryNotAvailable(input.repositories, [...context.adapters.keys()]);
  }

  const strategies = requested.map((repository) => {
    try {
      return explainRepositoryStrategy(repository, input);
    } catch (cause) {
      if (cause instanceof UnsafeQueryError) {
        throw invalidInput(cause.message);
      }
      throw cause;
    }
  });

  const repositoryNames = requested.map((r) => REPOSITORY_DESCRIPTIONS[r] ?? r).join(" and ");
  const filterNote = strategies.some((s) => s.filtersUnsupported.length > 0)
    ? " Some requested filters are not supported by every repository and are reported per repository."
    : "";

  return {
    originalQuery: input.query,
    interpretation:
      `Your query will be matched as literal search terms against ${repositoryNames}, ` +
      `searching ${strategies[0]?.fieldsSearched.join(", ") ?? "the default fields"} ` +
      `and sorted by ${strategies[0]?.sortApplied ?? "relevance"}. ` +
      `Only publicly accessible records are ever searched or returned.${filterNote}`,
    repositoryStrategies: strategies,
    availableRepositories: availableRepositories(context),
    warnings: [],
    retrievedAt: new Date().toISOString(),
  };
}
