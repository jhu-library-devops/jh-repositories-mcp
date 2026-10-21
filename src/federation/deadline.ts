/**
 * Federation — Overall Tool Deadline Enforcement
 *
 * The overall tool deadline (default 10s, configurable 1000–10000 ms) bounds a
 * whole tool invocation regardless of how many adapters are dispatched
 * concurrently (Req 10.5). This module runs the N-way dispatch under that
 * deadline and reports a partial-vs-error signal so the caller can assemble the
 * right response:
 *
 * - Dispatch completes before the deadline → `completed`, carrying the dispatch
 *   value unchanged.
 * - Deadline is reached while at least one adapter has already returned results
 *   → `partial`: the caller emits a `deadline_exceeded` warning alongside the
 *   results gathered so far (Req 10.6, first clause).
 * - Deadline is reached with no results available → `deadline_exceeded`: the
 *   caller returns a structured tool error (Req 10.6, second clause).
 *
 * The helper is deliberately pure of federation or repository knowledge: the
 * caller supplies the dispatch promise, a way to snapshot whatever partial
 * results have accumulated, and the deadline. Deciding whether a partial result
 * "has results" is the caller's by way of the `hasPartialResults` predicate so
 * this module never inspects repository payloads.
 *
 * See design.md "Configuration and Limits" (FederationLimits.deadlineMs default
 * 10000, range 1000–10000) and the deadline/partial-result rows of the
 * decision table.
 *
 * Requirements: 10.5, 10.6
 */

/** Minimum overall tool deadline in milliseconds (Req 10.5). */
export const MIN_DEADLINE_MS = 1_000;

/** Maximum overall tool deadline in milliseconds (Req 10.5). */
export const MAX_DEADLINE_MS = 10_000;

/** Default overall tool deadline in milliseconds (Req 10.5). */
export const DEFAULT_DEADLINE_MS = 10_000;

/**
 * Outcome of running a dispatch under the overall tool deadline.
 *
 * - `completed`: dispatch resolved before the deadline; `value` is its result.
 * - `partial`: the deadline was reached with results already available; the
 *   caller emits a `deadline_exceeded` warning and returns those results.
 * - `deadline_exceeded`: the deadline was reached with no results; the caller
 *   returns a structured tool error.
 */
export type DeadlineOutcome<DispatchResult, PartialSnapshot> =
  | { readonly kind: "completed"; readonly value: DispatchResult }
  | { readonly kind: "partial"; readonly partial: PartialSnapshot }
  | { readonly kind: "deadline_exceeded" };

/**
 * Inputs to {@link runUnderDeadline}.
 *
 * @typeParam DispatchResult   What the dispatch resolves to when it finishes in time.
 * @typeParam PartialSnapshot  A snapshot of results accumulated so far, taken only
 *                             if the deadline fires first.
 */
export interface DeadlineOptions<DispatchResult, PartialSnapshot> {
  /** The in-flight N-way dispatch (fan-out across all selected adapters). */
  readonly dispatch: Promise<DispatchResult>;
  /** Overall tool deadline in ms; clamped to the 1000–10000 inclusive range. */
  readonly deadlineMs: number;
  /**
   * Snapshot whatever results have accumulated at the moment the deadline
   * fires. Invoked lazily, and only on timeout, so it never costs anything on
   * the common in-time path.
   */
  readonly snapshotPartial: () => PartialSnapshot;
  /**
   * Whether the snapshot carries at least one adapter's results. Returning
   * `true` selects the `partial` outcome; `false` selects `deadline_exceeded`.
   */
  readonly hasPartialResults: (snapshot: PartialSnapshot) => boolean;
}

/**
 * Clamp a requested deadline into the supported 1000–10000 ms range, defaulting
 * a non-finite value to {@link DEFAULT_DEADLINE_MS}. Keeps the timeout bounded
 * even if an out-of-range value reaches this module from configuration.
 */
export function clampDeadlineMs(deadlineMs: number): number {
  if (!Number.isFinite(deadlineMs)) {
    return DEFAULT_DEADLINE_MS;
  }
  return Math.min(MAX_DEADLINE_MS, Math.max(MIN_DEADLINE_MS, Math.round(deadlineMs)));
}

/** Internal sentinel distinguishing the timeout branch from a dispatch result. */
const DEADLINE_TIMEOUT = Symbol("deadline_timeout");

/**
 * Run `dispatch` under the overall tool deadline and classify the outcome.
 *
 * Races the dispatch against a timer clamped to the supported range. If the
 * dispatch wins, returns `completed` with its value. If the timer wins, snapshots
 * the accumulated results and returns `partial` when results exist or
 * `deadline_exceeded` otherwise. The timer is always cleared so a completed
 * dispatch never leaves a dangling handle.
 *
 * The dispatch promise is not cancelled — it is left to settle on its own — so
 * callers should ensure per-adapter work is independently bounded (per-backend
 * timeouts) and that `snapshotPartial` reads only results already recorded.
 */
export async function runUnderDeadline<DispatchResult, PartialSnapshot>(
  options: DeadlineOptions<DispatchResult, PartialSnapshot>,
): Promise<DeadlineOutcome<DispatchResult, PartialSnapshot>> {
  const { dispatch, snapshotPartial, hasPartialResults } = options;
  const deadlineMs = clampDeadlineMs(options.deadlineMs);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof DEADLINE_TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE_TIMEOUT), deadlineMs);
  });

  try {
    const settled = await Promise.race([dispatch, timeout]);
    if (settled !== DEADLINE_TIMEOUT) {
      return { kind: "completed", value: settled as DispatchResult };
    }
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }

  const partial = snapshotPartial();
  if (hasPartialResults(partial)) {
    return { kind: "partial", partial };
  }
  return { kind: "deadline_exceeded" };
}
