// `run_start` after the start: the views from stored data and the list of runs that cannot be read to the end. The run follows a script on the test clock (see
// helpers/runStartWait.ts): the project is built for 18 s, the load lasts 600 s.

import { describe, expect, it, vi } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import {
  renderRunProgress,
  renderRunDone,
  shapeChart,
  type RunDoneData,
  type RunProgress,
} from '../src/render/views/run.js';
import { foreignRunRow, seedForeignRun } from './fake-backend/routes/executions.js';
import { SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { settleClock } from './helpers/clock.js';
import { assertNoCanary } from './helpers/canary.js';
import { type ToolRig } from './helpers/rig.js';
import { NOW, tPl, PERF, rig, PERF_ARGS, golden, goldenData } from './helpers/runStartWait.js';

vi.setConfig({ testTimeout: 120_000 });

// ---- the views ---------------------------------------------------------------------------------

describe('the views of a run, from stored data', () => {
  it.each([
    ['run1', '10-run_start'],
    ['run5', '11-run_start-qa'],
  ] as const)('%s/%s: the finished view is the golden text', (run, name) => {
    const data = goldenData<RunDoneData>(`${run}/${name}.view.json`);
    expect(`${renderRunDone(data, tPl)}\n`).toBe(golden(run, name));
  });

  it.each([
    ['run1', '10-run_start-postep'],
    ['run5', '11-run_start-qa-postep'],
  ] as const)('%s/%s: the progress line is the golden text', (run, name) => {
    const data = goldenData<RunProgress>(`${run}/${name}.view.json`);
    expect(`${renderRunProgress(data, tPl)}\n`).toBe(golden(run, name));
  });

  it('draws the building line, and the time alone when the numbers are missing', () => {
    expect(
      renderRunProgress(
        { phase: 'building', waitedS: 12, elapsedS: null, plannedS: 600, numbers: null },
        tPl,
      ),
    ).toBe('budowanie… 12 s');
    expect(
      renderRunProgress(
        { phase: 'running', waitedS: 60, elapsedS: 42, plannedS: 600, numbers: null },
        tPl,
      ),
    ).toBe('0:42 / 10:00');
    expect(
      renderRunProgress(
        { phase: 'running', waitedS: 60, elapsedS: 42, plannedS: null, numbers: null },
        createTranslator('en'),
      ),
    ).toBe('0:42');
  });

  it('says a stopped test was stopped, with the report to read next', () => {
    const data = goldenData<RunDoneData>('run1/10-run_start.view.json');
    const text = renderRunDone(
      { ...data, end: { ...data.end, outcome: 'cancelled', elapsedS: 252 } },
      tPl,
    );
    expect(text).toContain('test 4:12 / 10:00');
    expect(text).toContain('test przerwany przed końcem · wykonanie e-3f9a12c4');
    // The longer tool name may wrap to the next line of the view.
    expect(text).toMatch(/dalej:\s+results_get_report/u);
  });

  it('leaves the chart out when the run left no series, and the numbers when there are none', () => {
    const data = goldenData<RunDoneData>('run1/10-run_start.view.json');
    const text = renderRunDone({ ...data, end: { ...data.end, numbers: null, series: [] } }, tPl);
    expect(text).not.toMatch(/[▁▂▃▄▅▆▇█]/u);
    expect(text).toContain('budowanie ✓ 18 s · test 10:00 / 10:00');
    expect(text).not.toContain('p95');
  });

  describe('chart', () => {
    it('averages a long series into 14 columns, lowest to highest block', () => {
      expect(shapeChart(Array.from({ length: 60 }, (_, i) => i))).toHaveLength(14);
      expect(shapeChart(Array.from({ length: 60 }, (_, i) => i)).startsWith('▁')).toBe(true);
      expect(shapeChart(Array.from({ length: 60 }, (_, i) => i)).endsWith('█')).toBe(true);
    });

    it('keeps a short series as it is and draws a flat one on the lowest block', () => {
      expect(shapeChart([1, 5, 9])).toBe('▁▅█');
      expect(shapeChart([18, 18, 18, 18])).toBe('▁▁▁▁');
      expect(shapeChart([100, 104, 98, 101])).toBe('▁▁▁▁');
      expect(shapeChart([])).toBe('');
    });
  });
});

describe('run_start when the list of runs cannot be read to the end', () => {
  const perf = SKLEP_WORLD_IDS.environments.perf;
  const LIST = '/api/v1/projects/{project_id}/gatling/executions';
  const RUNNING = 'bbbbbbbb-1111-4222-8333-444444444444';
  const posts = (r: ToolRig): number =>
    r.fake.calls.filter(
      (call) => call.method === 'POST' && /\/(execute|executions)$/u.test(call.path),
    ).length;

  /** The call is refused with the code, nothing started, and no secret in anything it showed. */
  async function refused(r: ToolRig, code: string): Promise<string> {
    const result = await settleClock(r, r.call('run_start', PERF_ARGS));
    expect(result.isError).toBe(true);
    expect(result.text).toContain(`[${code}]`);
    expect(posts(r)).toBe(0);
    assertNoCanary(result.text, result.outcome);
    r.assertClean();
    return result.text;
  }

  it.each([500])(
    'a %i on the list is run_occupancy_unknown, with the status in the text',
    async (status) => {
      const r = await rig({ script: PERF });
      r.fake.faults.next('GET', LIST, { status, body: { detail: 'boom' } });
      const text = await refused(r, 'run_occupancy_unknown');
      expect(text).toContain(`http_${String(status)}`);
    },
  );

  const faults: ReadonlyArray<readonly [string, { status: number; body?: unknown }]> = [
    ['an error answer', { status: 500, body: { detail: 'boom' } }],
    ['a list that is not an array', { status: 200, body: { executions: 'none', total: 0 } }],
    ['a list that is an object', { status: 200, body: { executions: {}, total: 0 } }],
    ['no list at all', { status: 200, body: { total: 0 } }],
    ['a row without a status', { status: 200, body: { executions: [{ id: 'x' }], total: 1 } }],
    [
      'a row whose status is not text',
      { status: 200, body: { executions: [{ id: 'x', status: 3 }], total: 1 } },
    ],
    ['a row without an id', { status: 200, body: { executions: [{ status: 'completed' }] } }],
    ['a row that is not an object', { status: 200, body: { executions: ['x'], total: 1 } }],
    [
      'a list that says there are more rows',
      {
        status: 200,
        body: { executions: [{ id: 'x', status: 'completed' }], total: 2 },
      },
    ],
    [
      'a list that points to the next page',
      {
        status: 200,
        body: { executions: [{ id: 'x', status: 'completed' }], next_cursor: 'abc' },
      },
    ],
    [
      'a list that says it is cut',
      { status: 200, body: { executions: [], has_more: true, total: 0 } },
    ],
    [
      'an answer cut in the middle',
      { status: 200, body: Buffer.from('{"executions":[{"id":"x","status":"runn') },
    ],
    ['an answer that is not JSON', { status: 200, body: Buffer.from('<html>proxy</html>') }],
  ];

  it.each(faults)(
    'refuses on %s, with a code that is not "free", and starts nothing',
    async (_name, fault) => {
      const r = await rig({ script: PERF });
      r.fake.faults.next('GET', LIST, fault, { outsideContract: true });
      const result = await settleClock(r, r.call('run_start', PERF_ARGS));
      expect(result.isError).toBe(true);
      expect(result.text).not.toContain('test zakończony');
      expect(posts(r)).toBe(0);
      assertNoCanary(result.text, result.outcome);
      r.assertClean();
    },
  );

  it.each(faults.filter(([, fault]) => fault.status === 200))(
    'names the unknown occupancy on %s',
    async (_name, fault) => {
      const r = await rig({ script: PERF });
      r.fake.faults.next('GET', LIST, fault, { outsideContract: true });
      await refused(r, 'run_occupancy_unknown');
    },
  );

  /** 100 finished rows, the oldest created `ageH` hours before the test clock, and an older running one. */
  function fullPage(r: ToolRig, ageH: number): void {
    const oldest = NOW - ageH * 3_600_000;
    for (let index = 0; index < 100; index += 1) {
      seedForeignRun(r.fake, {
        id: `cccccccc-0000-4000-8000-${String(index).padStart(12, '0')}`,
        status: 'completed',
        environment_id: perf,
        created_at: new Date(oldest + index * 1000).toISOString(),
      });
    }
    seedForeignRun(r.fake, {
      id: RUNNING,
      status: 'running',
      environment_id: perf,
      created_at: new Date(oldest - 1000).toISOString(),
    });
  }

  it.each([
    ['30 h', 30, 'unknown'],
    ['119 h, inside the longest life of a run (stress, 120 h)', 119, 'unknown'],
    ['120.9 h, inside it with the hour of the build', 120.9, 'unknown'],
    ['121.1 h, past it', 121.1, 'free'],
    ['300 h', 300, 'free'],
    ['in the future (a clock that is off)', -200, 'unknown'],
  ])('a full page whose oldest row is %s', async (_name, ageH, outcome) => {
    const r = await rig({ script: PERF });
    fullPage(r, ageH);
    if (outcome === 'unknown') {
      await refused(r, 'run_occupancy_unknown');
      return;
    }
    const result = await settleClock(r, r.call('run_start', PERF_ARGS));
    expect(result.isError).toBe(false);
    expect(posts(r)).toBe(1);
  });

  it('the unknown occupancy of a full page says why and what to check', async () => {
    const r = await rig({ script: PERF });
    fullPage(r, 30);
    const result = await settleClock(r, r.call('run_start', PERF_ARGS));
    expect(result.text).toContain('page_too_recent');
    expect(result.text).toContain('process_get_status');
    expect(result.text).not.toMatch(/rare|rzadki/iu);
  });

  it('a full page with a running test among its rows is busy whatever the age', async () => {
    const r = await rig({ script: PERF });
    fullPage(r, 50);
    seedForeignRun(r.fake, {
      id: 'dddddddd-1111-4222-8333-444444444444',
      status: 'running',
      environment_id: perf,
      created_at: new Date(NOW - 60_000).toISOString(),
    });
    await refused(r, 'run_environment_busy');
  });

  it.each([
    ['without created_at', undefined],
    ['with a created_at that is not a time', 'yesterday'],
    ['with a created_at that is not text', 5],
  ])('a full page of old rows, one %s: refuses', async (_name, value) => {
    const r = await rig({ script: PERF });
    const old = new Date(NOW - 100 * 3_600_000).toISOString();
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `eeeeeeee-0000-4000-8000-${String(index).padStart(12, '0')}`,
      status: 'completed',
      created_at: index === 99 ? value : old,
    }));
    r.fake.faults.next(
      'GET',
      LIST,
      { status: 200, body: { executions: rows, total: 100 } },
      { outsideContract: true },
    );
    await refused(r, 'run_occupancy_unknown');
  });

  it('the second page names the running test while the first says nothing: refuses as busy or unknown, never starts', async () => {
    const r = await rig({ script: PERF });
    r.fake.faults.next(
      'GET',
      LIST,
      {
        status: 200,
        body: {
          executions: [{ id: 'x', status: 'completed' }],
          total: 2,
          next_cursor: 'page-2',
        },
      },
      { outsideContract: true },
    );
    const result = await settleClock(r, r.call('run_start', PERF_ARGS));
    expect(result.isError).toBe(true);
    expect(posts(r)).toBe(0);
  });

  it('a running test on the same page settles it even when the list is cut: busy, with its handle', async () => {
    const r = await rig({ script: PERF });
    r.fake.faults.next(
      'GET',
      LIST,
      {
        status: 200,
        body: {
          executions: [
            {
              id: RUNNING,
              status: 'running',
              supervised: true,
              run_manifest: { target_environment_id: perf },
            },
          ],
          total: 5,
        },
      },
      { outsideContract: true },
    );
    await refused(r, 'run_environment_busy');
  });

  it('a status the plugin does not know counts as under way', async () => {
    const r = await rig({ script: PERF });
    // A status outside what the contract lists for a run, which is the point of the case.
    r.fake.faults.next(
      'GET',
      LIST,
      {
        status: 200,
        body: {
          executions: [foreignRunRow({ id: RUNNING, status: 'queued', environment_id: perf })],
          total: 1,
        },
      },
      { outsideContract: true },
    );
    await refused(r, 'run_environment_busy');
  });

  it('a complete list with finished rows only is a free environment', async () => {
    const r = await rig({ script: PERF });
    seedForeignRun(r.fake, { id: RUNNING, status: 'completed', environment_id: perf });
    const result = await settleClock(r, r.call('run_start', PERF_ARGS));
    expect(result.isError).toBe(false);
    expect(posts(r)).toBe(1);
  });
});
