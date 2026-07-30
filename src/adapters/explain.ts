/**
 * Search-Strategy Explanation (concept level)
 *
 * Produces the per-repository explanation data for explain_search using the
 * same translation logic as real queries, then surfaces ONLY domain concept
 * names. Solr field names, hostnames, immutable filters, and raw query
 * syntax never leave this function.
 *
 * Requirements: 8.1-8.2
 */

import { jhrdrProfile } from "../../config/repositories/jhrdr-profile";
import type { RepositoryProfile } from "../../config/repositories/jscholarship-profile";
import { jscholarshipProfile } from "../../config/repositories/jscholarship-profile";
import type { ExplainSearchInput, RepositoryId } from "../models/index";
import { buildSearchQuery } from "./solr-query";

const PROFILES: Record<RepositoryId, RepositoryProfile> = {
  jscholarship: jscholarshipProfile,
  jhrdr: jhrdrProfile,
};

const SORT_LABELS: Record<string, string> = {
  relevance: "relevance (best match first)",
  date_desc: "date (newest first)",
  date_asc: "date (oldest first)",
  title_asc: "title (A to Z)",
};

export interface RepositoryStrategy {
  repository: RepositoryId;
  fieldsSearched: string[];
  filtersApplied: string[];
  filtersUnsupported: string[];
  sortApplied: string;
}

/**
 * Explain how one repository would interpret the search, in concept terms.
 */
export function explainRepositoryStrategy(
  repository: RepositoryId,
  input: ExplainSearchInput,
): RepositoryStrategy {
  const profile = PROFILES[repository];
  const concept = input.field ?? "keyword";
  const fieldsSearched =
    concept === "keyword"
      ? Object.keys(profile.queryFields).filter((key) => key !== "keyword")
      : [concept];

  // Reuse the real translation for exact applied/unsupported concept lists,
  // then discard the built query — nothing Solr-shaped is returned.
  const { appliedFilters, unsupportedFilters } = buildSearchQuery(profile, {
    query: input.query,
    field: input.field,
    filters: input.filters,
    sort: input.sort,
    limit: 1,
    offset: 0,
  });

  return {
    repository,
    fieldsSearched,
    filtersApplied: [...appliedFilters],
    filtersUnsupported: [...unsupportedFilters],
    sortApplied: SORT_LABELS[input.sort ?? "relevance"] ?? "relevance (best match first)",
  };
}
