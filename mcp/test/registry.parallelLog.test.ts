// DOKTOR-09 pkt 1: a batch of calls of different tools in flight together in ONE server loses no
// log entry. The write of `project_update` (with the undo of its log entry) runs between reads of
// other tools; every call that succeeded leaves its entry, or says that it did not.

import { describe, expect, it } from 'vitest';

import { tools as projectTools } from '../src/tools/project/index.js';
import { registerAllRoutes } from './fake-backend/routes/index.js';
import type { Fake } from './fake-backend/server.js';
import { seedSklep } from './fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from './golden/index.js';
import { createTestClock } from './helpers/clock.js';
import { toolRig, type ToolRig } from './helpers/rig.js';
import { loggedCalls } from './helpers/undo.js';

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

async function rig(): Promise<ToolRig> {
  return toolRig({
    tools: projectTools,
    world: (fake: Fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'project' });
    },
    clock: createTestClock(Date.parse('2026-11-27T12:00:00Z')),
    env: { LOADCRAFT_LOCALE: 'en' },
    files: BOUND,
    processServices: true,
  });
}

const READS: readonly (readonly [string, Record<string, unknown>])[] = [
  ['project_get_docs', {}],
  ['project_get_endpoints', {}],
  ['project_get_envs', {}],
  ['project_get_http_settings', {}],
  ['project_list_notes', {}],
  ['project_list_team', {}],
  ['project_get_apimap', {}],
  ['project_get_docs', { format: 'json' }],
  ['project_get_envs', { format: 'json' }],
];

describe('the log of calls in flight together in one server', () => {
  it.each([
    ['text', {}],
    ['data', { format: 'data' }],
  ])(
    'keeps the entry of project_update (format %s) among 9 reads of other tools',
    async (_label, format) => {
      const r = await rig();
      const results = await Promise.all([
        ...READS.slice(0, 4).map(([name, args]) => r.call(name, args)),
        r.call('project_update', { description: 'Changed in a batch', ...format }),
        ...READS.slice(4).map(([name, args]) => r.call(name, args)),
      ]);
      const update = results[4];
      expect(update?.isError, update?.text).toBe(false);
      const entries = loggedCalls(r).filter((entry) => entry.tool === 'project_update');
      const said = update?.text.includes('not saved') ?? false;
      expect({ entries: entries.length, said }).toEqual({ entries: 1, said: false });
      expect(entries[0]?.undo).toBeDefined();
    },
  );
});
