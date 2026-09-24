/**
 * Bounded Rank-Ordered Canonicalization
 *
 * Shared by both adapters: validates Solr candidates through a canonical API
 * in rank order with a fixed look-ahead window. At most `concurrency`
 * validations run ahead of the in-order consumer, and consumption stops the
 * moment the page is filled — so the consumed count is always an unambiguous
 * rank-order prefix, which is what the cursor arithmetic
 * (nextOffset = startOffset + candidatesConsumed) depends on.
 *
 * Individual backend faults are converted to omissions by the injected
 * resolver (fail closed — Solr-only metadata is never returned); a resolver
 * may rethrow to abort the whole page for wholesale backend failure.
 *
 * Requirements: 9.3-9.4, 11.7-11.9, 14.6
 */

import type { ItemDetail, RepositoryRecord } from "../models/index";

export interface CanonicalizeResult {
  readonly records: RepositoryRecord[];
  /** Candidates decided (passed + failed + timed-out), a rank-order prefix. */
  readonly consumed: number;
  /** Candidates dropped because canonical validation did not confirm them. */
  readonly omissions: number;
}

export async function canonicalizeInOrder<C>(options: {
  candidates: readonly C[];
  limit: number;
  startOffset: number;
  concurrency: number;
  /** Resolves one candidate to a validated item, or null to omit it. */
  resolve: (candidate: C) => Promise<ItemDetail | null>;
}): Promise<CanonicalizeResult> {
  const { candidates, limit, startOffset, concurrency, resolve } = options;
  const records: RepositoryRecord[] = [];
  let consumed = 0;
  let omissions = 0;

  const pending = new Map<number, Promise<ItemDetail | null>>();
  let nextToLaunch = 0;

  const launchUpTo = (bound: number): void => {
    while (nextToLaunch < Math.min(bound, candidates.length)) {
      const index = nextToLaunch;
      const candidate = candidates[index];
      if (candidate === undefined) {
        break;
      }
      pending.set(index, resolve(candidate));
      nextToLaunch += 1;
    }
  };

  for (let index = 0; index < candidates.length && records.length < limit; index += 1) {
    launchUpTo(index + concurrency);
    const validation = pending.get(index);
    if (validation === undefined) {
      break;
    }
    pending.delete(index);
    const item = await validation;
    consumed += 1;
    if (item === null) {
      omissions += 1;
      continue;
    }
    const { files: _files, metadata: _metadata, ...summary } = item;
    records.push({ ...summary, sourceRank: startOffset + index + 1 });
  }

  return { records, consumed, omissions };
}
