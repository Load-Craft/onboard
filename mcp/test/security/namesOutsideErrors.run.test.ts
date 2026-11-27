// FIX-76 (group run): a name from the backend is a third party's text wherever a tool shows it,
// not only in its errors. A credential in the name of the project, an environment, a scenario, a
// composition or a flow never reaches the model in the text, nor in `format: "data"`, nor the
// state or the log of the workspace.

import { describe, expect, it } from 'vitest';

import type { Tool } from '../../src/registry.js';
import { processGetStatus } from '../../src/tools/processGetStatus.js';
import { runPlan } from '../../src/tools/runPlan.js';
import { runStart } from '../../src/tools/runStart.js';
import { setFakePreflight } from '../fake-backend/routes/data.js';
import { registerAllRoutes } from '../fake-backend/routes/index.js';
import { seedSklep, SKLEP_COLLECTIONS, SKLEP_WORLD_IDS } from '../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../golden/index.js';
import { leakedPieces, SHAPE_CANARY } from '../helpers/canary.js';
import { createTestClock, settleClock } from '../helpers/clock.js';
import { toolRig, type ToolRig } from '../helpers/rig.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJuYW1lcyJ9.c2VudGluZWwtbmFtZXMtc2ln';
const SIGNATURE = 'c2VudGluZWwtbmFtZXMtc2ln';
const SCENARIO = `zakupy ${JWT}`;
const SLOT_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzbG90In0.c2VudGluZWwtc2xvdC1zaWduYXR1cmU';
const SLOT_KEY = 'slotKey7Qm2Vx9Lr4Tz8Np3Wd';
const ENVIRONMENT = `perf api_key=${SHAPE_CANARY}`;

// every piece of a secret counts: a view that cuts or a mask that hides a part leaves one (FIX-79)
const leaks = (text: string): string[] => leakedPieces(text, [JWT, SIGNATURE, SHAPE_CANARY]);

async function rig(tools: readonly Tool[]): Promise<ToolRig> {
  return toolRig({
    tools,
    world: (fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'executed' });
      const update = (collection: string, id: string, name: string): void => {
        fake.store.collection(collection).update(id, { name });
      };
      update(SKLEP_COLLECTIONS.projects, SKLEP_IDS.project, `sklep ${JWT}`);
      update(SKLEP_COLLECTIONS.environments, SKLEP_WORLD_IDS.environments.perf, ENVIRONMENT);
      update(SKLEP_COLLECTIONS.scenarios, SKLEP_WORLD_IDS.scenarios.zakupy, SCENARIO);
      update(SKLEP_COLLECTIONS.compositions, SKLEP_WORLD_IDS.composition, `checkout ${JWT}`);
      update(SKLEP_COLLECTIONS.flows, SKLEP_IDS.flowZakupy, `zakupy flow ${JWT}`);
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

async function shownBy(
  r: ToolRig,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; data: string }> {
  const text = (await settleClock(r, r.call(name, args))).text;
  const data = (await settleClock(r, r.call(name, { ...args, format: 'data' }))).text;
  return { text, data };
}

describe('a credential in a name from the backend, outside the errors (run)', () => {
  it('run_plan of a scenario on an environment with such names', async () => {
    const r = await rig([runPlan]);
    const { text, data } = await shownBy(r, 'run_plan', {
      scenario: SCENARIO,
      environment: ENVIRONMENT,
      target_users: 10,
    });
    expect(leaks(text)).toEqual([]);
    expect(leaks(data)).toEqual([]);
    r.assertClean();
  });

  it('the dry run of process_get_status', async () => {
    const r = await rig([processGetStatus]);
    const { text, data } = await shownBy(r, 'process_get_status', {
      preflight: {
        scenario: SCENARIO,
        environment: ENVIRONMENT,
        profile: { type: 'smoke', vusers: 1 },
      },
    });
    expect(leaks(text)).toEqual([]);
    expect(leaks(data)).toEqual([]);
    r.assertClean();
  });

  it.each(['summary', 'flows', 'scenarios', 'data', 'runs'])(
    'process_get_status, detail %s',
    async (detail) => {
      const r = await rig([processGetStatus]);
      const { text, data } = await shownBy(r, 'process_get_status', { detail });
      expect(leaks(text)).toEqual([]);
      expect(leaks(data)).toEqual([]);
      r.assertClean();
    },
  );

  it('run_start of a scenario on an environment with such names: the consent card names both', async () => {
    const r = await rig([runStart]);
    // limits below the profile: the call answers with the card that names target and environment
    r.fake.store
      .collection(SKLEP_COLLECTIONS.environments)
      .update(SKLEP_WORLD_IDS.environments.perf, { workload_caps: { max_vu: 5 } });
    const result = await settleClock(
      r,
      r.call('run_start', {
        scenario: SCENARIO,
        environment: ENVIRONMENT,
        profile: { type: 'smoke', vusers: 20 },
      }),
    );
    expect(result.text).toContain('perf api_key=');
    expect(leaks(result.text)).toEqual([]);
    expect(leaks(JSON.stringify(result.outcome ?? null))).toEqual([]);
    r.assertClean();
  });

  it('the names of slots and datasets the data check gives, in the dry run and run_plan (FIX-78)', async () => {
    const r = await rig([processGetStatus, runPlan]);
    setFakePreflight(r.fake.store, 'accounts', {
      verdict: {
        status: 'short_rows',
        blocking: true,
        have_rows: 2,
        required_rows: 5,
        // canaries of their own: one already registered from another name would hide a leak
        label: `User accounts ${SLOT_JWT}`,
        dataset_name: `accounts api_key=${SLOT_KEY}`,
        message: 'Slot accounts has 2 rows but this run needs 5.',
      },
    });
    const preflight = await shownBy(r, 'process_get_status', {
      preflight: {
        scenario: SCENARIO,
        environment: ENVIRONMENT,
        profile: { type: 'smoke', vusers: 1 },
      },
    });
    const plan = await shownBy(r, 'run_plan', {
      scenario: SCENARIO,
      environment: ENVIRONMENT,
      target_users: 10,
      include_data: true,
    });
    expect(preflight.text).toContain('User accounts');
    for (const text of [preflight.text, preflight.data, plan.text, plan.data]) {
      expect(leaks(text)).toEqual([]);
      expect(leakedPieces(text, [SLOT_JWT, SLOT_KEY])).toEqual([]);
    }
    r.assertClean();
  });
});
