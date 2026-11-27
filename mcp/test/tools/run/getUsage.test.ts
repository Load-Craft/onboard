// `run_get_usage` (module run): the finished runs of the last days and the compute time they used,
// read from the fake backend over HTTP. The history is the answer, the compute time a best-effort
// second read.

import { describe, expect, it } from 'vitest';

import { runGetUsage } from '../../../src/tools/run/getUsage.js';
import {
  seedHistory,
  seedUsage,
  type HistoryBody,
  type UsageBody,
} from '../../fake-backend/routes/run.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import type { ToolRig } from '../../helpers/rig.js';
import {
  dataOf,
  gatlingCalls,
  OTHER,
  OTHER_HANDLE,
  RUN,
  RUN_HANDLE,
  readsOf,
  runRig,
} from './rig.js';

const TOOL = 'run_get_usage';

const HISTORY: HistoryBody = {
  entries: [
    {
      execution_id: RUN,
      created_at: '2026-11-22T10:20:00Z',
      status: 'completed',
      duration: 600,
      error_rate: 0.012,
      backend_type: 'local_docker',
      composite_name: '',
    },
    {
      execution_id: OTHER,
      created_at: '2026-11-21T09:00:00Z',
      status: 'failed',
      duration: null,
      error_rate: 0,
      backend_type: 'local_docker',
      composite_name: '',
    },
  ],
  total: 2,
};
const USAGE: UsageBody = { measured_execution_count: 2, total_burn_seconds: 1530 };

interface UsageData {
  readonly project_id: string;
  readonly days: number;
  readonly count: number;
  readonly shown: number;
  readonly items: readonly Record<string, unknown>[];
  readonly totalBurnSeconds: number | null;
  readonly measuredRuns: number | null;
}

function rig(
  options: {
    history?: HistoryBody | { error: { status: number; detail: unknown } };
    usage?: UsageBody | { error: { status: number; detail: unknown } };
    locale?: 'en' | 'pl';
  } = {},
): Promise<ToolRig> {
  return runRig({
    tools: [runGetUsage],
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    seed: (fake) => {
      seedHistory(fake.store, options.history ?? HISTORY);
      seedUsage(fake.store, options.usage ?? USAGE);
    },
  });
}

describe('run_get_usage', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(runGetUsage);
    expect(runGetUsage.implemented).toBe(true);
  });

  it('lists the finished runs by handle and the compute minutes, in two requests', async () => {
    const r = await rig();
    const result = await r.call(TOOL, {});
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        '2 finished runs in the last 30 days:',
        `  ${RUN_HANDLE}  2026-11-22  completed  600 s  1.2%`,
        `  ${OTHER_HANDLE}  2026-11-21  failed         —  0.0%`,
        'compute time of the project: 25.5 min over 2 measured runs (build included)',
      ].join('\n'),
    );
    expect(gatlingCalls(r)).toEqual([
      { path: '/gatling/ops/history', query: { days: '30' } },
      { path: '/gatling/ops/resources', query: {} },
    ]);
  });

  it('carries the figures as the backend gave them in the data, and logs the period', async () => {
    const r = await rig();
    await r.call(TOOL, { days: 7 });
    const data = dataOf<UsageData>(await r.call(TOOL, { days: 7, format: 'data' }));
    expect(data.days).toBe(7);
    expect(data.count).toBe(2);
    expect(data.items[0]).toEqual({
      run: RUN_HANDLE,
      run_id: RUN,
      at: '2026-11-22T10:20:00Z',
      status: 'completed',
      durationS: 600,
      errorRate: 0.012,
      backend: 'local_docker',
    });
    expect(data.totalBurnSeconds).toBe(1530);
    expect(data.measuredRuns).toBe(2);
    expect(
      gatlingCalls(r)
        .map((call) => call.query.days)
        .filter(Boolean),
    ).toEqual(['7', '7']);
    expect(readsOf(r)).toContainEqual([TOOL, '7 days', '2 runs, 25.5 compute minutes']);
  });

  it('says so when the period holds no finished run', async () => {
    const r = await rig({
      history: { entries: [], total: 0 },
      usage: { measured_execution_count: 0, total_burn_seconds: 0 },
    });
    const result = await r.call(TOOL, { days: 1 });
    expect(result.text).toBe(
      [
        'No finished runs in the last 1 days.',
        'compute time of the project: 0.0 min over 0 measured runs (build included)',
      ].join('\n'),
    );
  });

  it('keeps the runs when the compute time cannot be read', async () => {
    const r = await rig({ usage: { error: { status: 500, detail: 'metrics store down' } } });
    const result = await r.call(TOOL, {});
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain(`  ${RUN_HANDLE}  2026-11-22`);
    expect(result.text.split('\n').at(-1)).toBe(
      'compute time of the project: not available right now',
    );
    const data = dataOf<UsageData>(await r.call(TOOL, { format: 'data' }));
    expect(data.totalBurnSeconds).toBeNull();
    expect(data.measuredRuns).toBeNull();
  });

  it('a history the backend cannot give is the error of the call', async () => {
    const r = await rig({ history: { error: { status: 404, detail: 'Project not found: x' } } });
    const result = await r.call(TOOL, {});
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[not_found\]/u);
  });

  it('lists at most 30 runs and says how many the period holds', async () => {
    const entries = Array.from({ length: 35 }, (_, index) => ({
      ...HISTORY.entries[0]!,
      execution_id: `${String(index).padStart(8, '0')}-6b7d-4e21-a8f3-0c5d9e7b1a42`,
    }));
    const r = await rig({ history: { entries, total: 35 } });
    const data = dataOf<UsageData>(await r.call(TOOL, { format: 'data' }));
    expect([data.count, data.shown, data.items.length]).toEqual([35, 30, 30]);
    const text = await r.call(TOOL, {});
    expect(text.text).toContain('  … 30 of 35 runs listed');
  });

  it('refuses days outside 1-365 and a fraction before a request', async () => {
    const r = await rig();
    for (const days of [0, 366, 1.5]) {
      const result = await r.call(TOOL, { days });
      expect(result.isError, String(days)).toBe(true);
      expect(result.text, String(days)).not.toMatch(/^\[not_implemented\]/u);
    }
    expect(gatlingCalls(r)).toEqual([]);
  });

  it('answers in Polish with every key of the view', async () => {
    const r = await rig({ locale: 'pl' });
    const result = await r.call(TOOL, {});
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        '2 zakończone przebiegi z ostatnich 30 dni:',
        `  ${RUN_HANDLE}  2026-11-22  zakończony  600 s  1,2%`,
        `  ${OTHER_HANDLE}  2026-11-21  nieudany        —  0,0%`,
        'czas obliczeń projektu: 25,5 min w 2 zmierzonych przebiegach (z budową)',
      ].join('\n'),
    );
  });
});
