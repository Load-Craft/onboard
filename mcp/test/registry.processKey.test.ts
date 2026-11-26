// One key of the process for the log of calls and for the cache of operations: after `project_create` the
// state file holds a single process (the project), `_new` is gone, and the log and the operations written
// before the project existed are under the project. A clone that arrives bound, with a state file that
// still holds `_new`, is moved by its first call.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as z from 'zod';
import { describe, expect, it } from 'vitest';

import { defineTool } from '../src/registry.js';

import { createLogger } from '../src/log.js';
import { projectCreate } from '../src/tools/projectCreate.js';
import { NEW_KEY } from '../src/workspace/processState.js';
import { createProcessStore } from '../src/workspace/reducer.js';
import { CallSecretScope } from '../src/workspace/secrets.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
} from './fake-backend/routes/documentation.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import { registerSetupRoutes } from './fake-backend/routes/setup.js';
import { registerOpenapiReadRoute } from './fake-backend/routes/suggestions.js';
import type { Fake } from './fake-backend/server.js';
import { seedSklep } from './fake-backend/worlds/sklep.js';
import { settleClock } from './helpers/clock.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

/** A logged call that touches nothing else: the first call of a clone. */
const STATUS = defineTool({
  name: 'process_get_status',
  title: 'Status',
  description: 'read',
  input: z.strictObject({}),
  annotations: { readOnlyHint: true },
  run: () => Promise.resolve({ status: 'done' as const, data: { ok: true } }),
  render: () => 'ok',
});

const ARGS = { name: 'sklep', environment: { name: 'perf', api: 'api.perf.example.com' } };

interface StateFile {
  bound_project_id?: string;
  process: Record<
    string,
    {
      log: { tool: string }[];
      reads: { tool: string }[];
      steps: { project: { checks: Record<string, unknown> } };
    }
  >;
}

const world = (fake: Fake): void => {
  registerLookupRoutes(fake);
  registerProjectRoutes(fake);
  registerSetupRoutes(fake);
  registerOpenapiReadRoute(fake);
  registerApiMapRoute(fake);
  registerConformanceRoute(fake);
  seedSklep(fake.store, { stage: 'empty' });
};

const statePath = (r: ToolRig): string => join(r.workspace, 'loadcraft', '.cache', 'state.json');
const read = (r: ToolRig): StateFile => JSON.parse(readFileSync(statePath(r), 'utf8')) as StateFile;

const PROJECT = '11111111-2222-4333-8444-555555555555';

/** What a call made before the project existed leaves under `_new`: a check, written by the real store. */
async function leaveUnderNew(r: ToolRig): Promise<void> {
  const secrets = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
  const store = createProcessStore(r.workspace, { secrets, clock: { now: () => r.clock.now() } });
  await store.applyUpdate(
    NEW_KEY,
    { checks: { project: { created: { ok: true } } } },
    { tool: 'flows_suggest_journeys' },
  );
}

const created = (state: StateFile, key: string): unknown =>
  state.process[key]?.steps.project.checks['created'];

describe('one process key', () => {
  it('after project_create the file has one process, the project; _new is gone and the log is under the project', async () => {
    const r = await toolRig({ tools: [projectCreate], world });
    // a call before the project existed left an entry under `_new`
    await leaveUnderNew(r);

    const call = r.call('project_create', ARGS);
    const result = await settleClock(r, call, { limitMs: 120_000 });
    expect(result.isError).toBe(false);

    const binding = JSON.parse(
      readFileSync(join(r.workspace, 'loadcraft', 'project.json'), 'utf8'),
    ) as { project: { id: string } };
    const id = binding.project.id;
    const state = read(r);
    expect(Object.keys(state.process)).toEqual([id]);
    expect(state.bound_project_id).toBe(id);
    expect(created(state, id)).toBeDefined();
    expect(state.process[id]?.log.map((e) => e.tool)).toContain('project_create');
  });

  it('a clone with project.json and a state file holding _new has its state moved by the first call', async () => {
    const r = await toolRig({ tools: [STATUS], world });
    await leaveUnderNew(r);
    mkdirSync(join(r.workspace, 'loadcraft'), { recursive: true });
    writeFileSync(
      join(r.workspace, 'loadcraft', 'project.json'),
      JSON.stringify({
        schema: 1,
        url: r.config.appUrl,
        project: { id: PROJECT, name: 'sklep' },
      }),
    );

    // the first call of the clone
    await settleClock(r, r.call('process_get_status', {}), { limitMs: 120_000 });

    const state = read(r);
    expect(Object.keys(state.process)).not.toContain(NEW_KEY);
    expect(state.bound_project_id).toBe(PROJECT);
    expect(created(state, PROJECT)).toBeDefined();
    // a plain read goes to the ring of reads, under the project too
    expect(state.process[PROJECT]?.reads.map((e) => e.tool)).toContain('process_get_status');
  });

  it('a directory bound to another instance keeps its state under _new and is not adopted', async () => {
    const r = await toolRig({ tools: [STATUS], world });
    await leaveUnderNew(r);
    mkdirSync(join(r.workspace, 'loadcraft'), { recursive: true });
    writeFileSync(
      join(r.workspace, 'loadcraft', 'project.json'),
      JSON.stringify({
        schema: 1,
        url: 'https://other-instance.example.com',
        project: { id: PROJECT, name: 'sklep' },
      }),
    );

    await settleClock(r, r.call('process_get_status', {}), { limitMs: 120_000 });

    const state = read(r);
    expect(Object.keys(state.process)).toEqual([NEW_KEY]);
    expect(state.bound_project_id).toBeUndefined();
    expect(created(state, NEW_KEY)).toBeDefined();
  });

  it('binding a workspace that has nothing under _new still sets bound_project_id, with the entry', async () => {
    const r = await toolRig({ tools: [STATUS], world });
    mkdirSync(join(r.workspace, 'loadcraft'), { recursive: true });
    writeFileSync(
      join(r.workspace, 'loadcraft', 'project.json'),
      JSON.stringify({ schema: 1, url: r.config.appUrl, project: { id: PROJECT, name: 'sklep' } }),
    );

    await settleClock(r, r.call('process_get_status', {}), { limitMs: 120_000 });

    const state = read(r);
    expect(Object.keys(state.process)).toEqual([PROJECT]);
    expect(state.bound_project_id).toBe(PROJECT);
  });
});
