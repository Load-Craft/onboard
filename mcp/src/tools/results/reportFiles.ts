// The files of the archived Gatling report of a run, read one by one and saved to the workspace.
//
// The report is a folder of HTML, CSS, scripts and images the backend serves file by file; nothing
// lists them, so the crawl starts at `index.html` and follows the links the files name: `href` and
// `src` of a page, `url(…)` of a style sheet, and the pages of requests and groups `js/stats.js`
// names (`pathFormatted`). A link is a path inside the report or it is not followed: no scheme, no
// host, no absolute path, no escape, no `..` left after it is resolved against the folder of the
// file that names it, a few plain segments only. The files are saved byte for byte (they are the
// user's report, the one the application shows), so nothing of their content reaches the model.
//
// Saving: only under `loadcraft/reports/<run>/` of the workspace, which git ignores. Every folder
// that exists already is resolved through its symlinks and must stay inside the workspace; a new
// one is checked again once made. The files go to a temporary folder first, which replaces the old
// report only at the end (and only when the caller asked to replace it): a failure on the way
// leaves the old report as it was.

import { randomBytes } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { join, posix } from 'node:path';

import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { resolveInside } from '../../workspace/paths.js';

/** The most files and bytes one export saves; past either it stops (`truncated`). */
export const MAX_FILES = 400;
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/** How many files are read at once. */
const PARALLEL = 4;

/** Where reports go, relative to the workspace. */
export const REPORTS_DIR = 'loadcraft/reports';
const ENTRY = 'index.html';
const FILE_MODE = 0o644;
const DIR_MODE = 0o755;

/** A path inside the report: one to five plain segments. */
const REPORT_PATH = /^[A-Za-z0-9._-]{1,100}(?:\/[A-Za-z0-9._-]{1,100}){0,4}$/u;
const HTML_LINK = /(?:href|src)\s*=\s*["']([^"']+)["']/gu;
const CSS_LINK = /url\(\s*["']?([^"')]+)["']?\s*\)/gu;
const STATS_PAGE = /pathFormatted\s*["']?\s*:\s*["']((?:req|group)_[A-Za-z0-9_-]{1,120})["']/gu;
const STATS_FILE = 'js/stats.js';

/** One file of the report: its bytes, or a 404 of the archive. */
export type ReportFile =
  { readonly kind: 'file'; readonly bytes: Uint8Array } | { readonly kind: 'missing' };

/** Reads one file of the report by its path inside it (`style/style.css`). */
export type ReadReportFile = (path: string) => Promise<ReportFile>;

export interface CrawlResult {
  /** The paths saved, sorted. */
  readonly saved: readonly string[];
  readonly bytes: number;
  /**
   * How many files the report names that the archive lacks. Only the number: the names of the pages
   * of requests come from the addresses the run asked for, which may carry a token.
   */
  readonly missing: number;
  /** The links not followed: outside the report or not a file name, once per value. */
  readonly skippedLinks: number;
  readonly truncated: boolean;
}

/** A link value as the crawler follows it: without query and anchor; null for an anchor alone. */
function linkValue(raw: string): string | null {
  const cut = raw.split(/[?#]/u, 1)[0]?.trim() ?? '';
  return cut === '' ? null : cut;
}

/**
 * The path inside the report a link names, resolved against the folder of the file that names it;
 * null when it leaves the report or is not a plain file name.
 */
export function reportPathOf(from: string, value: string): string | null {
  if (/[:\\%]/u.test(value) || value.startsWith('/')) return null;
  const resolved = posix.normalize(posix.join(posix.dirname(from), value));
  if (!REPORT_PATH.test(resolved)) return null;
  return resolved.split('/').some((segment) => segment === '.' || segment === '..')
    ? null
    : resolved;
}

function matches(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

/** The link values a file names, by its kind; a file of another kind names none. */
export function linksOf(
  path: string,
  text: string,
): { readonly values: string[]; readonly pages: string[] } {
  if (path.endsWith('.html')) return { values: matches(HTML_LINK, text), pages: [] };
  if (path.endsWith('.css')) return { values: matches(CSS_LINK, text), pages: [] };
  if (path === STATS_FILE)
    return { values: [], pages: matches(STATS_PAGE, text).map((name) => `${name}.html`) };
  return { values: [], pages: [] };
}

function isTooLarge(error: unknown): boolean {
  return error instanceof LoadcraftApiError && error.code === 'response_too_large';
}

/** The stats of a path without following a symlink; null when nothing is there. */
function entryAt(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Makes the folder `rel` of the workspace when it is missing; either way it must stay inside. */
function ensureDir(root: string, rel: string): void {
  if (entryAt(join(root, rel)) === null) mkdirSync(join(root, rel), { mode: DIR_MODE });
  resolveInside(root, rel);
}

/** The report folder of a run, relative to the workspace. */
export function reportDirOf(run: string): string {
  return `${REPORTS_DIR}/${run}`;
}

/**
 * Checks, before anything is read from the backend, that a report of `run` can be saved: the
 * workspace exists, the folders that exist stay inside it, and an earlier report is replaced only
 * when `overwrite` says so (`report_exists` otherwise).
 */
export function checkTarget(root: string, run: string, overwrite: boolean): void {
  resolveInside(root, '.');
  if (entryAt(join(root, 'loadcraft')) !== null) resolveInside(root, 'loadcraft');
  if (entryAt(join(root, REPORTS_DIR)) !== null) resolveInside(root, REPORTS_DIR);
  const target = reportDirOf(run);
  if (entryAt(join(root, target)) === null) return;
  if (!overwrite) throw new ToolError('report_exists', { params: { run, path: `${target}/` } });
  resolveInside(root, target);
}

/** A folder of the workspace being filled with the files of one report. */
interface Staging {
  readonly dir: string;
  write(path: string, bytes: Uint8Array): boolean;
}

function stage(root: string, run: string): Staging {
  ensureDir(root, 'loadcraft');
  ensureDir(root, REPORTS_DIR);
  const ignore = join(root, REPORTS_DIR, '.gitignore');
  // `wx`: an existing file (or a symlink, even a dangling one) is left as it is
  if (entryAt(ignore) === null) writeFileSync(ignore, '*\n', { flag: 'wx', mode: FILE_MODE });
  const rel = `${REPORTS_DIR}/.${run}.${randomBytes(4).toString('hex')}.tmp`;
  mkdirSync(join(root, rel), { mode: DIR_MODE });
  const dir = resolveInside(root, rel);
  return {
    dir,
    // false: the path is taken by a folder or a file of another path (`a` and `a/b`)
    write(path, bytes) {
      try {
        const parts = path.split('/');
        if (parts.length > 1)
          mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true, mode: DIR_MODE });
        writeFileSync(join(dir, ...parts), bytes, { flag: 'wx', mode: FILE_MODE });
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST' || code === 'ENOTDIR' || code === 'EISDIR') return false;
        throw error;
      }
    },
  };
}

/** Puts the staged report in place of `<run>/`, the old one (when there is one) removed after. */
function commit(root: string, run: string, staging: Staging): void {
  const target = join(root, reportDirOf(run));
  const old = entryAt(target);
  if (old === null) {
    renameSync(staging.dir, target);
    return;
  }
  // inside the workspace (checked again now): a symlink is removed itself, never what it points at
  resolveInside(root, reportDirOf(run));
  if (old.isSymbolicLink()) {
    unlinkSync(target);
    renameSync(staging.dir, target);
    return;
  }
  const aside = `${staging.dir}.old`;
  renameSync(target, aside);
  try {
    renameSync(staging.dir, target);
  } catch (error) {
    renameSync(aside, target);
    throw error;
  }
  rmSync(aside, { recursive: true, force: true });
}

/**
 * Reads the report of `run` through `read` and saves it under `loadcraft/reports/<run>/` of the
 * workspace `root`. A 404 of `index.html` is `report_not_archived`; a 404 of another file is counted
 * as missing; any other failure stops the export and leaves the workspace as it was.
 */
export async function exportReport(
  root: string,
  run: string,
  overwrite: boolean,
  read: ReadReportFile,
): Promise<CrawlResult> {
  checkTarget(root, run, overwrite);
  // a failure of the first file (too large included) leaves nothing behind: no folder is made yet
  const first = await read(ENTRY);
  if (first.kind === 'missing') throw new ToolError('report_not_archived', { params: { run } });

  const staging = stage(root, run);
  try {
    const result = await crawl(first.bytes, read, staging);
    commit(root, run, staging);
    return result;
  } catch (error) {
    rmSync(staging.dir, { recursive: true, force: true });
    throw error;
  }
}

async function crawl(
  entry: Uint8Array,
  read: ReadReportFile,
  staging: Staging,
): Promise<CrawlResult> {
  const decoder = new TextDecoder();
  const seen = new Set<string>([ENTRY]);
  const skipped = new Set<string>();
  const queue: string[] = [];
  const saved: string[] = [];
  let missing = 0;
  let bytes = 0;
  let truncated = false;

  const follow = (from: string, data: Uint8Array): void => {
    const { values, pages } = linksOf(from, decoder.decode(data));
    for (const raw of values) {
      const value = linkValue(raw);
      if (value === null) continue;
      const path = reportPathOf(from, value);
      if (path === null) {
        skipped.add(value);
        continue;
      }
      if (!seen.has(path)) {
        seen.add(path);
        queue.push(path);
      }
    }
    for (const page of pages) {
      if (!REPORT_PATH.test(page)) skipped.add(page);
      else if (!seen.has(page)) {
        seen.add(page);
        queue.push(page);
      }
    }
  };

  const keep = (path: string, data: Uint8Array): void => {
    if (saved.length >= MAX_FILES || bytes + data.byteLength > MAX_TOTAL_BYTES) {
      truncated = true;
      return;
    }
    if (!staging.write(path, data)) {
      skipped.add(path);
      return;
    }
    saved.push(path);
    bytes += data.byteLength;
    follow(path, data);
  };

  keep(ENTRY, entry);
  const running = new Set<Promise<void>>();
  // once a read failed, what the others bring is dropped: the staging folder is about to go
  let failed = false;
  const fetchOne = async (path: string): Promise<void> => {
    let file: ReportFile;
    try {
      file = await read(path);
    } catch (error) {
      if (!isTooLarge(error)) {
        failed = true;
        throw error;
      }
      truncated = true;
      return;
    }
    if (truncated || failed) return;
    if (file.kind === 'missing') missing += 1;
    else keep(path, file.bytes);
  };

  try {
    for (;;) {
      while (!truncated && queue.length > 0 && running.size < PARALLEL) {
        if (saved.length + running.size >= MAX_FILES) break;
        const path = queue.shift();
        if (path === undefined) break;
        const task = fetchOne(path).finally(() => running.delete(task));
        running.add(task);
      }
      if (running.size === 0) break;
      await Promise.race(running);
    }
  } catch (error) {
    // every read settles before the caller removes the staging folder
    await Promise.allSettled([...running]);
    throw error;
  }
  if (queue.length > 0) truncated = true;

  return {
    saved: [...saved].sort(),
    bytes,
    missing,
    skippedLinks: skipped.size,
    truncated,
  };
}
