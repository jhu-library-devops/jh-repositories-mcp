# Domain vocabulary

The project's terms (Candidate, SearchResult, ItemDetail, Public Record,
Canonical API, Field Allowlist, Immutable Public Filter, Cursor, Repository
Rank, and the rest) are defined in the published
[glossary](docs/glossary.md). Use them exactly, in code, specifications,
documentation, and conversation, and avoid the alternatives each entry lists.

This file keeps the material that helps reviewers and agents apply the
vocabulary but does not belong on the public site.

## Example dialogue

> **Dev:** "When a search returns results, are those validated through the Canonical API?"
> **Domain expert:** "That is the required contract: every Candidate, including one from a search cache, must pass the public-access gate before return. The current search cache instead reuses pages validated when first cached, which is known implementation drift from Requirement 15.4. A cached ItemDetail is re-probed against the Canonical API before it is served and evicted as not found if it is no longer public."

> **Dev:** "What's the difference between a SearchResult and an ItemDetail?"
> **Domain expert:** "Same canonical data, different projection depth. SearchResult omits the file list. ItemDetail includes it. Both come from the same Canonical API call; ItemDetail keeps more of the response."

> **Dev:** "If the cursor's query hash doesn't match, do we error?"
> **Domain expert:** "No. We reset to page 1 and include a `cursor_reset` warning. The model learns pagination restarted without entering a retry loop."

## Resolved ambiguities

- "record" was used to mean both the Solr Candidate and the validated SearchResult. Candidate is pre-validation; SearchResult is post-validation.
- "canonical record" was used both for the full item view and for the act of resolving it. The full view is **ItemDetail**; the act is "canonicalization".
