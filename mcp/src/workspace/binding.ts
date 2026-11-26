import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import * as z from 'zod';
import type { Config } from '../config.js';
import { ToolError } from '../errors.js';
import { ensureStateDir, writeFileAtomic } from './stateFile.js';
import { resolveInside } from './paths.js';

export const BINDING_SCHEMA_VERSION = 1;

const bindingSchema = z.object({
  schema: z.literal(BINDING_SCHEMA_VERSION),
  url: z.string().min(1),
  project: z.object({ id: z.string().min(1), name: z.string() }),
});

export type Binding = z.infer<typeof bindingSchema>;

export interface BindingInput {
  url: string;
  project: { id: string; name: string };
}

function sameInstance(a: string, b: string): boolean {
  const norm = (value: string): string => {
    try {
      const u = new URL(value);
      return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    } catch {
      return value.trim().replace(/\/+$/, '');
    }
  };
  return norm(a) === norm(b);
}

/**
 * Reads `loadcraft/project.json`; null when the repository is not bound yet.
 * With `currentUrl`, a binding made for another LoadCraft instance is rejected.
 */
export function readBinding(root: string, currentUrl?: string): Binding | null {
  const path = join(root, 'loadcraft', 'project.json');
  if (!existsSync(path)) return null;
  resolveInside(root, join('loadcraft', 'project.json'));

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new ToolError('binding_invalid', {
      cause,
    });
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'schema' in parsed &&
    typeof parsed.schema === 'number' &&
    parsed.schema !== BINDING_SCHEMA_VERSION
  ) {
    throw new ToolError('binding_schema_unsupported', {
      params: { schema: String(parsed.schema) },
    });
  }
  const checked = bindingSchema.safeParse(parsed);
  if (!checked.success) {
    throw new ToolError('binding_invalid');
  }
  if (currentUrl !== undefined && !sameInstance(checked.data.url, currentUrl)) {
    throw new ToolError('binding_other_instance');
  }
  return checked.data;
}

/**
 * The binding of the workspace the tool call runs in; null when the repository is not bound yet.
 * A LoadCraft instance is identified by `config.appUrl` (the address the user knows), so a binding
 * written for another instance is rejected even when only `LOADCRAFT_API_URL` differs.
 */
export function readProjectBinding(ctx: {
  readonly config: Pick<Config, 'stateRoot' | 'appUrl'>;
}): Binding | null {
  return readBinding(ctx.config.stateRoot, ctx.config.appUrl);
}

export function writeBinding(root: string, input: BindingInput): Binding {
  const checked = bindingSchema.safeParse({ schema: BINDING_SCHEMA_VERSION, ...input });
  if (!checked.success) {
    throw new ToolError('binding_invalid');
  }
  const binding = checked.data;
  const dir = ensureStateDir(root);
  // A project.json that is a link leading outside the workspace is refused, never replaced.
  if (existsSync(join(dir, 'project.json'))) resolveInside(root, join('loadcraft', 'project.json'));
  writeFileAtomic(join(dir, 'project.json'), `${JSON.stringify(binding, null, 2)}\n`);
  return binding;
}

/**
 * Removes `loadcraft/project.json` when it binds the workspace to `projectId` (on this LoadCraft
 * instance when `currentUrl` is given): the project was deleted, so the repository is no longer
 * bound. A file bound to another project, unreadable, or a link leading outside the workspace is
 * left as it is. True when the binding was removed.
 */
export function removeBinding(root: string, projectId: string, currentUrl?: string): boolean {
  let binding: Binding | null;
  try {
    binding = readBinding(root, currentUrl);
  } catch {
    return false;
  }
  if (binding?.project.id !== projectId) return false;
  // `readBinding` refused a link leading outside the workspace; the file itself goes (a link, not
  // what it points at)
  unlinkSync(join(root, 'loadcraft', 'project.json'));
  return true;
}
