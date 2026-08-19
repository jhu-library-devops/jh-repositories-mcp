# Requirements Document

## Introduction

The current JScholarship/JHRDR MCP Server federation layer is hardcoded for exactly two repositories. The cursor encodes a fixed `jsOffset`/`dvOffset` pair, the tie-break alternates between two sources, and the merge logic assumes two `RepositoryPage` inputs. This specification generalizes the federation layer to support N repository adapters dynamically, so that a third adapter (such as Sheridan Libraries digital collections via AM Quartex/IIIF) can be added without modifying federation internals.

The scope is limited to the federation machinery: cursor encoding/decoding, tie-break ordering, adapter registration, merge logic, partial-result assembly, and the interfaces that connect adapters to the federation service. It does not specify a third adapter's implementation — that would be its own spec. It does not change the existing MCP tool surface, normalized data model, or public-access enforcement model. The existing two adapters (JScholarship, JHRDR) remain the initial registered set.

This specification builds on and references `.kiro/specs/jscholarship-jhrdr-mcp/`, particularly Requirements 1, 4, 6, 7, 8, 11, and 15 of that document and the federation, ranking, and cursor sections of its design.

## Glossary

- **Federation_Service**: The component that dispatches search, facet, and related-record requests to selected adapters and merges their results into a unified response.
- **Adapter_Registry**: The runtime registry of available RepositoryAdapter instances, keyed by RepositoryId.
- **RepositoryId**: A lowercase string identifier for a registered repository (e.g., `jscholarship`, `jhrdr`, `quartex`).
- **RepositoryAdapter**: A component implementing the adapter contract for a single repository backend.
- **Cursor_V2**: A versioned, variable-length pagination token carrying per-repository offsets for all repositories active in a federated query.
- **Tie_Sequence**: A deterministic round-robin ordering of repositories used to break equal fusion-score ties across pages.
- **Fusion_Weight**: A per-repository numeric weight used in reciprocal-rank score calculation.
- **Repository_Selector**: The user-facing parameter that selects which repositories to search; supports `all` or any subset of registered RepositoryIds.

## Requirements

### Requirement 1: Dynamic Adapter Registration

**User Story:** As a platform engineer, I want to register repository adapters at startup without modifying federation code, so that adding a third or fourth repository requires only a new adapter module and configuration.

#### Acceptance Criteria

1. THE Adapter_Registry SHALL accept registration of one or more RepositoryAdapter instances during process initialization, each identified by a unique RepositoryId, and SHALL complete all registration before the readiness probe reports healthy.
2. IF a duplicate RepositoryId is registered, THEN THE Adapter_Registry SHALL reject the duplicate and terminate the process with a non-zero exit code. IF no adapter is registered after initialization completes, THEN THE Adapter_Registry SHALL terminate the process with a non-zero exit code.
3. THE Adapter_Registry SHALL expose the set of registered RepositoryIds for use in input validation, cursor construction, and MCP tool discovery.
4. WHEN a RepositoryAdapter fails startup schema validation, THE Adapter_Registry SHALL exclude that adapter from search routing, facet, and related-record operations while allowing other adapters that pass schema validation to become ready. IF all registered adapters fail schema validation, THEN THE Adapter_Registry SHALL terminate the process with a non-zero exit code because no adapter is available to serve requests.
5. THE Federation_Service SHALL resolve adapters exclusively through the Adapter_Registry and SHALL NOT contain hardcoded references to specific RepositoryIds.
6. THE Adapter_Registry SHALL support repository-specific Fusion_Weight configuration expressed as a positive number in the range 0.01 through 100.0 inclusive, defaulting to equal weights of 1.0 when no weight is specified, and SHALL reject any configured weight outside this range at startup.

### Requirement 2: Generalized Repository Selector

**User Story:** As an MCP_Client, I want to search any combination of available repositories, so that I can target specific collections or search across all of them.

#### Acceptance Criteria

1. WHEN the Repository_Selector is `all` or is omitted, THE Federation_Service SHALL dispatch to every adapter whose startup schema validation succeeded and whose backend responded to the most recent health probe.
2. WHEN the Repository_Selector is a single RepositoryId, THE Federation_Service SHALL dispatch to only that adapter.
3. WHEN the Repository_Selector is an array of RepositoryIds, THE Federation_Service SHALL deduplicate the array and dispatch to exactly the distinct adapters identified, treating the array as a set.
4. IF a Repository_Selector contains a RepositoryId not present in the Adapter_Registry, THEN THE Federation_Service SHALL reject the entire request as invalid input before making any backend call.
5. IF a Repository_Selector targets an adapter that is registered but currently unavailable while at least one other targeted adapter is available, THEN THE Federation_Service SHALL return results from the available adapters together with a warning containing the unavailable repository identifier, a machine-readable code, and a human-readable message without internal endpoints or stack traces.
6. IF every adapter targeted by the Repository_Selector is currently unavailable, THEN THE Federation_Service SHALL return a structured `backend_unavailable` tool error identifying each unavailable repository without exposing internal hostnames or exception details.
7. THE MCP_Server SHALL advertise valid repository identifiers as an enumerated set within the JSON Schema of each tool's `repositories` input parameter so that clients can construct valid selectors without a separate discovery call.

### Requirement 3: Variable-Length Cursor

**User Story:** As a researcher paginating through results, I want cursors to work regardless of how many repositories participated in the search, so that adding a new repository does not invalidate the pagination model.

#### Acceptance Criteria

1. THE Cursor_V2 SHALL encode a version identifier, a normalized query hash, an ordered map of RepositoryId to next-offset pairs for every repository that participated in the query, the set of participating RepositoryIds, and the next Tie_Sequence position. The map SHALL be ordered by RepositoryId lexicographically to produce deterministic encoding.
2. THE Cursor_V2 SHALL support a number of repository offset entries from 1 up to the configured maximum registered adapter count (default 8), bounded by the maximum encoded size limit.
3. WHEN decoding a Cursor_V2, THE Federation_Service SHALL validate the version, query hash format, that all RepositoryIds in the cursor are currently registered, and that all offsets are non-negative integers no greater than 1,000,000.
4. IF a Cursor_V2 cannot be decoded due to structural corruption, unsupported version, or invalid encoding, THEN THE Federation_Service SHALL reject it as invalid input without querying any backend.
5. IF a Cursor_V2 contains a RepositoryId that is no longer registered, THEN THE Federation_Service SHALL reset pagination to the first page and include a `cursor_reset` warning with a reason indicating the repository set changed.
6. IF a Cursor_V2 is missing an offset for a repository that is now part of the selected set (a new adapter was added between pages), THEN THE Federation_Service SHALL start that repository from offset zero and include a `cursor_expanded` warning.
7. IF a Cursor_V2 query hash does not match the current normalized request, THEN THE Federation_Service SHALL reset all offsets to zero, return first-page results, and include a `cursor_reset` warning.
8. THE Cursor_V2 SHALL be serialized as canonical JSON and then base64url-encoded. The resulting encoded size SHALL NOT exceed 2048 bytes. IF the configured repository count would produce cursors exceeding this bound, THEN THE Federation_Service SHALL reject the configuration at startup rather than produce unusable cursors.
9. FOR equivalent inputs (after query normalization: lowercasing, whitespace collapsing, trimming, NFC Unicode normalization, sorted filter arrays, and omitted default-valued optional parameters), registered adapters, and unchanged indexes, THE Federation_Service SHALL produce deterministic cursor progression and identical result ordering.
10. THE Cursor_V2 per-repository offset SHALL represent the next unexamined Solr position for that repository, computed as the page's starting offset plus the number of candidates consumed (passed, failed, or timed-out) during that page attempt.

### Requirement 4: N-Way Reciprocal-Rank Merge

**User Story:** As a researcher, I want balanced results from all participating repositories, so that no single large collection dominates a cross-repository search regardless of how many repositories are searched.

#### Acceptance Criteria

1. THE MCP_Server SHALL preserve Repository_Rank produced by each adapter as a 1-based position within that adapter's validated result list and SHALL NOT directly compare raw relevance scores across repositories.
2. THE MCP_Server SHALL compute a fusion score for each result using the formula `fusionWeight / (k + repositoryRank)` where `k` is a configurable positive integer in the range 1 to 1000 (default 60) and `fusionWeight` is the repository's configured weight (default 1.0, equal across all repositories).
3. THE MCP_Server SHALL merge results from all repositories that returned results into a single list ordered by descending fusion score.
4. WHEN two or more results have equal fusion scores, THE MCP_Server SHALL break the tie by preferring the repository identified by the cursor's `nextTieSource` field, alternating the preference after each tie resolution, and then by ascending stable namespaced ID as the final deterministic tie-breaker.
5. THE MCP_Server SHALL NOT label the Federated_Rank as a probability, confidence, or cross-repository relevance score.
6. THE MCP_Server SHALL include `sourceRank` and `repository` on every result in the merged output.
7. WHEN only one repository is selected, THE MCP_Server SHALL preserve the adapter's native ordering without applying fusion scoring.
8. WHEN multiple repositories are selected but only one returns results due to a backend failure, THE MCP_Server SHALL preserve the responding adapter's native ordering without applying fusion scoring and SHALL include a warning identifying the unavailable repository.

### Requirement 5: N-Way Tie-Break Sequence

**User Story:** As a service owner, I want deterministic, balanced tie-breaking across N repositories, so that no repository is systematically favored or starved when results tie.

#### Acceptance Criteria

1. THE Tie_Sequence SHALL define a deterministic round-robin ordering over the set of repositories participating in the current query by sorting participating RepositoryIds lexicographically, producing a stable order independent of registration order.
2. WHEN two or more results from different repositories produce equal fusion scores during a balanced reciprocal-rank merge, THE Tie_Sequence SHALL select the repository at the current position in the round-robin ordering as the tie winner.
3. WHEN the Tie_Sequence is used to break a tie, THE Tie_Sequence position SHALL advance by one, wrapping to position zero after the last repository in the ordering.
4. THE Tie_Sequence starting position SHALL be carried in the Cursor and SHALL be initialized to position zero for a new query.
5. IF a query selects only a subset of registered repositories, THEN THE Tie_Sequence SHALL use only the repositories in the selected subset, re-deriving the lexicographic ordering from that subset.
6. THE Federation_Service SHALL produce identical result ordering for identical inputs and Tie_Sequence positions regardless of the order in which adapter responses arrive.
7. WHEN two results from different repositories have equal fusion scores and the Tie_Sequence selects the same repository, THE Tie_Sequence SHALL use the namespaced record ID as a final stable tie-breaker within that repository.

### Requirement 6: N-Way Partial-Result Assembly

**User Story:** As a researcher, I want results from healthy repositories even when some are down, so that a single backend failure does not block discovery across the entire federation.

#### Acceptance Criteria

1. WHEN one or more selected adapters fail (due to connection error, timeout after the configured per-call timeout and retry budget from Requirement 15.1–15.2, or non-transient error response) while at least one adapter succeeds, THE Federation_Service SHALL return a Partial_Result containing results from all successful adapters.
2. THE Federation_Service SHALL include a Repository-qualified warning for each failed adapter containing the repository identifier and a machine-readable failure code but not exposing internal endpoints, exception text, or stack traces.
3. THE Federation_Service SHALL report which repositories were requested, which succeeded, and which failed in the response metadata using the `repositories.requested`, `repositories.succeeded`, and `repositories.failed` arrays.
4. WHEN all selected adapters fail, THE Federation_Service SHALL return a structured MCP tool error with `isError: true` rather than an empty successful response.
5. THE Cursor emitted with a Partial_Result SHALL contain offsets only for repositories that contributed results; a failed repository SHALL have its offset omitted so that the next page re-attempts it from its last successfully recorded offset.
6. WHEN a previously failed repository recovers on a subsequent page request, THE Federation_Service SHALL include its results starting from the cursor's last known offset for that repository or from offset zero if no prior offset exists for that repository.
7. IF the overall tool deadline from Requirement 15.1 is reached after at least one adapter has returned validated results but before all adapters have responded, THEN THE Federation_Service SHALL return a Partial_Result from the completed adapters and SHALL include a warning identifying each timed-out repository.
8. IF an adapter's Canonical_API becomes unavailable after the adapter has already validated one or more candidates during the current page attempt, THEN THE Federation_Service SHALL include the already-validated results from that adapter in the response and SHALL emit a `validation_attrition` warning for that repository.

### Requirement 7: N-Way Facet Merging

**User Story:** As a researcher, I want facet counts that reflect all searched repositories, so that I can refine by people, subjects, or types without knowing which repository contributed what.

#### Acceptance Criteria

1. THE Federation_Service SHALL collect facet responses from all participating adapters and merge values that normalize to the same label after case-folding, whitespace collapsing, and removal of hyphens, parentheses, and trailing periods.
2. THE Federation_Service SHALL sum counts from merged values and SHALL report per-repository count breakdowns alongside the merged total.
3. THE Federation_Service SHALL select the display label using the most frequently occurring original form across all contributing repositories. IF two or more original forms occur with the same frequency, THEN THE Federation_Service SHALL select the form that sorts first in ascending Unicode order.
4. THE Federation_Service SHALL return no more than 10 values per facet, ordered by merged count descending and then display label ascending.
5. THE Federation_Service SHALL include a `repository` facet whose values are the RepositoryIds of all participating repositories with their respective Solr candidate counts for the current query and public filters.
6. WHEN a facet is not supported by one participating adapter, THE Federation_Service SHALL return values from supporting adapters only and SHALL NOT treat the unsupported facet as an error.
7. IF all participating adapters fail to return facet data, THEN THE Federation_Service SHALL return a structured error indicating backend unavailability without exposing internal endpoints or exception details.

### Requirement 8: Adapter Contract Stability

**User Story:** As a developer building a new adapter, I want a clear, stable contract that tells me exactly what to implement, so that my adapter integrates with the federation layer without coupling to other adapters.

#### Acceptance Criteria

1. THE RepositoryAdapter contract SHALL define `search`, `get`, `facets`, `related`, and `validateSchema` operations whose input and output types contain no Solr field names, repository-specific URLs, or platform API structures.
2. THE RepositoryAdapter contract SHALL NOT require adapters to import, reference, or receive instances of other registered adapters or the federation merge logic.
3. THE RepositoryPage returned by an adapter SHALL include: repository identifier, validated results with Repository_Rank (length no greater than the requested limit), next offset (null when Solr returned fewer candidates than requested), total candidates from the index, validation omissions count, and adapter-level warnings.
4. THE RepositoryAdapter contract SHALL require each adapter to implement and invoke its own public-access validation within its `search`, `get`, and `related` operations; the Federation_Service SHALL NOT perform access checks on adapter results.
5. THE RepositoryAdapter contract SHALL define a `probePublic` operation that accepts a repository identifier and returns a boolean indicating whether the record remains publicly accessible; adapters SHALL implement this operation to support cache revalidation.
6. THE RepositoryAdapter contract SHALL be versioned so that breaking changes produce a compile-time error rather than a runtime failure.
7. WHEN an adapter's `validateSchema` returns a result indicating one or more required schema fields are missing from the deployed Solr collection, THE Federation_Service SHALL exclude that adapter from dispatch and SHALL include a warning identifying the affected repository when a client selects it.
8. IF an adapter's backend is unreachable or returns a non-transient error during `search`, `get`, `facets`, or `related`, THEN the adapter SHALL return a structured failure containing the repository identifier and a machine-readable error code without exposing internal endpoints or exception details.
9. THE `validateSchema` operation SHALL return a result containing a success-or-failure status, the list of confirmed required fields, and the list of missing required fields so that the Federation_Service can determine dispatch eligibility without interpreting platform-specific schema responses.

### Requirement 9: Backward Compatibility

**User Story:** As an existing MCP_Client, I want the generalization to be transparent, so that my current tool calls, cursors, and workflows continue to work without changes.

#### Acceptance Criteria

1. WHEN the Federation_Service receives a Cursor V1 token (containing version `1`, a query hash, `jsOffset`, `dvOffset`, and `nextTieSource`), THE Federation_Service SHALL decode it and construct an equivalent Cursor_V2 by mapping `jsOffset` to the `jscholarship` offset, `dvOffset` to the `jhrdr` offset, and `nextTieSource` to the corresponding Tie_Sequence position. IF the decoded V1 query hash does not match the current normalized request, THEN THE Federation_Service SHALL reset pagination to the first page and include a `cursor_reset` warning.
2. THE MCP tool input schemas SHALL remain wire-compatible with the v1 specification defined in `.kiro/specs/jscholarship-jhrdr-mcp/`; the `repositories` parameter SHALL continue to accept `all`, a single RepositoryId string, or omission, and all previously valid tool inputs SHALL pass JSON Schema validation without modification.
3. WHILE only JScholarship and JHRDR are registered with equal Fusion_Weights, THE Federation_Service SHALL produce the same result ordering, cursor offsets, and warning codes as the current two-repository implementation for the same inputs. Timestamp fields (`retrievedAt`) and cursor encoding format are excluded from the identity comparison.
4. THE normalized RepositoryRecord schema SHALL NOT remove or change the type of any existing field; new repositories SHALL use the same output shape and SHALL populate the `repository` field with their RepositoryId and the `kind` field with a value from an extensible set that does not conflict with existing values (`repository_item`, `dataset`).
5. WHEN a new adapter is registered, THE `explain_search` tool SHALL include that adapter's RepositoryId and its human-readable description in the list of available repositories returned to the client.
6. WHEN an array-valued Repository_Selector is introduced, THE MCP_Server SHALL accept it as a JSON array of RepositoryId strings in the same `repositories` parameter, SHALL continue to accept the existing single-string and omitted forms without modification, and SHALL NOT remove or rename any existing input property.
7. THE Federation_Service SHALL NOT remove, rename, or change the type of any existing field in tool response envelopes (`results`, `count`, `cursor`, `repositories`, `warnings`, `retrievedAt`); new response fields SHALL be additive and optional.

### Requirement 10: Configuration and Limits

**User Story:** As a platform engineer, I want bounded, validated federation configuration, so that adding repositories cannot silently degrade performance or produce oversized responses.

#### Acceptance Criteria

1. THE MCP_Server SHALL enforce a maximum registered adapter count (configurable within the range 2 to 16 inclusive, default 8) and SHALL fail its readiness check and log a structured error event when the configured adapter count exceeds the bound.
2. THE MCP_Server SHALL validate at startup that each configured Fusion_Weight is a positive finite number no greater than 100, and SHALL fail its readiness check when any weight is zero, negative, non-finite, or exceeds the upper bound.
3. THE MCP_Server SHALL validate that the sum of per-repository over-fetch ceilings (3 × limit × number of selected repositories) does not exceed a configurable total canonicalization budget per request (default 150 candidates).
4. WHEN the total canonicalization budget would be exceeded, THE MCP_Server SHALL reduce per-repository fetch windows proportionally to their configured Fusion_Weights so that the sum of all per-repository windows equals the budget.
5. THE MCP_Server SHALL enforce an overall tool deadline (configurable within the range 1 to 10 seconds inclusive, default 10 seconds) that applies regardless of how many adapters are dispatched concurrently.
6. IF the overall tool deadline is exceeded, THEN THE MCP_Server SHALL return a Partial_Result with available results and a deadline_exceeded warning when at least one adapter has returned results, or a structured tool error when no results are available.
7. THE MCP_Server SHALL emit a CloudWatch metric for dispatch fan-out (number of adapters called per request) and SHALL trigger an alarm when fan-out on any single request equals or exceeds 75 percent of the configured maximum adapter count.

### Requirement 11: Observability for N Repositories

**User Story:** As a service owner, I want telemetry that scales with the number of repositories, so that I can identify which adapters are slow, failing, or producing high attrition.

#### Acceptance Criteria

1. THE Federation_Service SHALL emit per-repository latency in milliseconds, result count, validation omission count, and outcome (one of `success`, `partial`, or `error`) in every tool invocation log event.
2. THE Federation_Service SHALL publish per-repository CloudWatch metrics for invocation count, latency at the p50, p95, and p99 percentiles, error rate, validation omission rate, and availability, using the repository identifier as a metric dimension.
3. THE Federation_Service SHALL include the total adapter count and responding adapter count in each log event.
4. THE Federation_Service SHALL NOT log repository-specific query text, filter values, or response content regardless of the number of repositories.
5. WHEN a new adapter is registered, THE Federation_Service SHALL automatically include it in per-repository metric dimensions without manual metric configuration, deriving the dimension value from the adapter's repository identifier.
6. IF metric emission to CloudWatch fails, THEN THE Federation_Service SHALL continue processing the tool invocation, log the emission failure locally, and SHALL NOT return an error to the MCP_Client.

### Requirement 12: Cursor Codec Correctness

**User Story:** As a developer, I want verifiable cursor behavior across N repositories, so that pagination bugs from the generalization are caught by automated tests rather than researchers.

#### Acceptance Criteria

1. THE MCP_Server SHALL encode Cursor_V2 payloads containing 1 through 8 per-repository offsets using base64url without padding, such that decoding the encoded value produces a payload with field values identical to the original.
2. WHEN an MCP_Client supplies a query that differs from a previous request in query text (after lowercasing, whitespace collapsing, trimming, and NFC Unicode normalization), selected repositories, filters (after array sorting and default-value omission), sort, or limit, THE MCP_Server SHALL produce a query hash that differs from the previous request's hash and SHALL reset pagination to offset zero for all repositories.
3. THE MCP_Server SHALL compute each per-repository offset in the returned Cursor_V2 as the page's starting offset for that repository plus the number of candidates consumed (passed plus failed plus timed-out) during that page attempt for that repository.
4. WHILE the underlying repository indexes remain unchanged, THE MCP_Server SHALL produce the same Cursor_V2 values and the same result ordering for repeated invocations with the same normalized query, repositories, filters, sort, and limit.
5. THE Cursor_V2 encoding SHALL contain only characters from the base64url alphabet (A-Z, a-z, 0-9, hyphen, underscore) and SHALL NOT exceed 2048 bytes for payloads containing up to 8 per-repository offsets.
6. THE Cursor_V2 SHALL include the set of participating RepositoryIds in the encoded payload so that set-change detection does not depend on external state.
7. IF a Cursor_V2 value fails base64url decoding, contains an unsupported version number, has a non-integer or negative offset, or fails structural type validation, THEN THE MCP_Server SHALL reject it as invalid input before querying any backend.
8. IF a Cursor_V2 decodes successfully but its query hash does not match the normalized hash of the current request, THEN THE MCP_Server SHALL reset all per-repository offsets to zero, return results from the first page, and include a `cursor_reset` warning in the response.
