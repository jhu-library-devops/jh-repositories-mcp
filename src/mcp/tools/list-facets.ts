/**
 * list_facets — Faceted Refinement Tool Handler
 *
 * Executes the selected repository adapters concurrently, then merges facet
 * values across repositories: values are combined only when their labels
 * normalize to the same form after case-folding, whitespace collapsing, and
 * punctuation removal, the display label is the most frequent original form,
 * and every facet is capped at 10 values ordered by count descending then
 * label ascending. The `repository` facet is synthesized from per-repository
 * result presence. Zero matches yield facet names with empty value arrays.
 *
 * Requirements: 6.1-6.6, 15.3
 */

import type {
  CommonFacet,
  FacetResult,
  FacetValue,
  ListFacetsInput,
  ListFacetsOutput,
  RepositoryFacets,
  RepositoryId,
  RepositoryWarning,
} from "../../models/index";
import { backendUnavailable, invalidInput } from "../errors";
import { type ToolContext, selectRepositories } from "./search-items";

const MAX_FACET_VALUES = 10;
const MAX_OUTPUT_WARNINGS = 10;

const DEFAULT_FACETS: readonly CommonFacet[] = [
  "repository",
  "creator",
  "subject",
  "year",
  "resourceType",
  "collection",
];

export async function listFacets(
  context: ToolContext,
  input: ListFacetsInput,
): Promise<ListFacetsOutput> {
  const requested = selectRepositories(context, input.repositories);
  if (requested.length === 0) {
    throw invalidInput("No requested repository is available on this server.");
  }
  const facetConcepts = input.facets ?? [...DEFAULT_FACETS];

  const settled = await Promise.allSettled(
    requested.map(async (repository): Promise<RepositoryFacets> => {
      const adapter = context.adapters.get(repository);
      if (adapter === undefined) {
        return { repository, facets: [], warnings: [] };
      }
      return adapter.facets({
        query: input.query ?? "",
        field: input.field,
        filters: input.filters,
        facets: facetConcepts.filter((concept) => concept !== "repository"),
        limit: MAX_FACET_VALUES,
        offset: 0,
      });
    }),
  );

  const perRepository: RepositoryFacets[] = [];
  const succeeded: RepositoryId[] = [];
  const failed: RepositoryId[] = [];
  settled.forEach((result, index) => {
    const repository = requested[index];
    if (repository === undefined) {
      return;
    }
    if (result.status === "fulfilled") {
      perRepository.push(result.value);
      succeeded.push(repository);
    } else {
      failed.push(repository);
    }
  });
  if (succeeded.length === 0) {
    throw backendUnavailable();
  }

  const warnings: RepositoryWarning[] = perRepository.flatMap((r) => r.warnings);
  const facets: FacetResult[] = [];
  for (const concept of facetConcepts) {
    if (concept === "repository") {
      facets.push(synthesizeRepositoryFacet(perRepository));
      continue;
    }
    facets.push({
      facet: concept,
      values: mergeFacetValues(
        perRepository.flatMap((repo) => repo.facets.find((f) => f.facet === concept)?.values ?? []),
      ),
    });
  }

  return {
    facets: facets.slice(0, 6),
    repositories: { requested, succeeded, failed },
    warnings: [
      ...failed.map((repository) => ({
        repository,
        code: "backend_unavailable" as const,
        message: `${repository === "jscholarship" ? "JScholarship" : "JHRDR"} was temporarily unavailable; facet counts may be incomplete.`,
      })),
      ...warnings,
    ].slice(0, MAX_OUTPUT_WARNINGS),
    retrievedAt: new Date().toISOString(),
  };
}

/**
 * The `repository` facet is a constant-identity facet (design §11): one value
 * per succeeded repository whose count is the sum of its own facet counts'
 * best available signal — the repository's largest single facet-value total.
 * When a repository returned no facet data the value is present with count 0
 * so clients still see coverage.
 */
function synthesizeRepositoryFacet(perRepository: RepositoryFacets[]): FacetResult {
  const values: FacetValue[] = perRepository.map((repo) => {
    const largest = repo.facets
      .flatMap((facet) => facet.values)
      .reduce((max, value) => Math.max(max, value.count), 0);
    return {
      label: repo.repository,
      count: largest,
      repositoryBreakdown: { [repo.repository]: largest },
    };
  });
  return { facet: "repository", values: sortFacetValues(values) };
}

/** Case-fold, collapse whitespace, and strip punctuation (Requirement 6.3). */
export function normalizeFacetLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Merge values across repositories only when labels normalize identically;
 * the display label is the most frequently occurring original form.
 */
export function mergeFacetValues(values: FacetValue[]): FacetValue[] {
  interface FacetGroup {
    total: number;
    breakdown: Partial<Record<RepositoryId, number>>;
    forms: Map<string, number>;
  }
  const groups = new Map<string, FacetGroup>();
  for (const value of values) {
    const key = normalizeFacetLabel(value.label);
    if (key.length === 0) {
      continue;
    }
    const group: FacetGroup = groups.get(key) ?? { total: 0, breakdown: {}, forms: new Map() };
    group.total += value.count;
    group.forms.set(value.label, (group.forms.get(value.label) ?? 0) + value.count);
    for (const [repository, count] of Object.entries(value.repositoryBreakdown ?? {})) {
      const id = repository as RepositoryId;
      group.breakdown[id] = (group.breakdown[id] ?? 0) + (count ?? 0);
    }
    groups.set(key, group);
  }

  const merged: FacetValue[] = [...groups.values()].map((group) => {
    let bestForm = "";
    let bestCount = -1;
    for (const [form, count] of group.forms) {
      if (count > bestCount || (count === bestCount && form < bestForm)) {
        bestForm = form;
        bestCount = count;
      }
    }
    return { label: bestForm, count: group.total, repositoryBreakdown: group.breakdown };
  });

  return sortFacetValues(merged).slice(0, MAX_FACET_VALUES);
}

/** Count descending, then label ascending (Requirement 6.3). */
function sortFacetValues(values: FacetValue[]): FacetValue[] {
  return [...values].sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));
}
