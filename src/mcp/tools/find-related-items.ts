/**
 * find_related_items — Related-Record Discovery Tool Handler
 *
 * Resolves the source through its repository's Canonical_API first (never
 * from Solr alone), then discovers related records: the source's own
 * repository uses its native related mechanism (DSpace MoreLikeThis /
 * Dataverse metadata query), while cross-repository discovery derives a
 * bounded keyword query from the source's public canonical metadata. Results
 * merge via balanced RRF, exclude the source, and enforce the clamped limit.
 *
 * Requirements: 7.1-7.6, 9.3, 15.3
 */

import { mergePages } from "../../federation/index";
import type {
  FindRelatedItemsInput,
  FindRelatedItemsOutput,
  ItemDetail,
  RepositoryId,
  RepositoryPage,
} from "../../models/index";
import { backendUnavailable, invalidInput, notFound } from "../errors";
import { ToolFailure } from "../errors";
import { classifyIdentifier, reportBackendFault } from "./get-item";
import { type ToolContext, selectRepositories } from "./search-items";

/** Bound on the metadata-derived cross-repository query (Requirement 10.6). */
const MAX_DERIVED_QUERY_LENGTH = 400;

/** Derive common-concept search terms from public canonical metadata only. */
export function deriveRelatedTerms(source: ItemDetail): string {
  return [source.title, ...source.creators.map((c) => c.name), ...source.subjects]
    .join(" ")
    .slice(0, MAX_DERIVED_QUERY_LENGTH)
    .trim();
}

export async function findRelatedItems(
  context: ToolContext,
  input: FindRelatedItemsInput,
): Promise<FindRelatedItemsOutput> {
  const identifier = classifyIdentifier(input.repository, input.identifier);
  if (identifier === null) {
    throw invalidInput(
      "The source identifier is not a recognized shape for the selected repository.",
    );
  }
  const sourceAdapter = context.adapters.get(input.repository);
  if (sourceAdapter === undefined) {
    throw invalidInput("The source repository is not available on this server.");
  }

  let source: ItemDetail | null;
  try {
    source = await sourceAdapter.get(identifier);
  } catch (cause) {
    if (cause instanceof ToolFailure) {
      throw cause;
    }
    reportBackendFault(context, "find_related_items", input.repository, cause);
    throw backendUnavailable();
  }
  if (source === null) {
    throw notFound();
  }
  const resolvedSource = source;

  const targets = selectRepositories(context, input.targetRepositories);
  const settled = await Promise.allSettled(
    targets.map(async (repository): Promise<[RepositoryId, RepositoryPage]> => {
      const adapter = context.adapters.get(repository);
      if (adapter === undefined) {
        return [
          repository,
          {
            repository,
            results: [],
            nextOffset: null,
            totalCandidates: 0,
            validationOmissions: 0,
            warnings: [],
          },
        ];
      }
      if (repository === resolvedSource.repository) {
        return [
          repository,
          await adapter.related(resolvedSource, {
            repositories: input.targetRepositories === "all" ? "all" : [repository],
            limit: input.limit,
          }),
        ];
      }
      // Cross-repository: common-concept keyword search derived from public
      // canonical metadata (design §11); IDs cannot collide across repos.
      const terms = deriveRelatedTerms(resolvedSource);
      if (terms.length === 0) {
        return [
          repository,
          {
            repository,
            results: [],
            nextOffset: null,
            totalCandidates: 0,
            validationOmissions: 0,
            warnings: [],
          },
        ];
      }
      return [
        repository,
        await adapter.search({
          query: terms,
          field: "keyword",
          limit: input.limit,
          offset: 0,
        }),
      ];
    }),
  );

  const pages = new Map<RepositoryId, RepositoryPage>();
  const failed: RepositoryId[] = [];
  let anySucceeded = false;
  settled.forEach((result, index) => {
    const repository = targets[index];
    if (repository === undefined) {
      return;
    }
    if (result.status === "fulfilled") {
      pages.set(result.value[0], result.value[1]);
      anySucceeded = true;
    } else {
      failed.push(repository);
    }
  });
  if (!anySucceeded) {
    throw backendUnavailable();
  }

  const merged = mergePages({ pages, cursor: null, limit: input.limit });
  const results = merged.results.filter((record) => record.id !== resolvedSource.id);

  return {
    source: {
      repository: input.repository,
      identifier: input.identifier,
      title: resolvedSource.title ?? null,
    },
    results,
    count: results.length,
    warnings: [
      ...failed.map((repository) => ({
        repository,
        code: "backend_unavailable" as const,
        message: `${repository === "jscholarship" ? "JScholarship" : "JHRDR"} was temporarily unavailable; related results may be incomplete.`,
      })),
      ...merged.warnings,
    ].slice(0, 10),
    retrievedAt: new Date().toISOString(),
  };
}
