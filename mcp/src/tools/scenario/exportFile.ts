// The ZIP of an exported scenario, saved to the workspace.
//
// Saving: only under `loadcraft/exports/` of the workspace, which git ignores (`.gitignore` with `*`,
// made when missing and never overwritten). Every folder that exists is resolved through its symlinks
// and must stay inside the workspace; a new one is checked again once made. The bytes go to a
// temporary file first and are linked to their name, which fails when the name is taken: an earlier
// export (or anything else, a symlink included) is never overwritten, the new one takes the next free
// name. The ZIP is the user's project, saved as the backend sent it (its secrets masked there); its
// content is never read here, so nothing of it, not even a file name, reaches the model.

import { randomBytes } from 'node:crypto';
import { linkSync, lstatSync, mkdirSync, unlinkSync, writeFileSync, type Stats } from 'node:fs';
import { join } from 'node:path';

import { resolveInside } from '../../workspace/paths.js';

/** Where exports go, relative to the workspace. */
export const EXPORTS_DIR = 'loadcraft/exports';
const FILE_MODE = 0o644;
const DIR_MODE = 0o755;
/** How many names one export tries before it gives up (the count of exports of one scenario). */
const MAX_NAMES = 1000;

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

/**
 * Checks, before anything is read from the backend, that an export can be saved: the workspace
 * exists and the folders that exist stay inside it.
 */
export function checkExportTarget(root: string): void {
  resolveInside(root, '.');
  if (entryAt(join(root, 'loadcraft')) !== null) resolveInside(root, 'loadcraft');
  if (entryAt(join(root, EXPORTS_DIR)) !== null) resolveInside(root, EXPORTS_DIR);
}

/** The name of the n-th export of a scenario: `scenario-1a2b3c4d.zip`, then `…-2.zip`. */
function nameOf(scenarioId: string, n: number): string {
  const base = `scenario-${scenarioId.slice(0, 8).toLowerCase()}`;
  return n === 1 ? `${base}.zip` : `${base}-${String(n)}.zip`;
}

/** Saves the ZIP under the first free name and returns its path, relative to the workspace. */
export function saveExport(root: string, scenarioId: string, bytes: Uint8Array): string {
  ensureDir(root, 'loadcraft');
  ensureDir(root, EXPORTS_DIR);
  const ignore = join(root, EXPORTS_DIR, '.gitignore');
  // `wx`: an existing file (or a symlink, even a dangling one) is left as it is
  if (entryAt(ignore) === null) writeFileSync(ignore, '*\n', { flag: 'wx', mode: FILE_MODE });
  const dir = resolveInside(root, EXPORTS_DIR);
  const temporary = join(dir, `.${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(temporary, bytes, { flag: 'wx', mode: FILE_MODE });
  try {
    for (let n = 1; n <= MAX_NAMES; n += 1) {
      const name = nameOf(scenarioId, n);
      try {
        linkSync(temporary, join(dir, name));
        return `${EXPORTS_DIR}/${name}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    throw new Error('no free name for the export');
  } finally {
    unlinkSync(temporary);
  }
}

/**
 * Writes the text of a run recipe beside the ZIP it belongs to: the ZIP's name with `.run.md` in place of
 * `.zip`. Never replaces a file (`wx`, a symlink included): when the name is taken nothing is written and
 * null is returned. The path is relative to the workspace.
 */
export function saveRecipe(root: string, zipPath: string, text: string): string | null {
  if (!zipPath.startsWith(`${EXPORTS_DIR}/`) || !zipPath.endsWith('.zip')) return null;
  const rel = `${zipPath.slice(0, -'.zip'.length)}.run.md`;
  const target = join(resolveInside(root, EXPORTS_DIR), rel.slice(EXPORTS_DIR.length + 1));
  if (entryAt(target) !== null) return null;
  try {
    writeFileSync(target, text, { flag: 'wx', mode: FILE_MODE });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw error;
  }
  return rel;
}
