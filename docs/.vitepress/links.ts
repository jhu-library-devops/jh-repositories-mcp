/**
 * Link rewriting for the documentation site. Pages use relative Markdown
 * links so they also work when browsed on GitHub. Links that leave the
 * published site (source files, root documents, unpublished directories) are
 * rewritten to their GitHub URLs at build time.
 */

import { posix } from "node:path";

export const REPOSITORY_URL = "https://github.com/jhu-library-devops/jh-repositories-mcp";
export const DEFAULT_BRANCH = "main";

/** Directories under docs/ that are working records rather than site pages. */
export const UNPUBLISHED_DIRS: readonly string[] = ["spike/"];

/**
 * Rewrite one link found on the page at `pagePath` (relative to docs/).
 * Absolute URLs, site-absolute paths, anchors, and links to published pages
 * are returned unchanged.
 */
export function rewriteRepositoryLink(href: string, pagePath: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) {
    return href;
  }
  const hashIndex = href.indexOf("#");
  const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
  const resolved = posix.normalize(posix.join(posix.dirname(pagePath), pathPart));
  const leavesSite = resolved === ".." || resolved.startsWith("../");
  const unpublished = UNPUBLISHED_DIRS.some((dir) => resolved.startsWith(dir));
  if (!leavesSite && !unpublished) {
    return href;
  }
  const repositoryPath = posix.normalize(posix.join("docs", resolved)).replace(/\/$/, "");
  const isDirectory = pathPart.endsWith("/") || posix.extname(repositoryPath) === "";
  const kind = isDirectory ? "tree" : "blob";
  const target = repositoryPath === "." ? "" : `/${repositoryPath}`;
  return `${REPOSITORY_URL}/${kind}/${DEFAULT_BRANCH}${target}${hash}`;
}
