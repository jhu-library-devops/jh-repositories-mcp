# ADR-012: Cursor Hash Mismatch Resets Pagination Instead of Returning an Error

When a client passes a cursor whose query hash does not match the current normalized request (different query, filters, sort, or limit), the server resets pagination to offset (0, 0), returns first-page results for the new query, and includes a `cursor_reset` warning. It does not reject the request as invalid input.

This serves AI host models that iterate through research workflows: a model refines its search between calls and may naively pass a cursor from the previous query. A hard error would cause retry loops. A graceful reset lets the model observe the warning and continue without special cursor-management logic.

## Considered Options

1. Reject mismatched cursors as `invalid_input` (strict, prevents nonsensical offset reuse, but causes model retry loops)
2. Reset offsets and return a `cursor_reset` warning (graceful, self-correcting, but could mask accidental query drift)
3. Make the cursor advisory — ignore hash entirely, always use the offsets (most permissive, but allows genuinely invalid pagination across unrelated queries)

Option 2 was chosen because it preserves the safety property (stale cursors don't produce nonsensical results) while being compatible with AI models that lack sophisticated session management. The warning makes the reset observable, and the `explore_research_topic` prompt advises models to drop cursors when refining queries as a best practice.

Malformed cursors and unsupported versions still produce `invalid_input` errors — only hash mismatches get the graceful reset.
