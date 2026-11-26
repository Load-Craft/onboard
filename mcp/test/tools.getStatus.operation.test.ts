// `process_get_status` with `operation`: a snapshot of one operation, read once, without waiting; and with
// `format: "data"`: the data of the view as one JSON block. Without these fields the tool answers
// as before.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { processGetStatus } from '../src/tools/processGetStatus.js';
import { runStart } from '../src/tools/runStart.js';
import { processWait } from '../src/tools/processWait.js';
import { SKLEP_IDS } from './golden/index.js';
import { registerDataRoutes } from './fake-backend/routes/data.js';
import { registerAnalysisReadRoute } from './fake-backend/routes/analysis.js';
import {
  planExecutionIds,
  registerExecutionRoutes,
  scriptRuns,
  type RunScript,
} from './fake-backend/routes/executions.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerStatusRoutes } from './fake-backend/routes/status.js';
import { seedSklep } from './fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { CANARY, toolRig, type ToolRig } from './helpers/rig.js';

const NOW = Date.parse('2026-11-22T11:00:00Z');
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};
const RAMP_2000 = { type: 'ramp_concurrency', vusers: 2000, ramp: 600 } as const;
const HANDLE = `test_run:${SKLEP_IDS.executionPerf}`;

/** 18 s of build, then 600 s of load; from 390 s of load: 690 requests/s, p95 910 ms, 0.6% errors. */
const PERF: RunScript = {
  createdBeforeS: 2,
  startsAtS: 5,
  loadS: 600,
  end: 'completed',
  live: (elapsed) =>
    elapsed >= 390
      ? { rps: 690, p95: 910, errorRate: 0.006 }
      : { rps: 100, p95: 300, errorRate: 0 },
  final: { rps: 690, p95: 1120, errorRate: 0.006 },
  series: [10, 20, 30],
};

async function rig(locale: 'en' | 'pl' = 'en', script: RunScript = PERF): Promise<ToolRig> {
  const clock = createTestClock(NOW);
  return toolRig({
    tools: [processGetStatus, runStart, processWait],
    world: (fake) => {
      scriptRuns(fake, clock, script);
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerDataRoutes(fake);
      registerExecutionRoutes(fake);
      registerStatusRoutes(fake);
      registerAnalysisReadRoute(fake);
      seedSklep(fake.store, { stage: 'data' });
      planExecutionIds(fake, [SKLEP_IDS.executionPerf]);
    },
    clock,
    env: { LOADCRAFT_LOCALE: locale },
    files: BOUND,
  });
}

/**
 * A test that is running when the call stops waiting (that wait takes 1 s of the test clock);
 * `afterS` more seconds pass before the snapshot. Returns how many requests the fake has seen.
 */
async function runningTest(r: ToolRig, afterS: number): Promise<number> {
  const started = await settleClock(
    r,
    r.call('run_start', {
      scenario: 'checkout',
      environment: 'perf',
      profile: RAMP_2000,
      max_wait_s: 1,
    }),
  );
  expect(started.isError).toBe(false);
  await r.clock.advance(afterS * 1000);
  return r.fake.calls.length;
}

const reads = (r: ToolRig, suffix: string, from = 0): number =>
  r.fake.calls.slice(from).filter((call) => call.method === 'GET' && call.path.endsWith(suffix))
    .length;

const golden = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'golden', 'mod', name), 'utf8').replace(/\n$/u, '');

interface Snapshot {
  operation: string;
  kind: string;
  phase?: string;
  elapsed_s: number;
  planned_s?: number;
  load_elapsed_s?: number;
  live?: { rps: number | null; p95_ms: number | null; error_pct: number | null };
}

describe('process_get_status with operation', () => {
  it('returns the snapshot of a running test from one read of the run and one of its numbers, without waiting', async () => {
    const r = await rig();
    const from = await runningTest(r, 404);
    const before = r.clock.now();
    const result = await r.call('process_get_status', { operation: HANDLE, format: 'data' });
    expect(result.isError).toBe(false);
    const data = JSON.parse(result.text) as Snapshot;
    expect(data).toEqual({
      operation: HANDLE,
      kind: 'test_run',
      phase: 'running',
      elapsed_s: 405,
      load_elapsed_s: 400,
      planned_s: 600,
      live: { rps: 690, p95_ms: 910, error_pct: 0.6 },
    });
    // No waiting: the clock did not move, and each source was read exactly once.
    expect(r.clock.now()).toBe(before);
    expect(reads(r, `/gatling/executions/${SKLEP_IDS.executionPerf}`, from)).toBe(1);
    expect(reads(r, `/gatling/executions/${SKLEP_IDS.executionPerf}/result`, from)).toBe(1);
    expect(r.fake.calls.slice(from).filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('a failed test carries the reason of LoadCraft, masked, on one line and cut short', async () => {
    const r = await rig('en', {
      ...PERF,
      end: 'failed',
      endsAfterS: 30,
      errorMessage: `Gradle build failed: boom,\n↗ https://evil.example.com token ${CANARY} ${'x'.repeat(2000)}`,
    });
    await runningTest(r, 100);
    const result = await r.call('process_get_status', { operation: HANDLE, format: 'data' });
    const data = JSON.parse(result.text) as Snapshot & { reason?: string };
    expect(data.phase).toBe('failed');
    expect(data.reason).toContain('Gradle build failed: boom');
    expect(data.reason).not.toContain(CANARY);
    expect(data.reason).not.toContain('\n');
    expect([...(data.reason ?? '')].length).toBeLessThanOrEqual(160);
  });

  it('masks the reason before it cuts it, so that no half of a secret is left', async () => {
    const r = await rig('en', {
      ...PERF,
      end: 'failed',
      endsAfterS: 30,
      errorMessage: `${'x'.repeat(152)} ${CANARY} and more`,
    });
    await runningTest(r, 100);
    const result = await r.call('process_get_status', { operation: HANDLE, format: 'data' });
    const data = JSON.parse(result.text) as Snapshot & { reason?: string };
    expect(data.reason).toBeDefined();
    expect(data.reason).not.toContain(CANARY.slice(0, 6));
  });

  it('a failed test with no message has no reason, and a test that goes well never has one', async () => {
    const failed = await rig('en', { ...PERF, end: 'failed', endsAfterS: 30 });
    await runningTest(failed, 100);
    const none = JSON.parse(
      (await failed.call('process_get_status', { operation: HANDLE, format: 'data' })).text,
    ) as Snapshot & { reason?: string };
    expect(none.phase).toBe('failed');
    expect(none).not.toHaveProperty('reason');
    const fine = await rig('en');
    await runningTest(fine, 404);
    const running = JSON.parse(
      (await fine.call('process_get_status', { operation: HANDLE, format: 'data' })).text,
    ) as Snapshot;
    expect(running).not.toHaveProperty('reason');
  });

  it('leaves the numbers out while the project is still being built, and reads no result', async () => {
    const r = await rig();
    const from = await runningTest(r, 1);
    const result = await r.call('process_get_status', { operation: HANDLE, format: 'data' });
    const data = JSON.parse(result.text) as Snapshot;
    expect(data).toMatchObject({ phase: 'building', elapsed_s: 2, planned_s: 600 });
    expect(data.live).toBeUndefined();
    expect(data.load_elapsed_s).toBeUndefined();
    expect(reads(r, '/result', from)).toBe(0);
  });

  it('leaves the snapshot out of the way of the test: the entry stays, and process_wait still follows it', async () => {
    const r = await rig();
    await runningTest(r, 404);
    await r.call('process_get_status', { operation: HANDLE });
    const entry = join(r.workspace, 'loadcraft', '.cache', 'state.json');
    expect(readFileSync(entry, 'utf8')).toContain(HANDLE);
    await r.clock.advance(300_000);
    const finished = await settleClock(
      r,
      r.call('process_wait', { operation: HANDLE, max_wait_s: 100 }),
    );
    expect(finished.isError).toBe(false);
    expect(finished.text).toContain('test finished');
  });

  it('a result that does not answer in time costs the numbers, not the snapshot', async () => {
    const r = await rig('en', { ...PERF, resultFails: true });
    await runningTest(r, 404);
    // The read of the result is repeated after its 503s; the pauses between tries are on the clock.
    const result = await settleClock(
      r,
      r.call('process_get_status', { operation: HANDLE, format: 'data' }),
    );
    expect(result.isError).toBe(false);
    const data = JSON.parse(result.text) as Snapshot;
    expect(data).toMatchObject({ phase: 'running', planned_s: 600 });
    expect(data.live).toBeUndefined();
  });

  it('gives the numbers 3 s and no more: a result that takes 30 s costs them, not the snapshot', async () => {
    const r = await rig('en', { ...PERF, resultDelayS: 30 });
    await runningTest(r, 404);
    const before = r.clock.now();
    const result = await settleClock(
      r,
      r.call('process_get_status', { operation: HANDLE, format: 'data' }),
    );
    expect(result.isError).toBe(false);
    const data = JSON.parse(result.text) as Snapshot;
    expect(data).toMatchObject({ phase: 'running', planned_s: 600 });
    expect(data.live).toBeUndefined();
    const waitedMs = r.clock.now() - before;
    expect(waitedMs).toBeGreaterThanOrEqual(3000);
    expect(waitedMs).toBeLessThan(10_000);
  });

  it('names an unknown handle', async () => {
    const r = await rig();
    const result = await r.call('process_get_status', {
      operation: 'test_run:00000000-0000-4000-8000-000000000000',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('test_run:00000000-0000-4000-8000-000000000000');
    expect(reads(r, '/result')).toBe(0);
  });

  it('refuses a handle that is not a handle', async () => {
    const r = await rig();
    const result = await r.call('process_get_status', { operation: 'nonsense' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('nonsense');
  });

  it.each(['en', 'pl'] as const)(
    'draws the one-line view (%s) as the pattern says',
    async (locale) => {
      const r = await rig(locale);
      await runningTest(r, 404);
      const result = await r.call('process_get_status', { operation: HANDLE });
      expect(result.text).toBe(golden(`status-operation-test_run.${locale}.txt`));
    },
  );

  it('keeps the token out of the answer', async () => {
    const r = await rig();
    await runningTest(r, 404);
    const result = await r.call('process_get_status', { operation: HANDLE, format: 'data' });
    expect(result.text).not.toContain(CANARY);
    r.assertClean();
  });
});

describe('process_get_status without the new fields', () => {
  it('draws the same text as before and format "text" changes nothing', async () => {
    const r = await rig();
    const plain = await r.call('process_get_status', {});
    const named = await r.call('process_get_status', { format: 'text' });
    expect(plain.isError).toBe(false);
    expect(named.text).toBe(plain.text);
    expect(plain.text).toContain('sklep');
  });

  it('with format "data" gives the data of the view as one JSON block', async () => {
    const r = await rig();
    const result = await r.call('process_get_status', { format: 'data' });
    expect(result.structured).toBeUndefined();
    const data = JSON.parse(result.text) as {
      project: { name: string };
      next: { step: string; hint: string };
      counts: { flows: number };
    };
    expect(data.project.name).toBe('sklep');
    expect(data.next).toMatchObject({ step: expect.any(String) as string });
    expect(result.text).not.toContain(CANARY);
    r.assertClean();
  });

  it('the input schema stays optional: no field is required', async () => {
    const r = await rig();
    const [listed] = (await r.session.listTools()).filter(
      (tool) => tool.name === 'process_get_status',
    );
    expect((await r.call('process_get_status', {})).isError).toBe(false);
    expect(listed?.annotations?.['readOnlyHint']).toBe(true);
    expect(listed?.description).toMatch(/operation/u);
  });
});
