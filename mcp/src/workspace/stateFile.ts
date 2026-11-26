// The two file operations every writer of loadcraft/.cache/state.json shares: the directory (never reached
// through a symlink leaving the workspace) and the atomic replace of a file.
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveInside } from './paths.js';

/** Creates `<root>/loadcraft` (never through a symlink leaving the workspace) and returns its path. */
export function ensureStateDir(root: string, ...sub: string[]): string {
  const base = join(root, 'loadcraft');
  if (existsSync(base)) resolveInside(root, 'loadcraft');
  const dir = join(base, ...sub);
  mkdirSync(dir, { recursive: true });
  resolveInside(root, join('loadcraft', ...sub));
  return dir;
}

/** Writes through a temporary file in the same directory, then renames it over the target. */
export function writeFileAtomic(path: string, content: string): void {
  const temp = join(dirname(path), `.${randomBytes(8).toString('hex')}.tmp`);
  try {
    const fd = openSync(temp, 'wx', 0o600);
    try {
      writeSync(fd, content);
      // on disk before the rename: after a crash the file is the old or the new content, never empty
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
