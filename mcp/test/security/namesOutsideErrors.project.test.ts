// FIX-76 (group project): the names of a project, its environments, its flows and the tools of a
// telemetry server are a third party's text wherever a tool shows them: in a result, a consent card,
// the binding of the repository and the state. A credential in such a name never reaches them.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Tool } from '../../src/registry.js';
import { flowsDelete } from '../../src/tools/flowsDelete.js';
import { projectCheckEnv } from '../../src/tools/projectCheckEnv.js';
import { projectCreate } from '../../src/tools/projectCreate.js';
import { projectDelete } from '../../src/tools/projectDelete.js';
import { projectConnectTelemetry } from '../../src/tools/projectConnectTelemetry.js';
import { projectGet } from '../../src/tools/projectGet.js';
import { registerAllRoutes } from '../fake-backend/routes/index.js';
import { registerLookupRoutes } from '../fake-backend/routes/lookup.js';
import { OFFERED_TOOLS, registerTelemetryRoutes } from '../fake-backend/routes/telemetry.js';
import { seedSklep, SKLEP_COLLECTIONS, SKLEP_WORLD_IDS } from '../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../golden/index.js';
import { leakedPieces, SHAPE_CANARY } from '../helpers/canary.js';
import { createTestClock, settleClock } from '../helpers/clock.js';
import { toolRig, type ToolRig } from '../helpers/rig.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcm9qZWN0In0.c2VudGluZWwtcHJvamVjdC1zaWc';
const SIGNATURE = 'c2VudGluZWwtcHJvamVjdC1zaWc';
const PROJECT_NAME = `sklep ${JWT}`;
// every piece of a secret counts: a view that cuts or a mask that hides a part leaves one (FIX-79)
const leaks = (text: string): string[] => leakedPieces(text, [JWT, SIGNATURE, SHAPE_CANARY]);

function filesText(root: string): string {
  let out = '';
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else out += readFileSync(path, 'utf8');
    }
  };
  try {
    walk(join(root, 'loadcraft'));
  } catch {
    return out;
  }
  return out;
}

async function rig(tools: readonly Tool[], bound = true): Promise<ToolRig> {
  return toolRig({
    tools,
    world: (fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'executed' });
      const update = (collection: string, id: string, name: string): void => {
        fake.store.collection(collection).update(id, { name });
      };
      update(SKLEP_COLLECTIONS.projects, SKLEP_IDS.project, PROJECT_NAME);
      update(
        SKLEP_COLLECTIONS.environments,
        SKLEP_WORLD_IDS.environments.perf,
        `perf api_key=${SHAPE_CANARY}`,
      );
      update(SKLEP_COLLECTIONS.flows, SKLEP_IDS.flowZakupy, `zakupy ${JWT}`);
    },
    clock: createTestClock(Date.parse('2026-11-27T12:00:00Z')),
    env: { LOADCRAFT_LOCALE: 'en' },
    files: bound
      ? {
          'loadcraft/project.json': JSON.stringify({
            schema: 1,
            url: 'https://app.loadcraft.io',
            project: { id: SKLEP_IDS.project, name: 'sklep' },
          }),
        }
      : {},
  });
}

async function both(r: ToolRig, name: string, args: Record<string, unknown>): Promise<string[]> {
  const text = (await settleClock(r, r.call(name, args))).text;
  const data = (await settleClock(r, r.call(name, { ...args, format: 'data' }))).text;
  return [text, data];
}

describe('a credential in a name from the backend, outside the errors (project)', () => {
  it('project_create that finds the project by its name: result, binding and state', async () => {
    const r = await rig([projectCreate], false);
    const result = await settleClock(
      r,
      r.call('project_create', {
        name: PROJECT_NAME,
        description: 'Sklep API',
        environment: { name: 'perf', api: 'api.perf.example.com' },
      }),
      { limitMs: 120_000 },
    );
    expect(result.isError, result.text).toBe(false);
    expect(leaks(result.text)).toEqual([]);
    expect(leaks(JSON.stringify(result.outcome ?? null))).toEqual([]);
    expect(leaks(filesText(r.workspace))).toEqual([]);
  });

  it('project_get', async () => {
    const r = await rig([projectGet]);
    for (const text of await both(r, 'project_get', {})) expect(leaks(text)).toEqual([]);
    expect(leaks(filesText(r.workspace))).toEqual([]);
  });

  it('project_check_env', async () => {
    const r = await rig([projectCheckEnv]);
    for (const text of await both(r, 'project_check_env', {})) expect(leaks(text)).toEqual([]);
  });

  it('the consent cards of project_delete and flows_delete', async () => {
    const r = await rig([projectDelete, flowsDelete]);
    const project = await settleClock(
      r,
      r.call('project_delete', { kind: 'project', ids: [SKLEP_IDS.project] }),
    );
    const flow = await settleClock(
      r,
      r.call('flows_delete', { kind: 'flow', flow_ids: [SKLEP_IDS.flowZakupy] }),
    );
    for (const result of [project, flow]) {
      expect(result.text).toContain('sklep');
      expect(leaks(result.text)).toEqual([]);
      expect(leaks(JSON.stringify(result.outcome ?? null))).toEqual([]);
    }
    expect(leaks(filesText(r.workspace))).toEqual([]);
  });
});

describe('the tools of a telemetry server, a third party (FIX-78)', () => {
  it('project_connect_telemetry shows the names of its tools masked, in the text and the data', async () => {
    const JWT_TOOL =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZWxlbWV0cnkifQ.c2VudGluZWwtdGVsZW1ldHJ5LXNpZw';
    const r = await toolRig({
      tools: [projectConnectTelemetry],
      world: (fake) => {
        registerLookupRoutes(fake);
        registerTelemetryRoutes(fake, {
          tools: [...OFFERED_TOOLS, { ...OFFERED_TOOLS[0]!, name: `logs_export ${JWT_TOOL}` }],
        });
        seedSklep(fake.store, { stage: 'project' });
      },
      clock: createTestClock(Date.parse('2026-11-27T12:00:00Z')),
      env: { LOADCRAFT_LOCALE: 'en' },
      files: {
        'loadcraft/project.json': JSON.stringify({
          schema: 1,
          url: 'https://app.loadcraft.io',
          project: { id: SKLEP_IDS.project, name: 'sklep' },
        }),
      },
    });
    const args = { label: 'logs', url: 'https://logs-mcp.perf.example.com/mcp' };
    const text = (await settleClock(r, r.call('project_connect_telemetry', args))).text;
    const data = (
      await settleClock(r, r.call('project_connect_telemetry', { ...args, format: 'data' }))
    ).text;
    expect(text).toContain('logs_export');
    for (const shown of [text, data, filesText(r.workspace)]) {
      expect(leakedPieces(shown, [JWT_TOOL])).toEqual([]);
    }
  });
});
