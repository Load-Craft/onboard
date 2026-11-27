// The rig of the write tools of module data: the sklep world after its runs, every route set of the
// fake backend (the module's own routes included), the workspace bound to the project, and the state
// file of the workspace as the plugin writes it.

import { newProcess } from '../../../src/workspace/migrate.js';
import type { Tool } from '../../../src/registry.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import type { Fake } from '../../fake-backend/server.js';
import { seedSklep } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { createTestClock } from '../../helpers/clock.js';
import type { Elicitor } from '../../helpers/mcp.js';
import { toolRig, type ToolRig } from '../../helpers/rig.js';

export const PROJECT = SKLEP_IDS.project;

export const BOUND = JSON.stringify({
  schema: 1,
  url: 'https://app.loadcraft.io',
  project: { id: PROJECT, name: 'sklep' },
});

/** The state file with the ids the process of the project holds (merged into an empty process). */
export function stateWith(ids: Readonly<Record<string, unknown>>): string {
  const empty = newProcess(PROJECT, '2026-11-27T12:00:00.000Z');
  return JSON.stringify({
    schema: 3,
    process: { [PROJECT]: { ...empty, ids: { ...empty.ids, ...ids } } },
  });
}

export interface DataRigOptions {
  readonly tools: readonly Tool[];
  readonly seed?: (fake: Fake) => void;
  readonly locale?: 'en' | 'pl';
  readonly files?: Readonly<Record<string, string>>;
  /** The person behind the client (a tool on a consent card): answers the server's question. */
  readonly elicit?: Elicitor;
}

export function dataRig(options: DataRigOptions): Promise<ToolRig> {
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

/** The requests the tools made to the backend's API, as `METHOD path` without the project prefix. */
export function apiCalls(r: ToolRig): string[] {
  return r.fake.calls
    .filter((call) => call.path.startsWith('/api/v1/') && !call.path.endsWith('/meta'))
    .map((call) => `${call.method} ${call.path.replace(`/api/v1/projects/${PROJECT}`, '')}`);
}

export { errorCode } from '../functional/rig.js';
