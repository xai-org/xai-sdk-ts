export declare const KEEP_PATHS: ReadonlySet<string>;
export declare const IGNORED_PATHS: ReadonlySet<string>;
export declare function pathProblems(
  paths: Iterable<string>,
  keep?: ReadonlySet<string>,
  ignored?: ReadonlySet<string>,
): Array<string>;
