// The rig of the read tools of module functional: the sklep world after its runs, the workspace bound
// to its project, every route set of the fake backend (the module's own routes included).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Tool } from '../../../src/registry.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import type { Fake } from '../../fake-backend/server.js';
import { seedSklep } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { createTestClock } from '../../helpers/clock.js';
import type { Elicitor } from '../../helpers/mcp.js';
import { toolRig, type RigCallResult, type ToolRig } from '../../helpers/rig.js';

export const PROJECT = SKLEP_IDS.project;

export const BOUND = JSON.stringify({
  schema: 1,
  url: 'https://app.loadcraft.io',
  project: { id: PROJECT, name: 'sklep' },
});

export interface FunctionalRigOptions {
  readonly tools: readonly Tool[];
  /** Seeds the answers of the module's routes, after the world is in place. */
  readonly seed?: (fake: Fake) => void;
  readonly locale?: 'en' | 'pl';
  readonly files?: Readonly<Record<string, string>>;
  /** The person behind the client (a tool on a consent card): answers the server's question. */
  readonly elicit?: Elicitor;
}

export function functionalRig(options: FunctionalRigOptions): Promise<ToolRig> {
  return toolRig({
    tools: options.tools,
    world: (fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'executed' });
      options.seed?.(fake);
    },
    clock: createTestClock(Date.parse('2026-11-27T12:00:00Z')),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: options.files ?? { 'loadcraft/project.json': BOUND },
    ...(options.elicit === undefined ? {} : { elicit: options.elicit }),
  });
}

/** The requests the module's tools made, as `METHOD path?query` without the project prefix. */
export function apiCalls(r: ToolRig): string[] {
  return r.fake.calls
    .filter((call) => call.path.startsWith('/api/v1/') && !call.path.endsWith('/meta'))
    .map((call) => {
      const query = new URLSearchParams(call.query).toString();
      const path = call.path.replace(`/api/v1/projects/${PROJECT}`, '');
      return `${call.method} ${path}${query === '' ? '' : `?${query}`}`;
    });
}

interface StoredLog {
  readonly tool: string;
  readonly args: string;
  readonly result: string;
}

/** The successful reads of the conversation, as `[tool, args, result]`. */
export function readsOf(r: ToolRig): [string, string, string][] {
  const file = join(r.workspace, 'loadcraft', '.cache', 'state.json');
  const state = JSON.parse(readFileSync(file, 'utf8')) as {
    process: Record<string, { reads: readonly StoredLog[] }>;
  };
  return Object.values(state.process).flatMap((p) =>
    p.reads.map((entry): [string, string, string] => [entry.tool, entry.args, entry.result]),
  );
}

export function dataOf<T>(result: RigCallResult): T {
  if (result.isError) throw new Error(`the call failed: ${result.text}`);
  return JSON.parse(result.text) as T;
}

export function errorCode(result: RigCallResult): string | undefined {
  return result.isError ? /^\[([a-z_]+)\]/u.exec(result.text)?.[1] : undefined;
}

export const CONTROL = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}-${String.fromCharCode(31)}${String.fromCharCode(127)}${String.fromCharCode(155)}]`,
  'u',
);
