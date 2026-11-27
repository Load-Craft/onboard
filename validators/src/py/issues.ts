// `Issue` records and the `sorted(set(issues))` every validator ends with.

import { PyPath } from './path.ts';
import { compareStr } from './str.ts';

export type PathIssue = { path: PyPath; message: string };
export type PointerIssue = { pointer: string; message: string };

/** `sorted(set(issues))` for issues keyed by a path (ordered like `pathlib` orders paths). */
export function sortedUnique(issues: PathIssue[]): PathIssue[] {
  const seen = new Map<string, PathIssue>();
  for (const issue of issues) seen.set(`${issue.path.text}\u0000${issue.message}`, issue);
  return [...seen.values()].sort(
    (a, b) => PyPath.compare(a.path, b.path) || compareStr(a.message, b.message),
  );
}

/** `sorted(set(issues))` for issues keyed by a JSON pointer string. */
export function sortedUniquePointers<T extends PointerIssue>(issues: T[]): T[] {
  const seen = new Map<string, T>();
  for (const issue of issues) seen.set(`${issue.pointer}\u0000${issue.message}`, issue);
  return [...seen.values()].sort(
    (a, b) => compareStr(a.pointer, b.pointer) || compareStr(a.message, b.message),
  );
}
