/**
 * Bounded Retry for Idempotent Backend Calls
 *
 * At most two total attempts (one retry) for idempotent transient failures,
 * with exponential backoff and full jitter. Non-transient failures (4xx,
 * validation, gate rejections) are never retried. The sleep function is
 * injectable for deterministic tests.
 *
 * Requirements: 15.2
 */

/** Maximum total attempts per backend call (spec: "no more than two"). */
export const MAX_ATTEMPTS = 2;

const BASE_DELAY_MS = 200;

export interface RetryOptions {
  /** Returns true when the failure is transient and worth one retry. */
  isTransient: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Full-jitter exponential backoff: uniform in (0, BASE * 2^attempt]. */
export function backoffDelayMs(attempt: number, random: () => number): number {
  const ceiling = BASE_DELAY_MS * 2 ** attempt;
  return Math.max(1, Math.floor(random() * ceiling));
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
      if (isLastAttempt || !options.isTransient(error)) {
        throw error;
      }
      await sleep(backoffDelayMs(attempt, random));
    }
  }
  throw lastError;
}
