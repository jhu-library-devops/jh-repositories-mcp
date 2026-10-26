/** Matching between page `sources:` entries and changed repository paths. */

/** True when a changed file falls under a `sources:` entry (file, directory, or glob). */
export function sourceMatches(source: string, changedFile: string): boolean {
  if (/[*?[{]/.test(source)) {
    return new Bun.Glob(source).match(changedFile);
  }
  if (source.endsWith("/")) {
    return changedFile.startsWith(source);
  }
  return changedFile === source || changedFile.startsWith(`${source}/`);
}

export function matchingFiles(sources: readonly string[], files: readonly string[]): string[] {
  return files.filter((file) => sources.some((source) => sourceMatches(source, file)));
}
