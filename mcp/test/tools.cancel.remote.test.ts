// `process_cancel` of a test the workspace has no record of: started from the application, by another
// session, before a /clear, or its record was lost. Stopping a test that loads the customer's
// system must not depend on `state.json`, so the execution is found in LoadCraft.

import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import { renderCancel, type CancelData } from '../src/render/views/cancel.js';
import { processCancel } from '../src/tools/processCancel.js';
import { runStart } from '../src/tools/runStart.js';
import { processWait } from '../src/tools/processWait.js';
import { SKLEP_IDS } from './golden/index.js';
import { registerDataRoutes } from './fake-backend/routes/data.js';
import {
  planExecutionIds,
  registerExecutionRoutes,
  scriptRuns,
  seedForeignRun,
  type RunScript,
} from './fake-backend/routes/executions.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { seedSklep, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

const NOW = Date.parse('2026-11-22T11:00:00Z');
const IDS = SKLEP_WORLD_IDS;
const RUN = SKLEP_IDS.executionPerf;
const SHORT = `e-${RUN.slice(0, 8)}`;
const OTHER = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const MISSING = '0b5c77aa-1d2e-4f30-8a41-5b6c7d8e9f00';

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

const PERF: RunScript = {
  createdBeforeS: 2,
  startsAtS: 16,
  loadS: 600,
  end: 'completed',
  live: (elapsed) => ({ rps: elapsed * 1.7, p95: 500, errorRate: 0.006 }),
  final: { rps: 1035, p95: 1120, errorRate: 0.006 },
  series: Array<number>(60).fill(500),
};
const PERF_ARGS = {
  scenario: 'checkout',
  environment: 'perf',
  profile: { type: 'ramp_concurrency', vusers: 2000, ramp: 600 },
};

interface Structured {
  readonly data: unknown;
}
const structured = (result: { outcome: unknown }): Structured => result.outcome as Structured;

async function rig(locale: 'en' | 'pl' = 'en'): Promise<ToolRig> {
  const clock = createTestClock(NOW);
  return toolRig({
    tools: [runStart, processWait, processCancel],
    world: (fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerDataRoutes(fake);
      registerExecutionRoutes(fake);
      seedSklep(fake.store, { stage: 'data' });
      scriptRuns(fake, clock, PERF);
      planExecutionIds(fake, [RUN]);
    },
    clock,
    env: { LOADCRAFT_LOCALE: locale },
    files: BOUND,
  });
}

/** A test that is under way in LoadCraft while this workspace has no record of it. */
async function runWithoutRecord(r: ToolRig, listed: 'running' | 'absent' = 'running') {
  const first = await settleClock(r, r.call('run_start', { ...PERF_ARGS, max_wait_s: 5 }));
  expect(first.isError, first.text).toBe(false);
  rmSync(join(r.workspace, 'loadcraft/.cache/state.json'));
  if (listed === 'running') {
    seedForeignRun(r.fake, { id: RUN, status: 'running', environment_id: IDS.environments.perf });
  }
}

const stops = (r: ToolRig, id = RUN) =>
  r.fake.calls.filter(
    (call) => call.method === 'POST' && call.path.endsWith(`/executions/${id}/cancel`),
  );
const anyCancel = (r: ToolRig) =>
  r.fake.calls.filter((call) => call.method === 'POST' && /\/cancel$/u.test(call.path));

describe('cancel: a test without a record in state.json', () => {
  it.each([
    ['its handle', `test_run:${RUN}`],
    ['its short handle', SHORT],
    ['its id', RUN],
  ])('stops it by %s with one POST …/cancel', async (_label, operation) => {
    const r = await rig();
    await runWithoutRecord(r);
    const result = await r.call('process_cancel', { operation });
    expect(result.isError, result.text).toBe(false);
    expect(stops(r)).toHaveLength(1);
    expect(structured(result).data).toMatchObject({ cancelled: true, note: 'stopped' });
    expect(result.text).toContain(`test_run:${RUN}`);
    expect(result.text).toContain('Stopped');
    r.assertClean();
  });

  it('with no argument never stops a test this workspace did not record: it lists it', async () => {
    const r = await rig();
    await runWithoutRecord(r);
    const result = await r.call('process_cancel', {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[cancel_which]');
    expect(result.text).toContain(SHORT);
    expect(anyCancel(r)).toHaveLength(0);
    r.assertClean();
  });

  it('with no argument stops the one running test that this workspace started', async () => {
    const r = await rig();
    const first = await settleClock(r, r.call('run_start', { ...PERF_ARGS, max_wait_s: 5 }));
    expect(first.isError, first.text).toBe(false);
    seedForeignRun(r.fake, { id: RUN, status: 'running', environment_id: IDS.environments.perf });
    const result = await r.call('process_cancel', {});
    expect(result.isError, result.text).toBe(false);
    expect(stops(r)).toHaveLength(1);
    expect(structured(result).data).toMatchObject({ cancelled: true, note: 'stopped' });
  });

  it('with no argument, the recorded test is not stopped when another one runs too', async () => {
    const r = await rig();
    const first = await settleClock(r, r.call('run_start', { ...PERF_ARGS, max_wait_s: 5 }));
    expect(first.isError, first.text).toBe(false);
    seedForeignRun(r.fake, { id: RUN, status: 'running', environment_id: IDS.environments.perf });
    seedForeignRun(r.fake, { id: OTHER, status: 'running', environment_id: null });
    const result = await r.call('process_cancel', {});
    expect(result.text).toContain('[cancel_which]');
    expect(anyCancel(r)).toHaveLength(0);
  });

  it('with no argument and two tests running stops neither and lists both', async () => {
    const r = await rig();
    await runWithoutRecord(r);
    seedForeignRun(r.fake, { id: OTHER, status: 'building', environment_id: null });
    const result = await r.call('process_cancel', {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[cancel_which]');
    expect(result.text).toContain(SHORT);
    expect(result.text).toContain(`e-${OTHER.slice(0, 8)}`);
    expect(anyCancel(r)).toHaveLength(0);
  });

  it('with no argument and nothing running says so and sends nothing', async () => {
    const r = await rig();
    const result = await r.call('process_cancel', {});
    expect(result.isError, result.text).toBe(false);
    expect(structured(result).data).toMatchObject({ cancelled: false, note: 'none_running' });
    expect(result.text).toContain('No test is running');
    expect(anyCancel(r)).toHaveLength(0);
  });

  it('with no argument and a list that cannot be read does not say that nothing is running', async () => {
    const r = await rig();
    r.fake.faults.next(
      'GET',
      '/api/v1/projects/{project_id}/gatling/executions',
      {
        status: 200,
        body: { executions: 'none', total: 0 },
      },
      { outsideContract: true },
    );
    const result = await r.call('process_cancel', {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[run_occupancy_unknown]');
    expect(result.text).not.toContain('No test is running');
    expect(anyCancel(r)).toHaveLength(0);
  });

  it('an id LoadCraft does not know is a named error that lists what can be stopped', async () => {
    const r = await rig();
    await runWithoutRecord(r);
    for (const operation of [`test_run:${MISSING}`, MISSING, 'e-0b5c77aa', 'nonsense']) {
      const result = await r.call('process_cancel', { operation });
      expect(result.isError, operation).toBe(true);
      expect(result.text, operation).toContain('[cancel_target_unknown]');
      expect(result.text, operation).toContain(SHORT);
    }
    expect(anyCancel(r)).toHaveLength(0);
    r.assertClean();
  });

  it('a test that already ended is reported, with no POST and a way to its report', async () => {
    const r = await rig();
    await runWithoutRecord(r, 'absent');
    await r.clock.advance(700_000);
    const result = await r.call('process_cancel', { operation: `test_run:${RUN}` });
    expect(result.isError, result.text).toBe(false);
    expect(anyCancel(r)).toHaveLength(0);
    expect(structured(result).data).toMatchObject({
      cancelled: false,
      note: 'ended',
      ended: 'completed',
    });
    expect(result.text).toContain('already ended');
    expect(result.text).toContain(`results_get_report with ${SHORT}`);
  });

  it('says it in Polish', async () => {
    const r = await rig('pl');
    await runWithoutRecord(r);
    const stopped = await r.call('process_cancel', { operation: SHORT });
    expect(stopped.text).toContain('Zatrzymano');
    const unknown = await r.call('process_cancel', { operation: MISSING });
    expect(unknown.text).toContain('[cancel_target_unknown]');
    expect(unknown.text).toContain('Nie ma wykonania testu');
  });

  it('a record in state.json is still enough: a handle with a record needs no list', async () => {
    const r = await rig();
    const first = await settleClock(r, r.call('run_start', { ...PERF_ARGS, max_wait_s: 5 }));
    expect(first.isError, first.text).toBe(false);
    const listed = (): number =>
      r.fake.calls.filter((call) => call.method === 'GET' && /\/executions$/u.test(call.path))
        .length;
    const before = listed();
    const result = await r.call('process_cancel', { operation: `test_run:${RUN}` });
    expect(result.isError, result.text).toBe(false);
    expect(stops(r)).toHaveLength(1);
    expect(listed()).toBe(before);
  });
});

describe('cancel view of a test found in LoadCraft', () => {
  const ended: CancelData = {
    operation: `test_run:${RUN}`,
    cancelled: false,
    note: 'ended',
    ended: 'completed',
    execution: SHORT,
  };
  const none: CancelData = { cancelled: false, note: 'none_running', project: 'sklep' };

  it('draws the same text in en as the snapshot', () => {
    const t = createTranslator('en');
    expect(renderCancel(ended, t)).toMatchSnapshot();
    expect(renderCancel(none, t)).toMatchSnapshot();
  });

  it('draws both outcomes in pl', () => {
    const t = createTranslator('pl');
    expect(renderCancel(ended, t)).toContain('zakończyło się');
    expect(renderCancel(ended, t)).toContain(`results_get_report z ${SHORT}`);
    expect(renderCancel(none, t)).toContain('sklep');
    expect(renderCancel(none, t)).toContain('Żaden test');
  });
});
