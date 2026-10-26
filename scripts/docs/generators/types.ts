/** Output contract shared by every reference generator. */

export interface GeneratedFile {
  /** Repo-relative path of a file the generator owns completely. */
  readonly path: string;
  readonly content: string;
}

export interface InjectedRegion {
  /** Name used in `<!-- docs:inject NAME -->` markers in hand-written files. */
  readonly name: string;
  readonly content: string;
}

export interface Generated {
  readonly files: readonly GeneratedFile[];
  readonly regions: readonly InjectedRegion[];
}
