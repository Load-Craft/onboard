// `run_start` after the start: the limit of one call, an abort, and a result read beside the state. The run follows a script on the test clock (see
// helpers/runStartWait.ts): the project is built for 18 s, the load lasts 600 s.

import { describe, expect, it, vi } from 'vitest';

import { SKLEP_IDS } from './golden/index.js';
import { rejection, waitFor } from './helpers/async.js';
import { settleClock } from './helpers/clock.js';
import { NOW, PERF, rig, Structured, PERF_ARGS, gets, operations } from './helpers/runStartWait.js';

vi.setConfig({ testTimeout: 120_000 });

// ---- the limit of one call ---------------------------------------------------------------------

describe('the wait ends at the limit, the run goes on', () => {
  it('after 100 s: running, the handle in the text, the start lines and the link in front', async () => {
    const r = await rig({ script: PERF });
    const result = await settleClock(r, r.call('run_start', PERF_ARGS));
    const structured = result.outcome as Structured;
    expect(structured.status).toBe('running');
    expect(structured.operation).toBe(`test_run:${SKLEP_IDS.executionPerf}`);
    expect(result.text).toContain(`test_run:${SKLEP_IDS.executionPerf}`);
    expect(result.text).toContain('process_wait');
    const lines = result.text.split('\n');
    expect(lines[0]).toBe(
      'sprawdzenie danych pod profil ✓ · konta 2\u202f000 ≥ potrzebne ~1\u202f200',
    );
    expect(lines.some((line) => line.startsWith('↗ https://'))).toBe(true);
    expect(
      lines.some((line) =>
        /^1:2\d \/ 10:00 · \d+ żądań\/s · p95≈ 500 ms · błędy 0,6%$/u.test(line),
      ),
    ).toBe(true);
    expect(Object.keys(operations(r))).toEqual([`test_run:${SKLEP_IDS.executionPerf}`]);
  });

  it('a shorter max_wait_s ends the wait earlier', async () => {
    const r = await rig({ script: PERF });
    const result = await settleClock(r, r.call('run_start', { ...PERF_ARGS, max_wait_s: 10 }));
    expect((result.outcome as Structured).status).toBe('running');
    expect(result.text).toContain('budowanie… ');
  });

  it('a longer max_wait_s counts as 100 s', async () => {
    const r = await rig({ script: PERF });
    const result = await settleClock(r, r.call('run_start', { ...PERF_ARGS, max_wait_s: 900 }));
    expect((result.outcome as Structured).status).toBe('running');
    expect(r.clock.now() - NOW).toBeLessThanOrEqual(101_000);
  });

  it('a later call finishes the run from the handle alone', async () => {
    const r = await rig({ script: { ...PERF, loadS: 100 } });
    const first = await settleClock(r, r.call('run_start', PERF_ARGS));
    const operation = (first.outcome as Structured).operation;
    expect(operation).toBeDefined();
    const second = await settleClock(r, r.call('process_wait', { operation }));
    expect((second.outcome as Structured).status).toBe('done');
    expect(second.text).toContain(
      'test zakończony · wykonanie e-3f9a12c4 · dalej: results_get_report',
    );
    expect(second.text).toContain('budowanie ✓ 18 s · test 1:40 / 10:00');
  });

  it('a test still going ten minutes after its planned end is called abandoned', async () => {
    // A smoke test has no planned window, so ten minutes of load is already ten minutes over.
    const smoke = { ...PERF_ARGS, profile: { type: 'smoke', vusers: 1 } };
    const r = await rig({ script: { ...PERF, loadS: 20_000 } });
    const first = await settleClock(r, r.call('run_start', smoke));
    const operation = (first.outcome as Structured).operation;
    let result = first;
    for (let again = 0; again < 12 && !result.isError; again += 1) {
      result = await settleClock(r, r.call('process_wait', { operation }));
    }
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Test porzucony po stronie LoadCraft (restart?)');
    expect(result.text).toContain('→ ');
    expect(operations(r)).toEqual({});
  });
});

// ---- the client gives up -------------------------------------------------------------------------

describe('an abort ends the wait, never the test', () => {
  it('sends no cancel, keeps the operation in the workspace, and the run can be waited for again', async () => {
    const r = await rig({ script: { ...PERF, loadS: 60 } });
    const controller = new AbortController();
    const call = r.call('run_start', PERF_ARGS, { signal: controller.signal });
    // Time goes on until the run is being followed, then the client gives up.
    await waitFor(() => gets(r) > 0, 'the first read of the run');
    await r.clock.advance(10_000);
    controller.abort();
    await rejection(call);

    expect(r.fake.calls.filter((entry) => entry.path.endsWith('/cancel'))).toEqual([]);
    expect(r.fake.calls.filter((entry) => entry.method === 'DELETE')).toEqual([]);
    expect(Object.keys(operations(r))).toEqual([`test_run:${SKLEP_IDS.executionPerf}`]);

    const again = await settleClock(
      r,
      r.call('process_wait', { operation: `test_run:${SKLEP_IDS.executionPerf}` }),
    );
    expect((again.outcome as Structured).status).toBe('done');
  });
});

// ---- the numbers are not the state -------------------------------------------------------------

describe('the result of a run in flight is read beside the state', () => {
  it('an answer that takes 30 s costs the numbers for that long, never the state reads', async () => {
    const r = await rig({ script: { ...PERF, loadS: 60, resultDelayS: 30 } });
    const first = await settleClock(r, r.call('run_start', PERF_ARGS));
    const messages = first.progress.map((entry) => entry.message ?? '');
    // While the first answer is pending the line carries the time alone.
    const running = messages.filter((message) => /^\d+:\d{2} \/ 10:00/u.test(message));
    expect(running.length).toBeGreaterThan(3);
    expect(running[0]).toMatch(/^0:0\d \/ 10:00$/u);
    expect(running.some((message) => message.includes('żądań/s'))).toBe(true);
    const timeOnly = running.slice(
      0,
      running.findIndex((message) => message.includes('żądań/s')),
    );
    expect(timeOnly.length).toBeGreaterThanOrEqual(5);
    // The state was read every 3 s all along: one read each 3 s until the run ends at 78 s.
    expect(gets(r)).toBeGreaterThanOrEqual(25);
    expect((first.outcome as Structured).status).toBe('done');
  });

  it('a metrics store that fails leaves the time alone, and the run still ends', async () => {
    const r = await rig({ script: { ...PERF, loadS: 60, resultFails: true } });
    const first = await settleClock(r, r.call('run_start', PERF_ARGS));
    const running = first.progress
      .map((entry) => entry.message ?? '')
      .filter((message) => /^\d+:\d{2} \/ 10:00/u.test(message));
    expect(running.length).toBeGreaterThan(3);
    expect(running.every((message) => !message.includes('p95'))).toBe(true);
    expect((first.outcome as Structured).status).toBe('done');
    expect(first.text).toContain('test zakończony');
    expect(first.text).toContain('p95≈ 1\u202f120 ms');
  });

  it('a run that has no series at the end still ends, without chart or numbers', async () => {
    const r = await rig({
      script: { ...PERF, loadS: 40, series: [], final: { rps: 0, p95: 0, errorRate: 0 } },
    });
    const first = await settleClock(r, r.call('run_start', PERF_ARGS));
    expect((first.outcome as Structured).status).toBe('done');
    expect(first.text).toContain('test zakończony');
  });
});
