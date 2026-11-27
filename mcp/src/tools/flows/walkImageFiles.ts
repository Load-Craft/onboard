// The image of a step of a walk, saved to the workspace.
//
// Saving: only under `loadcraft/walks/<walk>/` of the workspace, which git ignores (`.gitignore` with `*`,
// made when missing and never overwritten). Every folder that exists is resolved through its symlinks and
// must stay inside the workspace; a new one is checked again once made. The bytes go to a temporary file
// first. An image saved under the same name earlier is replaced only when the caller asked for it
// (`flows_walk_image_exists` otherwise), and it is checked before anything is read from the backend. A name is
// built from numbers and an id checked against a pattern, never from text of the application; the image is
// the user's own screenshot, saved as the backend sent it, so nothing of it reaches the model.

import { randomBytes } from 'node:crypto';
import {
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { join } from 'node:path';

import { ToolError } from '../../errors.js';
import { resolveInside } from '../../workspace/paths.js';

/** Where the images of walks go, relative to the workspace. */
export const WALKS_DIR = 'loadcraft/walks';
const FILE_MODE = 0o644;
const DIR_MODE = 0o755;

/** The kinds of image the tool saves, by the type the backend answers with. */
export const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const KNOWN = new Set(Object.values(IMAGE_EXTENSIONS));

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

/** The folder of the images of a walk, relative to the workspace. */
export const walkDirOf = (handle: string): string => `${WALKS_DIR}/${handle}`;

/** The images saved under `name` (with any of the known extensions) in the folder of the walk. */
function savedAs(root: string, handle: string, name: string): string[] {
  if (entryAt(join(root, walkDirOf(handle))) === null) return [];
  return readdirSync(join(root, walkDirOf(handle))).filter((file) => {
    const dot = file.lastIndexOf('.');
    return dot > 0 && file.slice(0, dot) === name && KNOWN.has(file.slice(dot + 1));
  });
}

/**
 * Checks, before anything is read from the backend, that an image can be saved: the workspace exists, the
 * folders that exist stay inside it, and an image saved earlier under the same name is replaced only when
 * `overwrite` says so.
 */
export function checkImageTarget(
  root: string,
  handle: string,
  name: string,
  overwrite: boolean,
): void {
  resolveInside(root, '.');
  for (const rel of ['loadcraft', WALKS_DIR, walkDirOf(handle)]) {
    if (entryAt(join(root, rel)) !== null) resolveInside(root, rel);
  }
  const taken = savedAs(root, handle, name);
  if (taken.length > 0 && !overwrite) {
    throw new ToolError('flows_walk_image_exists', {
      params: { path: `${walkDirOf(handle)}/${taken[0] ?? name}` },
    });
  }
}

/** Saves the image and returns its path, relative to the workspace. */
export function saveImage(
  root: string,
  handle: string,
  name: string,
  extension: string,
  bytes: Uint8Array,
  overwrite: boolean,
): string {
  ensureDir(root, 'loadcraft');
  ensureDir(root, WALKS_DIR);
  const ignore = join(root, WALKS_DIR, '.gitignore');
  // `wx`: an existing file (or a symlink, even a dangling one) is left as it is
  if (entryAt(ignore) === null) writeFileSync(ignore, '*\n', { flag: 'wx', mode: FILE_MODE });
  ensureDir(root, walkDirOf(handle));
  const dir = resolveInside(root, walkDirOf(handle));
  const file = `${name}.${extension}`;
  const temporary = join(dir, `.${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(temporary, bytes, { flag: 'wx', mode: FILE_MODE });
  try {
    if (overwrite) {
      // an image under the same name with another extension goes too; a symlink is removed itself
      for (const old of savedAs(root, handle, name)) unlinkSync(join(dir, old));
      renameSync(temporary, join(dir, file));
    } else {
      try {
        linkSync(temporary, join(dir, file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new ToolError('flows_walk_image_exists', {
            params: { path: `${walkDirOf(handle)}/${file}` },
          });
        }
        throw error;
      }
      unlinkSync(temporary);
    }
  } catch (error) {
    if (entryAt(temporary) !== null) unlinkSync(temporary);
    throw error;
  }
  return `${walkDirOf(handle)}/${file}`;
}
