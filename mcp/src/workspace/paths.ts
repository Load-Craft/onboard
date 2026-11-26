import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { ToolError } from '../errors.js';
import { fileNotFound } from './fileRead.js';

function isInside(realRoot: string, candidate: string): boolean {
  const rel = relative(realRoot, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Path shown to the model: relative to the workspace, never absolute. */
function displayPath(realRoot: string, absolute: string): string {
  const rel = relative(realRoot, absolute);
  return rel === '' ? '.' : rel.split(sep).join('/');
}

function outsideWorkspace(): ToolError {
  return new ToolError('path_outside_workspace');
}

/**
 * Resolves `input` (relative to `root` or absolute) through symlinks and returns the real path.
 * The real path must lie inside the real workspace root.
 */
export function resolveInside(root: string, input: string): string {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    throw new ToolError('workspace_not_found');
  }

  if (input.includes('\0')) {
    throw new ToolError('file_not_found', {
      params: { file: input.replaceAll('\0', '') },
    });
  }
  const lexical = resolve(realRoot, input);
  let real: string;
  try {
    real = realpathSync(lexical);
  } catch (error) {
    // A missing path outside the workspace must not reveal whether it exists.
    if (!isInside(realRoot, lexical)) throw outsideWorkspace();
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw fileNotFound(displayPath(realRoot, lexical));
    }
    throw fileNotFound(displayPath(realRoot, lexical), error);
  }

  if (!isInside(realRoot, real)) throw outsideWorkspace();
  return real;
}

/** Relative display form of an already resolved path inside `root`. */
export function relativeToWorkspace(root: string, absolute: string): string {
  return displayPath(realpathSync(root), absolute);
}
