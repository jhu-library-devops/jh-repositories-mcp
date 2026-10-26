/**
 * Federation — Per-Repository Offset Computation (Cursor_V2)
 *
 * A Cursor_V2 per-repository offset is the next unexamined Solr position for
 * that repository: the page attempt's starting offset plus the number of
 * candidates consumed (passed + failed + timed-out) during the attempt. This
 * pure function is the single source of truth for that arithmetic, carried
 * per id by the N-way cursor.
 *
 * See design.md Cursor_V2 "Offset semantics".
 *
 * Requirements: 3.10, 12.3
 */

/**
 * Upper bound on any per-repository offset (design.md Cursor_V2, Req 3.3, 12.7).
 * Computed offsets are clamped to this ceiling so a cursor never records a
 * position the decode-time validation would reject.
 */
export const MAX_REPOSITORY_OFFSET = 1_000_000;

/**
 * Candidate disposition tallies for a single page attempt against one
 * repository. Every candidate examined during the attempt lands in exactly one
 * bucket; their sum is the number of Solr positions consumed.
 */
export interface CandidateConsumption {
  /** Candidates that passed validation and were eligible to be returned. */
  readonly passed: number;
  /** Candidates rejected by validation (e.g. public-record filtering). */
  readonly failed: number;
  /** Candidates abandoned because the per-attempt deadline elapsed. */
  readonly timedOut: number;
}

/** Total candidates consumed (passed + failed + timed-out) in an attempt. */
export function candidatesConsumed(consumption: CandidateConsumption): number {
  return consumption.passed + consumption.failed + consumption.timedOut;
}

/**
 * Compute the next per-repository offset for a Cursor_V2.
 *
 * The returned offset is the attempt's `startOffset` plus the candidates
 * consumed during it, representing the next unexamined Solr position. The
 * result is clamped to `MAX_REPOSITORY_OFFSET` so it stays within the bound the
 * cursor decoder enforces.
 *
 * @param startOffset The starting Solr offset for this page attempt.
 * @param consumption Candidate dispositions tallied during the attempt.
 * @throws RangeError if `startOffset` or any tally is negative or non-integer.
 */
export function computeNextOffset(startOffset: number, consumption: CandidateConsumption): number {
  assertNonNegativeInteger(startOffset, "startOffset");
  assertNonNegativeInteger(consumption.passed, "passed");
  assertNonNegativeInteger(consumption.failed, "failed");
  assertNonNegativeInteger(consumption.timedOut, "timedOut");

  const next = startOffset + candidatesConsumed(consumption);
  return Math.min(next, MAX_REPOSITORY_OFFSET);
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, received ${value}`);
  }
}
