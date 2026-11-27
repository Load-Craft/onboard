// The one answer to "which process of the state file does this workspace write to": the project the
// directory is bound to (`loadcraft/project.json`), or `_new` while there is none. The log of calls and
// the cache of operations both ask here, so they never split between two keys.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readBinding } from './binding.js';
import { NEW_KEY } from './processState.js';
import type { ProcessStore } from './reducer.js';
import { bindProject } from './rebind.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The process the workspace writes to: the bound project, or `_new` before there is one. A binding that
 * is unreadable, or made for another LoadCraft instance (`appUrl` given), counts as no binding.
 */
export function processKey(root: string, appUrl?: string): string {
  try {
    const id = readBinding(root, appUrl)?.project.id;
    return id !== undefined && UUID.test(id) ? id : NEW_KEY;
  } catch {
    return NEW_KEY;
  }
}

/**
 * Brings the state file in line with the binding: what waited under `_new` moves under the project `key`
 * (the answer of `processKey`, computed once by the caller) in one write. Nothing is written, and the
 * file is not even parsed, when the workspace is not bound or the file does not mention `_new`.
 */
export async function adoptBinding(store: ProcessStore, root: string, key: string): Promise<void> {
  if (key === NEW_KEY) return;
  const path = join(root, 'loadcraft', '.cache', 'state.json');
  if (!existsSync(path) || !readFileSync(path, 'utf8').includes(`"${NEW_KEY}"`)) return;
  await bindProject(store, key);
}
