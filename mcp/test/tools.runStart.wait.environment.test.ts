// `run_start` after the start: a test that already runs: the same one, somebody else's, one at a time. The run follows a script on the test clock (see
// helpers/runStartWait.ts): the project is built for 18 s, the load lasts 600 s.

import { describe, expect, it, vi } from 'vitest';

import { SKLEP_IDS } from './golden/index.js';
import { seedForeignRun, startedRuns } from './fake-backend/routes/executions.js';
import { SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { settleClock } from './helpers/clock.js';
import { type ToolRig } from './helpers/rig.js';
import { PERF, rig, Structured, PERF_ARGS, QA_ARGS } from './helpers/runStartWait.js';

vi.setConfig({ testTimeout: 120_000 });

// ---- a second call does not double the load -----------------------------------------------------

describe('run_start while the same test still runs', () => {
  const posts = (r: ToolRig): number =>
    r.fake.calls.filter(
      (call) => call.method === 'POST' && /\/(execute|executions)$/u.test(call.path),
    ).length;

  it('joins the running test: no second start, the same handle, the progress of the first', async () => {
    const r = await rig({ script: PERF });
    const first = await settleClock(r, r.call('run_start', PERF_ARGS));
    const handle = (first.outcome as Structured).operation;
    expect(posts(r)).toBe(1);

    const second = await settleClock(r, r.call('run_start', PERF_ARGS));
    expect(posts(r)).toBe(1);
    expect(startedRuns(r.fake)).toHaveLength(1);
    expect((second.outcome as Structured).status).toBe('running');
    expect((second.outcome as Structured).operation).toBe(handle);
    expect(second.text).toContain('już trwa');
    expect(second.text).toContain(`test_run:${SKLEP_IDS.executionPerf}`);
    expect(second.text.split('\n').some((line) => line.startsWith('↗ https://'))).toBe(true);
  });

  it('refuses another load on the same target and environment, with the handle of the running test', async () => {
    const r = await rig({ script: PERF });
    await settleClock(r, r.call('run_start', PERF_ARGS));
    const second = await settleClock(
      r,
      r.call('run_start', { ...PERF_ARGS, profile: { type: 'smoke', vusers: 1 } }),
    );
    expect(second.isError).toBe(true);
    expect(second.text).toContain(`test_run:${SKLEP_IDS.executionPerf}`);
    expect(second.text).toContain('process_wait');
    expect(posts(r)).toBe(1);
  });

  it('the same load joins and finishes with the run it joined', async () => {
    const r = await rig({ script: { ...PERF, loadS: 100 } });
    await settleClock(r, r.call('run_start', PERF_ARGS));
    const second = await settleClock(r, r.call('run_start', PERF_ARGS));
    expect(posts(r)).toBe(1);
    expect((second.outcome as Structured).status).toBe('done');
    expect(second.text).toContain('test zakończony · wykonanie e-3f9a12c4');
  });

  it('another environment is another test, and a finished test no longer blocks', async () => {
    const r = await rig({
      script: { ...PERF, loadS: 20 },
      ids: [SKLEP_IDS.executionPerf, SKLEP_IDS.executionQa],
    });
    const first = await settleClock(r, r.call('run_start', PERF_ARGS));
    expect((first.outcome as Structured).status).toBe('done');
    const again = await settleClock(r, r.call('run_start', PERF_ARGS));
    expect(posts(r)).toBe(2);
    expect(again.isError).toBe(false);
  });

  it('does not start a second test when the state of the first cannot be read', async () => {
    const r = await rig({ script: PERF });
    await settleClock(r, r.call('run_start', PERF_ARGS));
    r.fake.faults.next('GET', '/api/v1/projects/{project_id}/gatling/executions/{execution_id}', {
      status: 500,
      body: { detail: 'boom' },
    });
    const second = await settleClock(r, r.call('run_start', PERF_ARGS));
    expect(second.isError).toBe(true);
    expect(posts(r)).toBe(1);
  });
});

describe('run_start while somebody else runs a test on the environment', () => {
  const perf = SKLEP_WORLD_IDS.environments.perf;
  const FOREIGN = 'aaaaaaaa-1111-4222-8333-444444444444';
  const posts = (r: ToolRig): number =>
    r.fake.calls.filter(
      (call) => call.method === 'POST' && /\/(execute|executions)$/u.test(call.path),
    ).length;

  async function withForeign(run: Partial<Parameters<typeof seedForeignRun>[1]>): Promise<ToolRig> {
    const r = await rig({ script: PERF });
    seedForeignRun(r.fake, { id: FOREIGN, status: 'running', environment_id: perf, ...run });
    return r;
  }

  it('refuses, names the running test and its live page, and starts nothing', async () => {
    const r = await withForeign({});
    const result = await settleClock(r, r.call('run_start', PERF_ARGS));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('e-aaaaaaaa');
    expect(result.text).toContain(`/gatling/executions/${FOREIGN}/live`);
    expect(result.text).toContain('→ ');
    expect(posts(r)).toBe(0);
  });

  it('a run being built has no manifest yet: its environment is unknown, so it counts as busy', async () => {
    const r = await withForeign({ status: 'building', environment_id: null });
    const result = await settleClock(r, r.call('run_start', PERF_ARGS));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('e-aaaaaaaa');
    expect(result.text).toContain(`/gatling/executions/${FOREIGN}/live`);
    expect(result.text).toContain('budowanie');
    expect(posts(r)).toBe(0);
  });

  it.each([
    ['another environment', { environment_id: SKLEP_WORLD_IDS.environments.qa }],
    ['a finished run', { status: 'completed' as const }],
    ['a run lost in a restart', { supervised: false }],
    ['a self-check', { source: 'self_check' }],
    ['a finished row without a manifest', { environment_id: null, status: 'completed' as const }],
    [
      'a self-check still building',
      { environment_id: null, status: 'building' as const, source: 'self_check' },
    ],
    [
      'a lost run still building',
      { environment_id: null, status: 'building' as const, supervised: false },
    ],
  ])('does not count %s', async (_name, run) => {
    const r = await withForeign(run);
    const result = await settleClock(r, r.call('run_start', PERF_ARGS));
    expect(result.isError).toBe(false);
    expect(posts(r)).toBe(1);
  });
});

describe('one environment, one test at a time', () => {
  const posts = (r: ToolRig): number =>
    r.fake.calls.filter(
      (call) => call.method === 'POST' && /\/(execute|executions)$/u.test(call.path),
    ).length;
  const OTHER = {
    scenario: 'przeglądanie',
    environment: 'perf',
    profile: { type: 'constant', vusers: 4, hold: 900 },
  };

  it('another target on the same environment is refused while the first test runs', async () => {
    const r = await rig({ script: PERF });
    const first = await settleClock(r, r.call('run_start', PERF_ARGS));
    const second = await settleClock(r, r.call('run_start', OTHER));
    expect(second.isError).toBe(true);
    expect(second.text).toContain((first.outcome as Structured).operation);
    expect(second.text).toContain('/live');
    expect(posts(r)).toBe(1);
  });

  it('two calls at once for the same test start one run and share its handle', async () => {
    const r = await rig({ script: PERF });
    const both = await settleClock(
      r,
      Promise.all([r.call('run_start', PERF_ARGS), r.call('run_start', PERF_ARGS)]),
    );
    expect(posts(r)).toBe(1);
    const handles = both.map((call) => (call.outcome as Structured).operation);
    expect(handles).toEqual([
      `test_run:${SKLEP_IDS.executionPerf}`,
      `test_run:${SKLEP_IDS.executionPerf}`,
    ]);
  });

  it('two calls at once for different tests on one environment start one run', async () => {
    const r = await rig({ script: PERF });
    const both = await settleClock(
      r,
      Promise.all([r.call('run_start', PERF_ARGS), r.call('run_start', OTHER)]),
    );
    expect(posts(r)).toBe(1);
    expect(both.filter((call) => call.isError)).toHaveLength(1);
  });

  it('two calls at once on different environments both start', async () => {
    const r = await rig({ script: PERF, ids: [SKLEP_IDS.executionPerf, SKLEP_IDS.executionQa] });
    const both = await settleClock(
      r,
      Promise.all([r.call('run_start', PERF_ARGS), r.call('run_start', QA_ARGS)]),
    );
    expect(posts(r)).toBe(2);
    expect(both.every((call) => !call.isError)).toBe(true);
  });
});
