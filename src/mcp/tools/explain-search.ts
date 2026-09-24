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
import type { ExplainSearchInput, ExplainSearchOutput } from "../../models/index";
import { invalidInput, repositoryNotAvailable } from "../errors";
import { type ToolContext, selectRepositories } from "./search-items";

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

  const repositoryNames = requested
    .map((r) => (r === "jscholarship" ? "JScholarship (publications)" : "JHRDR (research data)"))
    .join(" and ");
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
    warnings: [],
    retrievedAt: new Date().toISOString(),
  };
}
