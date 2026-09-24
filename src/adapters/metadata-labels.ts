/**
 * Metadata Label Fallback
 *
 * Adapters label the metadata fields they know by name; this turns any other
 * platform field identifier into a readable label, so a researcher never sees
 * a raw name like `dc.date.embargo` or `timePeriodCoveredStart` in the text.
 * Platform-neutral: it only splits on dots, underscores, and camelCase.
 *
 * Requirements: 5.6
 */

/**
 * `date.embargo` → `Date embargo`; `timePeriodCoveredStart` →
 * `Time period covered start`. Returns the input unchanged if nothing
 * readable remains.
 */
export function humanizeFieldName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[._\s-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
  if (words.length === 0) {
    return name;
  }
  const phrase = words.join(" ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
