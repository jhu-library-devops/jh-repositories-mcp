# Implementation Plan: N-Repository Federation

## Overview

This plan generalizes the existing two-repository federation layer into an N-repository
layer driven by a runtime `Adapter_Registry`. It is a refactor/generalization of live code,
not a greenfield build. Work proceeds bottom-up through the pure-function cores (Cursor_V2
codec, N-way merge, Tie_Sequence, window allocation, facet merge) — each paired with its
property suite — then up through the registry, selector, partial-result assembly, versioned
adapter contract, configuration/limits, observability, and finally the end-to-end wiring that
replaces the two-pointer merge and the `FederatedCursorV1` codec in `src/federation/index.ts`.

Backward compatibility is a first-class target: V1 cursors still decode, existing tool inputs
still validate, and with only `jscholarship` and `jhrdr` registered at equal weights the
ordering, offsets, and warning codes match the current implementation.

All code is strict TypeScript under Bun with Biome formatting (2-space indent, 100-col, double
quotes, trailing commas). Property tests live in `test/property/`, run ≥100 generated cases with
`fast-check`, and are tagged `Feature: n-repository-federation, Property {n}: {text}`. Tests are
named `*.test.ts` in the matching `test/` subdirectory.

## Tasks

- [x] 1. Establish shared federation types and limits model
  - In `src/models/index.ts`, extend the `RepositoryWarning.code` union with the additive
    members `cursor_expanded`, `deadline_exceeded`, and `validation_attrition` (keep existing
    members and field types unchanged — additive only).
  - In `src/federation/`, define the shared type modules used by every component below:
    `FusionWeight`, `FederationLimits` (`maxAdapters` 2–16 default 8, `rrfK` 1–1000 default 60,
    `canonicalizationBudget` default 150, `deadlineMs` 1000–10000 default 10000), and
    `WeightConfig` (`weights: ReadonlyMap<RepositoryId, FusionWeight>`).
  - Define the `Cursor_V2` constants: `CURSOR_V2_VERSION = 2`, `MAX_ENCODED_CURSOR_BYTES = 2048`,
    `MAX_REPOSITORY_OFFSET = 1_000_000`.
  - _Requirements: 3.2, 3.8, 4.2, 6 (warning union), 10.1, 10.5, 12.5_

- [x] 2. Implement the Cursor_V2 codec (encode / decode / validate / V1→V2 map)
  - [x] 2.1 Implement canonical-JSON + base64url encoder and the `CursorV2`/`CursorV1`/`AnyCursor` types
    - Add `encodeCursorV2(cursor: CursorV2): string` to `src/federation/` serializing the payload
      as canonical JSON (keys sorted, `undefined` dropped) then base64url without padding.
    - Order `offsets` and `participating` lexicographically by `RepositoryId` so equivalent state
      encodes to identical bytes; assert the encoded result does not exceed `MAX_ENCODED_CURSOR_BYTES`.
    - _Requirements: 3.1, 3.8, 3.10, 12.1, 12.3, 12.5_

  - [x] 2.2 Write property test for cursor round-trip identity
    - **Property 1: Cursor round-trip identity**
    - **Validates: Requirements 3.1, 12.1**
    - Generate `CursorV2` payloads with 1–8 offsets; assert encode-then-decode yields identical
      version, query hash, offset map, participating set, and tie position. ≥100 runs.

  - [x] 2.3 Write property test for encoding alphabet and size bound
    - **Property 2: Cursor encoding alphabet and size bound**
    - **Validates: Requirements 3.8, 12.5**
    - Assert the encoded string uses only `A–Z a–z 0–9 - _`, carries no padding, and stays ≤2048
      bytes for up to 8 offsets. ≥100 runs.

  - [x] 2.4 Implement `decodeCursor` with full structural validation
    - Validate base64url decodes cleanly, `v` is a supported version, `queryHash` matches
      `^[0-9a-f]{16}$`, every id is currently registered, and every offset is a non-negative
      integer `≤ MAX_REPOSITORY_OFFSET`; return a `CursorDecodeErrorCode` on any failure so the
      caller rejects the request before any backend call.
    - _Requirements: 3.3, 3.4, 12.7_

  - [x] 2.5 Write property test for decode rejecting invalid tokens
    - **Property 4: Decode rejects invalid tokens before backend**
    - **Validates: Requirements 3.3, 3.4, 12.7**
    - Generate malformed/unsupported-version/negative-offset/over-bound/structurally-invalid
      tokens; assert each decodes to a rejection with no backend dispatch. ≥100 runs.

  - [x] 2.6 Implement the V1→V2 decode mapping
    - Accept a V1 token and map `jsOffset → jscholarship`, `dvOffset → jhrdr`, and `nextTieSource`
      to the round-robin position within the sorted participating subset; when the V1 query hash
      does not match the current request, reset to the first page with a `cursor_reset` warning.
    - _Requirements: 9.1_

  - [x] 2.7 Write unit tests for the exact V1→V2 two-repository mapping
    - Cover the concrete `{v:1, jsOffset, dvOffset, nextTieSource}` token: offset mapping, tie
      position (`jhrdr`→0, `jscholarship`→1), and hash-mismatch reset.
    - _Requirements: 9.1_

  - [x] 2.8 Write property test for V1→V2 equivalence
    - **Property 16: V1 cursor maps to equivalent V2 state**
    - **Validates: Requirements 9.1**
    - Generate valid V1 cursors with matching query hash; assert the mapped V2 offsets and tie
      position are equivalent. ≥100 runs.

- [x] 3. Implement query-hash normalization and offset computation
  - [x] 3.1 Implement the normalized query hash (FNV-1a 64-bit lowercase hex)
    - Normalize query text (lowercase, whitespace collapse, trim, NFC), sort filter arrays, omit
      default-valued optional parameters, and fold selected repositories/sort/limit into the hash.
    - _Requirements: 3.9, 12.2_

  - [x] 3.2 Write property test for query-hash sensitivity
    - **Property 3: Query hash sensitivity**
    - **Validates: Requirements 3.9, 12.2**
    - Assert differing normalized inputs produce differing hashes and normalization-equivalent
      inputs produce identical hashes. ≥100 runs.

  - [x] 3.3 Implement per-repository offset computation
    - Compute the next offset as the page's starting offset plus candidates consumed
      (passed + failed + timed-out) during the attempt.
    - _Requirements: 3.10, 12.3_

  - [x] 3.4 Write property test for offset computation
    - **Property 5: Offset computation**
    - **Validates: Requirements 3.10, 12.3**
    - Assert returned offset equals start offset plus consumed candidate count. ≥100 runs.

- [x] 4. Implement the N-way Tie_Sequence
  - [x] 4.1 Implement `deriveTieSequence`, `tieWinner`, and `advanceTie`
    - Build the round-robin ring as the participating ids sorted lexicographically, re-derived from
      the selected subset; select the id at `position`, advance one step wrapping to zero; seed
      `position` from the cursor's `nextTieSequence` (zero for a new query); when the current
      position points at a non-contributing repository, resolve among tied contributors by nearest
      forward position in the ring; fall back to the namespaced id as the final stable tiebreak.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 4.2 Write property test for tie-sequence fairness and advance
    - **Property 11: Tie-sequence fairness and advance**
    - **Validates: Requirements 5.1, 5.2, 5.3**
    - For subset size N and T consecutive ties, assert lexicographic round-robin with one-step
      advance and wrap, so over N ties each repository is selected exactly once. ≥100 runs.

  - [x] 4.3 Write property test for tie-sequence subset re-derivation
    - **Property 12: Tie-sequence subset re-derivation**
    - **Validates: Requirements 5.1, 5.5**
    - Assert the ring is the lexicographic order of exactly the selected subset, independent of
      registration order and the full registered set. ≥100 runs.

- [x] 5. Implement the N-way reciprocal-rank merge (replaces the two-pointer merge)
  - [x] 5.1 Implement `mergePages` over a map of per-repository rank queues
    - Preserve each adapter's 1-based `sourceRank`; never compare raw scores across repositories;
      compute `fusionScore = weight / (k + sourceRank)`; repeatedly take the greatest-score head
      until `limit` or all queues drain; stamp `sourceRank` and `repository` on every emitted
      record; emit the next `CursorV2` with offsets for contributing repositories only.
    - _Requirements: 4.1, 4.2, 4.3, 4.6_

  - [x] 5.2 Wire the Tie_Sequence into the merge and add single/single-responder passthrough
    - On an equal-score tie apply `Tie_Sequence` then ascending namespaced id as the final
      tiebreak; when exactly one repository is selected, or multiple are selected but only one
      returns results, preserve that adapter's native ordering with no fusion re-ranking and emit a
      warning naming the unavailable repository; never label the federated rank a probability,
      confidence, or cross-repository relevance score.
    - _Requirements: 4.4, 4.5, 4.7, 4.8, 5.7_

  - [x] 5.3 Write property test for merge determinism under reordering
    - **Property 7: Merge determinism under reordering**
    - **Validates: Requirements 4.3, 5.6**
    - Assert identical result ordering regardless of the order adapter pages are supplied, for a
      fixed tie-sequence position. ≥100 runs.

  - [x] 5.4 Write property test for fusion score ordering
    - **Property 8: Fusion score ordering**
    - **Validates: Requirements 4.2, 4.3**
    - Assert each record's fusion score is ≥ the next record's, except where resolved by tie
      sequence or namespaced id. ≥100 runs.

  - [x] 5.5 Write property test for single-responder passthrough
    - **Property 9: Single-responder passthrough**
    - **Validates: Requirements 4.7, 4.8**
    - Assert merged ordering equals the single responding adapter's native ordering with no fusion
      re-ranking. ≥100 runs.

  - [x] 5.6 Write property test for source attribution
    - **Property 10: Every result carries source attribution**
    - **Validates: Requirements 4.6**
    - Assert every merged record carries a `sourceRank` and a `repository`. ≥100 runs.

  - [x] 5.7 Write property test for final namespaced-id tiebreak
    - **Property 13: Final namespaced-id tiebreak**
    - **Validates: Requirements 5.7, 4.4**
    - For two tied records mapped to the same repository preference, assert the lexicographically
      smaller namespaced id is ordered first. ≥100 runs.

- [x] 6. Checkpoint - pure-function cores
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement the versioned adapter contract v2
  - [x] 7.1 Define `ADAPTER_CONTRACT_VERSION = 2` and the v2 `RepositoryAdapter` interface
    - In `src/adapters/index.ts`, pin the contract version, add the `contractVersion` field, and
      promote `probePublic` from optional to required; ensure `search`/`get`/`facets`/`related`/
      `validateSchema` input/output types contain no Solr field names, repository URLs, or platform
      API structures and that no adapter references another adapter or the merge logic.
    - Define `SchemaValidationResult` (status, confirmed required fields, missing required fields)
      and the structured adapter failure shape (repository id + machine-readable code, no endpoints
      or exception text).
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8, 8.9_

  - [x] 7.2 Conform the existing jscholarship and jhrdr adapters to contract v2
    - Set `contractVersion` and declare the now-required `probePublic` on both adapters in
      `src/adapters/{jscholarship,jhrdr}/`; confirm `validateSchema` returns a `SchemaValidationResult`.
    - _Requirements: 8.5, 8.6, 8.7, 8.9_

  - [x] 7.3 Write unit tests for the adapter contract surface
    - Assert both adapters declare contract version 2, expose `probePublic`, and return a
      well-formed `SchemaValidationResult` for success and missing-field cases.
    - _Requirements: 8.6, 8.7, 8.9_

- [x] 8. Implement the Adapter_Registry and `buildRegistry`
  - [x] 8.1 Implement the `AdapterRegistry` type and immutable construction
    - Implement `registeredIds()` (lexicographically sorted), `eligibleIds()`, `has`, `get`, and
      `weightOf`; construct once at startup and keep immutable thereafter.
    - _Requirements: 1.1, 1.3, 1.5, 1.6_

  - [x] 8.2 Implement `buildRegistry` with ordered fatal-error checks and schema wiring
    - Perform, in order: weight validation (0.01–100.0), max-count enforcement, duplicate-id
      detection, per-adapter `validateSchema`, all-fail check, and cursor-size bound check;
      exclude schema-failing adapters while allowing others to become ready; return a
      `RegistryFatalError` for `duplicate_repository_id`, `no_adapter_registered`,
      `all_adapters_schema_invalid`, `weight_out_of_range`, `adapter_count_exceeds_max`, and
      `cursor_size_bound_exceeded`.
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 3.8, 8.7, 10.1, 10.2_

  - [x] 8.3 Write unit tests for registry fatal-error cases
    - Cover duplicate id, empty registry, all-schema-invalid, out-of-range weight, over-max count,
      and cursor-size-bound breach, plus the schema-exclusion-but-others-ready path.
    - _Requirements: 1.2, 1.4, 1.6, 3.8, 8.7, 10.1, 10.2_

- [x] 9. Implement the generalized Repository_Selector
  - [x] 9.1 Implement `resolveSelector`
    - Resolve `all`/omitted to every eligible adapter that responded to the most recent health
      probe; a single id to that adapter; an array to its deduplicated set; and any unknown id to a
      `SelectorRejection` (`unknown_repository`) that rejects the request before any backend call.
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 9.2 Write unit tests for selector resolution
    - Cover `all`, single id, array, and unknown-id rejection.
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 9.3 Write property test for selector deduplication
    - **Property 15: Selector deduplication**
    - **Validates: Requirements 2.3**
    - Assert an array selector resolves to the distinct ids with no repository dispatched twice.
      ≥100 runs.

- [x] 10. Implement configuration, limits, and proportional window allocation
  - [x] 10.1 Implement `allocateFetchWindows` and budget enforcement
    - Validate the sum of per-repository over-fetch ceilings (`3 × limit × selectedCount`) against
      the canonicalization budget (default 150); when it would be exceeded, reduce per-repository
      fetch windows proportionally to configured weights so the windows sum to the budget.
    - _Requirements: 10.3, 10.4_

  - [x] 10.2 Write property test for proportional window allocation
    - **Property 18: Proportional window allocation sums to budget**
    - **Validates: Requirements 10.3, 10.4**
    - For selected sets whose ceilings exceed the budget, assert allocated windows sum to the budget
      and are proportional to configured weights. ≥100 runs.

  - [x] 10.3 Implement the overall tool deadline and fan-out metric + alarm
    - Enforce the deadline (default 10s) regardless of fan-out, producing a partial result with a
      `deadline_exceeded` warning when results exist or a structured tool error otherwise; emit a
      dispatch fan-out metric and configure the alarm to trigger at `≥75%` of max adapter count.
    - _Requirements: 10.5, 10.6, 10.7_

  - [x] 10.4 Write unit tests for limit boundaries and deadline behavior
    - Cover budget-boundary allocation, deadline-exceeded partial vs error, and the fan-out alarm
      threshold.
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.6, 10.7_

- [x] 11. Implement participating-set reconciliation and N-way partial-result assembly
  - [x] 11.1 Implement participating-set reconciliation
    - After a clean decode and before dispatch: reset to the first page with `cursor_reset` when a
      cursor id is no longer registered; start a newly selected id at offset zero with
      `cursor_expanded`; and reset all offsets to zero with `cursor_reset` on query-hash mismatch.
    - _Requirements: 3.5, 3.6, 3.7, 12.8_

  - [x] 11.2 Write property test for participating set carried in payload
    - **Property 6: Participating set carried in payload**
    - **Validates: Requirements 3.1, 12.6**
    - Assert the emitted cursor's `participating` set equals the set that participated, so
      set-change detection depends only on the payload. ≥100 runs.

  - [x] 11.3 Implement `assemblePartial`
    - Return a partial result with all successful adapters' results plus one repository-qualified
      warning per failure (id + machine-readable code, no endpoints/exception text/stack traces);
      populate `repositories.{requested,succeeded,failed}`; return a structured `isError: true`
      tool error when every selected adapter fails; emit `deadline_exceeded` on timeout-with-results
      and `validation_attrition` when a Canonical API drops after validating ≥1 candidate; emit a
      cursor whose offsets omit failed repositories.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 11.4 Write property test for partial-result cursor omitting failed repositories
    - **Property 14: Partial-result cursor omits failed repositories**
    - **Validates: Requirements 6.5, 6.6**
    - Assert the emitted cursor contains offsets only for contributing repositories so failed ones
      re-attempt from last recorded offset or zero. ≥100 runs.

  - [x] 11.5 Write unit tests for partial-assembly outcomes
    - Cover partial-success with per-repo warnings, all-fail structured error, and
      `deadline_exceeded`/`validation_attrition` warning emission.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 6.8_

- [x] 12. Implement N-way facet merging
  - [x] 12.1 Implement `mergeFacets`
    - Merge values that normalize to the same label (case-fold, whitespace collapse, remove hyphens,
      parentheses, trailing periods); sum counts with a per-repository breakdown; pick the display
      label as the most frequent original form, ties broken by ascending Unicode order; return at
      most 10 values per facet ordered by count descending then label ascending; include a
      `repository` facet of participating ids with Solr candidate counts; use supporting adapters
      only for an unsupported facet; return a structured backend-unavailability error when all
      participating adapters fail to return facet data.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 12.2 Write property test for facet count conservation
    - **Property 17: Facet count conservation**
    - **Validates: Requirements 7.2**
    - Assert each merged value's total equals the sum of its per-repository breakdown and the
      breakdown names only participating repositories. ≥100 runs.

  - [x] 12.3 Write unit tests for facet label normalization and ordering
    - Cover label-normalization examples, display-label selection with frequency ties, the 10-value
      cap/ordering, the `repository` facet, and the unsupported-facet and all-fail paths.
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 13. Generalize per-repository observability
  - [x] 13.1 Generalize telemetry to a per-repository collection
    - In `src/observability/index.ts`, emit `RepositoryTelemetry` per adapter (latency ms, result
      count, validation omission count, outcome) plus total and responding adapter counts in each
      invocation log; publish per-repository CloudWatch metrics (invocation count; p50/p95/p99
      latency; error rate; validation omission rate; availability) dimensioned by repository id,
      derived automatically for newly registered adapters; keep metric-emission failure non-fatal;
      keep the deny-by-default serializer so no query text, filter values, or response content is
      logged.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 13.2 Write unit tests for per-repository observability
    - Assert per-repository log fields and metric dimensions, automatic inclusion of a new adapter,
      non-fatal emission failure, and the serializer's suppression of query/filter/response content.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 14. Checkpoint - components assembled
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Wire the generalized federation service and MCP surface end-to-end
  - [x] 15.1 Replace the two-pointer dispatch in `src/federation/index.ts`
    - Replace the hardcoded two-adapter dispatch and `FederatedCursorV1` codec with the registry-
      resolved N-way pipeline: resolve the selector, decode/reconcile the cursor, allocate fetch
      windows, dispatch under the deadline, run the N-way merge + tie sequence, merge facets,
      assemble the partial result, and encode the next `Cursor_V2`; the federation service names no
      concrete RepositoryId.
    - _Requirements: 1.5, 3.1, 4.3, 6.1, 7.1, 10.4_

  - [x] 15.2 Wire startup/readiness and the MCP surface to the registry
    - Build the registry at process init before readiness reports healthy, terminating on fatal
      errors; advertise `registeredIds()` as the `repositories` enum (also accepting an array) while
      keeping `all`/single-string/omitted valid; list every registered adapter's id and description
      in `explain_search`; keep response envelope fields additive only.
    - _Requirements: 1.1, 2.7, 9.2, 9.5, 9.6, 9.7_

  - [x] 15.3 Write backward-compatibility integration tests
    - Against the assembled server: a stored V1 cursor paginates correctly; `repositories` inputs
      (`all`, single string, omitted) validate unchanged; and with only `jscholarship` and `jhrdr`
      registered at equal weights, result ordering, cursor offsets, and warning codes match the
      current two-repository implementation (excluding `retrievedAt` and cursor encoding format).
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 16. Add changelog fragment
  - Run `bun run changelog:new` and write a `changelog.d/*.changed.md` fragment describing the
    generalization to N-repository federation and the additive `Cursor_V2`, array-valued
    `repositories` selector, and new warning codes (do not hand-edit `CHANGELOG.md`).
  - _Requirements: 9.2, 9.6, 9.7_

- [x] 17. Final checkpoint - full verification
  - Run `bun run typecheck`, `bun test`, and `bun run lint`; fix any failures so the full suite
    passes. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; they are the property,
  unit, and integration test sub-tasks.
- Each task references the specific requirement sub-clauses and design components it implements.
- Property sub-tasks sit next to the pure-function component they verify (Cursor_V2 codec, query
  hash, offset computation, Tie_Sequence, N-way merge, window allocation, partial-result cursor,
  facet merge) so correctness regressions surface early. Every property runs ≥100 generated cases
  with `fast-check` in `test/property/`.
- Checkpoints provide incremental validation after the pure cores, after the components, and at
  the end.
- This is a generalization of live code: Task 15 replaces the existing two-pointer merge and
  `FederatedCursorV1` codec in `src/federation/index.ts` rather than adding a parallel path.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1", "3.1", "3.3", "4.1", "7.1", "9.1", "10.1", "13.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "2.4", "3.2", "3.4", "4.2", "4.3", "7.2", "9.2", "9.3", "10.2", "13.2"] },
    { "id": 2, "tasks": ["2.5", "2.6", "5.1", "7.3", "8.1", "10.3", "12.1"] },
    { "id": 3, "tasks": ["2.7", "2.8", "5.2", "8.2", "10.4", "12.2", "12.3"] },
    { "id": 4, "tasks": ["5.3", "5.4", "5.5", "5.6", "5.7", "8.3", "11.1", "11.3"] },
    { "id": 5, "tasks": ["11.2", "11.4", "11.5"] },
    { "id": 6, "tasks": ["15.1"] },
    { "id": 7, "tasks": ["15.2"] },
    { "id": 8, "tasks": ["15.3"] }
  ]
}
```
