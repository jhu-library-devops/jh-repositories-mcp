/** Injected regions: generated snippets kept inside hand-written Markdown. */

import { DocsScriptError } from "./lib";

const REGION_OPEN = /^<!-- docs:inject ([a-z0-9-]+) -->$/;
const REGION_CLOSE = "<!-- /docs:inject -->";
const FENCE = /^\s*(```|~~~)/;

/**
 * Replace the body of every `<!-- docs:inject NAME -->` region outside fenced
 * code blocks, so documentation can show the marker syntax in an example
 * without it being filled in.
 */
export function applyRegions(
  path: string,
  text: string,
  regions: ReadonlyMap<string, string>,
): string {
  const output: string[] = [];
  let inFence = false;
  let openRegion: string | null = null;
  for (const line of text.split("\n")) {
    if (openRegion !== null) {
      if (line === REGION_CLOSE) {
        output.push(line);
        openRegion = null;
      }
      continue;
    }
    if (FENCE.test(line)) {
      inFence = !inFence;
    }
    output.push(line);
    const match = inFence ? null : REGION_OPEN.exec(line);
    if (match?.[1] !== undefined) {
      const content = regions.get(match[1]);
      if (content === undefined) {
        throw new DocsScriptError(`${path}: unknown injected region "${match[1]}"`);
      }
      output.push(...content.trimEnd().split("\n"));
      openRegion = match[1];
    }
  }
  if (openRegion !== null) {
    throw new DocsScriptError(`${path}: region "${openRegion}" has no closing marker`);
  }
  return output.join("\n");
}
