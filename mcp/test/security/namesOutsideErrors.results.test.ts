// FIX-76 (group results and data): the names of the requests of a run, the messages of its errors,
// the names of slots, datasets and scenarios are a third party's text wherever a tool shows them.
// A credential in such a name never reaches the text, `format: "data"` or the workspace's files.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Tool } from '../../src/registry.js';
import { dataCheckReadiness } from '../../src/tools/dataCheckReadiness.js';
import { resultsGetReport } from '../../src/tools/resultsGetReport.js';
import { registerAllRoutes } from '../fake-backend/routes/index.js';
import type { Fake } from '../fake-backend/server.js';
import { seedSklep, SKLEP_COLLECTIONS, SKLEP_WORLD_IDS } from '../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../golden/index.js';
import { leakedPieces, SHAPE_CANARY } from '../helpers/canary.js';
import { createTestClock, settleClock } from '../helpers/clock.js';
import { toolRig, type ToolRig } from '../helpers/rig.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZXN1bHRzIn0.c2VudGluZWwtcmVzdWx0cy1zaWc';
const SIGNATURE = 'c2VudGluZWwtcmVzdWx0cy1zaWc';
// every piece of a secret counts: a view that cuts or a mask that hides a part leaves one (FIX-79)
const leaks = (text: string): string[] => leakedPieces(text, [JWT, SIGNATURE, SHAPE_CANARY]);

type Loose = { id: string } & Record<string, unknown>;

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

async function rig(tools: readonly Tool[], seed: (fake: Fake) => void): Promise<ToolRig> {
  return toolRig({
    tools,
    world: (fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'executed' });
      seed(fake);
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
}

async function both(r: ToolRig, name: string, args: Record<string, unknown>): Promise<string[]> {
  const result = await settleClock(r, r.call(name, args));
  expect(result.isError, result.text).toBe(false);
  const data = (await settleClock(r, r.call(name, { ...args, format: 'data' }))).text;
  return [result.text, data];
}

describe('a credential in a name from the backend, outside the errors (results, data)', () => {
  it('results_get_report: the names of the requests and the messages of the errors', async () => {
    const r = await rig([resultsGetReport], (fake) => {
      const results = fake.store.collection<Loose>(SKLEP_COLLECTIONS.results);
      const result = results.require(SKLEP_IDS.executionPerf);
      const rows = (result['endpoints'] as Loose[] | undefined) ?? [];
      expect(rows.length).toBeGreaterThan(0);
      results.update(SKLEP_IDS.executionPerf, {
        endpoints: rows.map((row) => ({ ...row, name: `login ${JWT}` })),
        error_summary: [{ message: `denied for api_key=${SHAPE_CANARY}`, count: 3 }],
      });
    });
    for (const text of await both(r, 'results_get_report', { execution: 'e-3f9a12c4' })) {
      expect(leaks(text)).toEqual([]);
    }
    expect(leaks(filesText(r.workspace))).toEqual([]);
  });

  it('data_check_readiness: the names of the scenario and its slots', async () => {
    const r = await rig([dataCheckReadiness], (fake) => {
      fake.store
        .collection(SKLEP_COLLECTIONS.scenarios)
        .update(SKLEP_WORLD_IDS.scenarios.zakupy, { name: `zakupy ${JWT}` });
      fake.store
        .collection(SKLEP_COLLECTIONS.compositions)
        .update(SKLEP_WORLD_IDS.composition, { name: `checkout ${JWT}` });
    });
    // a composition: the plan names the scenarios that read each slot
    for (const text of await both(r, 'data_check_readiness', { scenario: `checkout ${JWT}` })) {
      expect(leaks(text)).toEqual([]);
    }
    expect(leaks(filesText(r.workspace))).toEqual([]);
  });
});
