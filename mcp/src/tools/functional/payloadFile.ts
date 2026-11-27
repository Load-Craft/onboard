// The ZIP of generated payloads, saved to the workspace (the way scenario exports are: `scenario/exportFile.ts`).
//
// Where: the path the call gave (relative to the project directory, a `.zip`, inside it through symlinks), else
// `loadcraft/payloads/payloads-<run>.zip`, whose folder git ignores (`.gitignore` with `*`, made when missing
// and never overwritten). The folders are made when missing and each is resolved through its symlinks: it must
// stay inside the workspace. The bytes go to a temporary file first and are linked to their name, which fails
// when the name is taken: an existing file (or a symlink, a dangling one included) is never overwritten, the
// ZIP takes the next free name (`x.zip`, `x-2.zip`, …). The backend serves the ZIP once, so a taken name must
// not lose it. The content is never read: nothing of it, not even a file name, reaches the model.

import { randomBytes } from 'node:crypto';
import { linkSync, lstatSync, mkdirSync, unlinkSync, writeFileSync, type Stats } from 'node:fs';
import { dirname, join, posix } from 'node:path';

import { ToolError } from '../../errors.js';
import { resolveInside } from '../../workspace/paths.js';

/** Where payloads go when the call names no file, relative to the workspace. */
export const PAYLOADS_DIR = 'loadcraft/payloads';
const FILE_MODE = 0o644;
const DIR_MODE = 0o755;
const MAX_NAMES = 1000;

function entryAt(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Makes the folder `rel` (and its parents) when missing, one at a time: each must stay inside `root`. */
function ensureDir(root: string, rel: string): string {
  let at = '';
  for (const part of rel.split('/').filter((item) => item !== '' && item !== '.')) {
    at = at === '' ? part : `${at}/${part}`;
    if (entryAt(join(root, at)) === null) mkdirSync(join(root, at), { mode: DIR_MODE });
    resolveInside(root, at);
  }
  return resolveInside(root, at === '' ? '.' : at);
}

/**
 * The path a call asks for, checked before anything is generated: relative, a `.zip`, without `..` or a hidden
 * part, and the folders that exist stay inside the workspace. Returns it normalised; undefined for none given.
 */
export function checkPayloadFile(root: string, given: string | undefined): string | undefined {
  resolveInside(root, '.');
  if (given === undefined) {
    if (entryAt(join(root, 'loadcraft')) !== null) resolveInside(root, 'loadcraft');
    return undefined;
  }
  const rel = posix.normalize(given.replaceAll('\\', '/'));
  const parts = rel.split('/');
  if (
    rel.startsWith('/') ||
    /^[a-zA-Z]:/u.test(rel) ||
    parts.some((part) => part === '..' || part === '' || part.startsWith('.')) ||
    !rel.toLowerCase().endsWith('.zip')
  ) {
    throw new ToolError('functional_payloads_file', { params: { file: given.slice(0, 120) } });
  }
  let at = '';
  for (const part of parts.slice(0, -1)) {
    at = at === '' ? part : `${at}/${part}`;
    if (entryAt(join(root, at)) === null) break;
    resolveInside(root, at);
  }
  return rel;
}

/** The n-th name of `rel`: `x.zip`, then `x-2.zip`. */
function nameOf(rel: string, n: number): string {
  return n === 1 ? rel : `${rel.slice(0, -'.zip'.length)}-${String(n)}.zip`;
}

/**
 * Saves the ZIP under the first free name and returns its path, relative to the workspace. `given` is the file
 * the call named (checked by `checkPayloadFile`); without it the ZIP goes under `loadcraft/payloads/`.
 */
export function savePayloads(
  root: string,
  given: string | undefined,
  runId: string,
  bytes: Uint8Array,
): string {
  const rel = given ?? `${PAYLOADS_DIR}/payloads-${runId.slice(0, 8).toLowerCase()}.zip`;
  ensureDir(root, dirname(rel));
  const dir = resolveInside(root, dirname(rel));
  if (given === undefined) {
    const ignore = join(dir, '.gitignore');
    // `wx`: an existing file (or a symlink, even a dangling one) is left as it is
    if (entryAt(ignore) === null) writeFileSync(ignore, '*\n', { flag: 'wx', mode: FILE_MODE });
  }
  const temporary = join(dir, `.${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(temporary, bytes, { flag: 'wx', mode: FILE_MODE });
  try {
    for (let n = 1; n <= MAX_NAMES; n += 1) {
      const name = nameOf(rel, n);
      try {
        linkSync(temporary, join(dir, posix.basename(name)));
        return name;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    throw new ToolError('functional_payloads_file', { params: { file: rel } });
  } finally {
    unlinkSync(temporary);
  }
}
