/**
 * Repository reference, generated from the repository profiles in
 * config/repositories/. Capability support is measured by running each MCP
 * concept through the real query builder, so the table cannot claim support
 * the builder would reject.
 *
 * Only MCP-level concepts and plain-language access rules are published.
 * Endpoints, security groups, and Solr field names stay in the profiles.
 */

import { jhrdrProfile } from "../../../config/repositories/jhrdr-profile";
import { jscholarshipProfile } from "../../../config/repositories/jscholarship-profile";
import { UnsafeQueryError, buildSearchQuery } from "../../../src/adapters/solr-query";
import {
  explainSearchInputSchema,
  filtersSchema,
  listFacetsInputSchema,
} from "../../../src/models/index";
import { GENERATED_BANNER, code, prose, table } from "../lib";

import type { RepositoryProfile } from "../../../config/repositories/jscholarship-profile";
import type { SearchFilters } from "../../../src/models/index";
import type { Generated } from "./types";

interface RepositoryDescription {
  readonly profile: RepositoryProfile;
  readonly name: string;
  readonly holds: string;
  readonly canonicalApi: string;
  readonly identifierForm: string;
}

const REPOSITORIES: readonly RepositoryDescription[] = [
  {
    profile: jscholarshipProfile,
    name: "JScholarship",
    holds: "Institutional repository: theses, dissertations, articles, and reports.",
    canonicalApi: "DSpace REST API",
    identifierForm: "`jscholarship:<uuid>`",
  },
  {
    profile: jhrdrProfile,
    name: "JHRDR",
    holds: "Johns Hopkins Research Data Repository: research datasets.",
    canonicalApi: "Dataverse Native API",
    identifierForm: "`jhrdr:<persistent-id>`",
  },
];

const PLATFORM_NAMES: Readonly<Record<RepositoryProfile["platform"], string>> = {
  dspace: "DSpace",
  dataverse: "Dataverse",
};

/** A sample value for each filter, enough to make the builder translate it. */
const FILTER_SAMPLES: Readonly<Record<keyof SearchFilters, SearchFilters>> = {
  dateFrom: { dateFrom: "2020" },
  dateTo: { dateTo: "2020" },
  creators: { creators: ["sample"] },
  subjects: { subjects: ["sample"] },
  resourceTypes: { resourceTypes: ["sample"] },
  collections: { collections: ["sample"] },
  access: { access: "open" },
};

const SEARCH_FIELDS = explainSearchInputSchema.shape.field.unwrap().options;
const SORT_OPTIONS = explainSearchInputSchema.shape.sort.unwrap().options;
const FACETS = listFacetsInputSchema.shape.facets.unwrap().element.options;
const FILTER_KEYS: readonly (keyof SearchFilters)[] = Object.keys(filtersSchema.shape).filter(
  (key): key is keyof SearchFilters => key in FILTER_SAMPLES,
);

type SearchFieldConcept = (typeof SEARCH_FIELDS)[number];
type SortConcept = (typeof SORT_OPTIONS)[number];

function builds(
  profile: RepositoryProfile,
  request: Parameters<typeof buildSearchQuery>[1],
): boolean {
  try {
    buildSearchQuery(profile, request);
    return true;
  } catch (error) {
    if (error instanceof UnsafeQueryError) {
      return false;
    }
    throw error;
  }
}

function supportsField(profile: RepositoryProfile, field: SearchFieldConcept): boolean {
  return builds(profile, { query: "sample", field, limit: 1, offset: 0 });
}

function supportsSort(profile: RepositoryProfile, sort: SortConcept): boolean {
  return builds(profile, { query: "sample", sort, limit: 1, offset: 0 });
}

function supportsFilter(profile: RepositoryProfile, key: keyof SearchFilters): boolean {
  const built = buildSearchQuery(profile, {
    query: "sample",
    filters: FILTER_SAMPLES[key],
    limit: 1,
    offset: 0,
  });
  return built.unsupportedFilters.length === 0 && built.appliedFilters.length > 0;
}

function supportsFacet(profile: RepositoryProfile, facet: string): boolean {
  // The repository facet is computed by federation, not by an adapter.
  return facet === "repository" || profile.facetFields[facet] !== undefined;
}

function mark(supported: boolean): string {
  return supported ? "yes" : "no";
}

function matrix<Concept extends string>(
  label: string,
  concepts: readonly Concept[],
  supports: (profile: RepositoryProfile, concept: Concept) => boolean,
): string {
  return table(
    [label, ...REPOSITORIES.map((repository) => repository.name)],
    concepts.map((concept) => [
      code(concept),
      ...REPOSITORIES.map((repository) => mark(supports(repository.profile, concept))),
    ]),
  );
}

function renderPage(): string {
  const sections: string[] = [
    GENERATED_BANNER,
    "",
    "# Repositories",
    "",
    "Each repository is served by its own adapter and described by a static profile in `config/repositories/`. A profile is code, not runtime configuration: changing what can be searched, filtered, or faceted means changing the profile and passing schema validation at startup.",
    "",
    table(
      ["ID", "Name", "Holds", "Platform", "Canonical API", "Record ID form"],
      REPOSITORIES.map((repository) => [
        code(repository.profile.id),
        repository.name,
        repository.holds,
        `${PLATFORM_NAMES[repository.profile.platform]} ${repository.profile.version}`,
        repository.canonicalApi,
        repository.identifierForm,
      ]),
    ),
    "",
    "## Search capabilities",
    "",
    "A concept marked `no` is never translated into backend syntax. For filters, the response carries an `unsupported_filter` warning and the rest of the search runs. An unsupported search field or sort fails for that repository; an unsupported facet is skipped with a warning.",
    "",
    "### Search fields (`field`)",
    "",
    matrix("Field", SEARCH_FIELDS, supportsField),
    "",
    "### Filters (`filters.*`)",
    "",
    matrix("Filter", FILTER_KEYS, supportsFilter),
    "",
    "### Sort options (`sort`)",
    "",
    matrix("Sort", SORT_OPTIONS, supportsSort),
    "",
    "### Facets (`list_facets`)",
    "",
    matrix("Facet", FACETS, supportsFacet),
    "",
    "## Public-access rules",
    "",
    "Every Solr request from an adapter carries its profile's immutable public filters. No client input can remove, weaken, or negate them. They only narrow the candidate set; each returned record is still confirmed public through the canonical API (see [Canonical gate](../architecture/canonical-gate.md)).",
  ];
  for (const repository of REPOSITORIES) {
    sections.push(
      "",
      `### ${repository.name}`,
      "",
      ...repository.profile.immutablePublicFilters.map(
        (filter) => `- ${prose(filter.description)}`,
      ),
    );
  }
  sections.push("", "## Full-text search", "");
  sections.push(
    table(
      ["Repository", "Enabled", "Rationale"],
      REPOSITORIES.map((repository) => [
        repository.name,
        mark(repository.profile.fulltextDecision.enabled),
        prose(repository.profile.fulltextDecision.rationale),
      ]),
    ),
    "",
  );
  return sections.join("\n");
}

export function generateRepositories(): Generated {
  return {
    files: [{ path: "docs/reference/repositories.md", content: renderPage() }],
    regions: [],
  };
}
