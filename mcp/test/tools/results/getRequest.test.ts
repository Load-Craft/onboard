// `results_get_request` (module results): one request of a run, its counts, its response times
// and its statuses, read from the fake backend over HTTP in one request.

import { describe, expect, it } from 'vitest';

import { resultsGetRequest } from '../../../src/tools/results/getRequest.js';
import { seedRequestDetail } from '../../fake-backend/routes/results.js';
import type { Fake } from '../../fake-backend/server.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import type { ToolRig } from '../../helpers/rig.js';
import {
  executionPath,
  REQUEST_FULL,
  REQUEST_HOSTILE,
  REQUEST_HOSTILE_NAME,
  REQUEST_SECRET,
  REQUEST_UNMEASURED,
  RUN,
  RUN_HANDLE,
  series,
} from './fixtures.js';
import { CONTROL, dataOf, errorCode, readsOf, resultsRig, runCalls, target } from './rig.js';

const TOOL = 'results_get_request';

/** The shape of `format: "data"` (KONTRAKT 3.1). */
interface RequestData {
  readonly run: string;
  readonly run_id: string;
  readonly request: string;
  readonly group: string | null;
  readonly minBoundMs: number | null;
  readonly maxBoundMs: number | null;
  readonly statuses: readonly { readonly key: string; readonly count: number }[];
  readonly series?: readonly Record<string, unknown>[];
  readonly seriesStepS?: number;
}

function rig(seed: (fake: Fake) => void, locale: 'en' | 'pl' = 'en'): Promise<ToolRig> {
  return resultsRig({ tools: [resultsGetRequest], seed, locale });
}

const full = (fake: Fake): void => {
  seedRequestDetail(fake.store, RUN, 'POST /checkout', REQUEST_FULL);
};

const detailCalls = (r: ToolRig) => runCalls(r).filter((call) => call.path.includes('/endpoints/'));

const FULL_VIEW = [
  'request "POST /checkout" of run e-3f9a12c4 · group Checkout',
  '1,240 requests · 1,228 OK · 12 KO (0.97%) · 20.7 req/s',
  'response time, ms (estimates from histogram buckets):',
  '  mean 182 · p50 150 · p75 210 · p90 321 · p95 410 · p99 780',
  '  min ≤ 20 · max ≤ 1,500 (bucket bounds, not samples)',
  'statuses: 200 ×1,228 · 500 ×9 · no response ×3',
  '→ over time: results_get_request with include ["series"]',
  '→ the errors of the run: results_get_errors with execution "e-3f9a12c4"',
].join('\n');

describe('results_get_request', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(resultsGetRequest);
    expect(resultsGetRequest.implemented).toBe(true);
  });

  it('shows the request of the run in one request, without the percentiles route', async () => {
    const r = await rig(full);
    const result = await r.call(TOOL, { run_id: RUN_HANDLE, request: 'POST /checkout' });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(FULL_VIEW);
    expect(detailCalls(r).map(target)).toEqual([
      executionPath(RUN, '/endpoints/POST%20%2Fcheckout'),
    ]);
    expect(runCalls(r).some((call) => call.path.endsWith('/percentiles'))).toBe(false);
  });

  it('with include series still reads once and draws the request over time before the errors', async () => {
    const r = await rig(full);
    const args = { run_id: RUN_HANDLE, request: 'POST /checkout', include: ['series'] };
    const result = await r.call(TOOL, args);
    expect(result.isError, result.text).toBe(false);
    const lines = result.text.split('\n');
    const header = lines.indexOf('over time, 5 s per point:');
    expect(header).toBeGreaterThan(0);
    expect(lines[header + 1]).toMatch(/^ {2}p95 ms {2}\S+ {2}max 450$/u);
    expect(lines[header + 2]).toMatch(/^ {2}req\/s {3}\S+ {2}max 22$/u);
    expect(lines[header + 3]).toMatch(/^ {2}KO\/s {4}\S+ {2}max 2$/u);
    expect(result.text).not.toContain('include ["series"]');
    expect(lines.at(-1)).toBe(
      '→ the errors of the run: results_get_errors with execution "e-3f9a12c4"',
    );
    expect(detailCalls(r)).toHaveLength(1);

    const data = dataOf<RequestData>(await r.call(TOOL, { ...args, format: 'data' }));
    expect(data.series).toHaveLength(3);
    expect(data.seriesStepS).toBe(5);
  });

  it('thins a long series: every ceil(n/120)-th point from the first, the step in seconds with it', async () => {
    const r = await rig((fake) => {
      seedRequestDetail(fake.store, RUN, 'POST /checkout', {
        ...REQUEST_FULL,
        time_series: series(300),
      });
    });
    const data = dataOf<RequestData>(
      await r.call(TOOL, {
        run_id: RUN_HANDLE,
        request: 'POST /checkout',
        include: ['series'],
        format: 'data',
      }),
    );
    // 300 points, stride ceil(300/120) = 3: points 0, 3, …, 297
    expect(data.series).toHaveLength(100);
    expect(data.seriesStepS).toBe(15);
    expect(data.series?.[0]).toMatchObject({ p95: 100 });
    expect(data.series?.[1]).toMatchObject({ p95: 103 });
  });

  it('a request the run counted none of is one line, with no bounds and no group', async () => {
    const r = await rig((fake) => {
      seedRequestDetail(fake.store, RUN, 'GET /health', REQUEST_UNMEASURED);
    });
    const result = await r.call(TOOL, { run_id: RUN_HANDLE, request: 'GET /health' });
    expect(result.text).toBe('run e-3f9a12c4 counted no request "GET /health"');
    const data = dataOf<RequestData>(
      await r.call(TOOL, { run_id: RUN_HANDLE, request: 'GET /health', format: 'data' }),
    );
    expect([data.minBoundMs, data.maxBoundMs, data.group]).toEqual([null, null, null]);
  });

  it('takes the step of the series from the points of the answer, never a constant', async () => {
    const r = await rig((fake) => {
      // points 10 s apart, as a run with a coarser step answers
      const points = series(20).map((point, i) => ({
        ...point,
        timestamp: new Date(Date.parse('2026-11-22T10:30:00Z') + i * 10_000)
          .toISOString()
          .replace('.000Z', 'Z'),
      }));
      seedRequestDetail(fake.store, RUN, 'POST /checkout', {
        ...REQUEST_FULL,
        time_series: points,
      });
    });
    const args = { run_id: RUN_HANDLE, request: 'POST /checkout', include: ['series'] };
    const data = dataOf<RequestData>(await r.call(TOOL, { ...args, format: 'data' }));
    expect(data.seriesStepS).toBe(10);
    expect((await r.call(TOOL, args)).text).toContain('over time, 10 s per point:');
  });

  it.each([
    ['en', 'results_get_report lists the slowest requests'],
    ['pl', 'results_get_report wypisuje najwolniejsze żądania'],
  ] as const)(
    'a name the run does not have: the hint in the language of the call (%s)',
    async (locale, said) => {
      const r = await rig(full, locale);
      const result = await r.call(TOOL, { run_id: RUN_HANDLE, request: 'GET /nope' });
      expect(errorCode(result)).toBe('not_found');
      expect(result.text).toContain(said);
      if (locale === 'pl') expect(result.text).not.toMatch(/lists the slowest|the name is exact/u);
    },
  );

  it('a run the project does not have is not_found of the run, with no hint about request names', async () => {
    const r = await rig(full);
    const result = await r.call(TOOL, {
      run_id: '00000000-0000-4000-8000-000000000999',
      request: 'POST /checkout',
    });
    expect(errorCode(result)).toBe('not_found');
    expect(result.text).not.toContain('slowest requests');
  });

  it('a name the run does not have is not_found, pointing to results_get_report', async () => {
    const r = await rig(full);
    const result = await r.call(TOOL, { run_id: RUN_HANDLE, request: 'GET /nope' });
    expect(errorCode(result)).toBe('not_found');
    expect(result.text).toContain('results_get_report lists the slowest requests');
  });

  it('a credential in the recorded name or the group is masked in the text, the data and the log', async () => {
    // the model names the request; the backend answers with the name as it was recorded
    const r = await rig((fake) => {
      seedRequestDetail(fake.store, RUN, 'GET /reset', REQUEST_SECRET);
    });
    const text = await r.call(TOOL, { run_id: RUN_HANDLE, request: 'GET /reset' });
    expect(text.isError, text.text).toBe(false);
    expect(text.text.split('\n')[0]).toMatch(/^request "GET \/reset\?token=/u);
    const data = dataOf<RequestData>(
      await r.call(TOOL, { run_id: RUN_HANDLE, request: 'GET /reset', format: 'data' }),
    );
    expect(data.request).toMatch(/^GET \/reset\?token=/u);
    // the rig fails the test when a sentinel is in a result, the log or the state file
  });

  it('a hostile name, group and status key stay one line each: no control sequence, no link line', async () => {
    const r = await rig((fake) => {
      seedRequestDetail(fake.store, RUN, REQUEST_HOSTILE_NAME, REQUEST_HOSTILE);
    });
    const result = await r.call(TOOL, { run_id: RUN_HANDLE, request: REQUEST_HOSTILE_NAME });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).not.toMatch(CONTROL);
    const lines = result.text.split('\n');
    expect(lines.some((line) => line.trimStart().startsWith('↗'))).toBe(false);
    expect(lines.filter((line) => line.includes('IGNORE'))).toEqual([lines[0]]);
    const data = dataOf<RequestData>(
      await r.call(TOOL, { run_id: RUN_HANDLE, request: REQUEST_HOSTILE_NAME, format: 'data' }),
    );
    expect(data.statuses.map((status) => status.key).sort()).toEqual(['200', 'other']);
    expect(JSON.stringify(data)).not.toMatch(/\\u001b|\\u0007/u);
  });

  it('format data carries the numbers as the backend gave them, and the log shows its p95 in whole ms', async () => {
    const r = await rig(full);
    const data = dataOf<RequestData>(
      await r.call(TOOL, { run_id: RUN_HANDLE, request: 'POST /checkout', format: 'data' }),
    );
    expect(data).toEqual({
      run: RUN_HANDLE,
      run_id: RUN,
      request: 'POST /checkout',
      group: 'Checkout',
      count: 1240,
      ok: 1228,
      ko: 12,
      errorRate: 0.009677,
      // numbers as the backend gave them; only the view and the log entry round
      rps: 20.66,
      meanMs: 182.4,
      p50: 150.2,
      p75: 210,
      p90: 320.7,
      p95: 410.3,
      p99: 780,
      minBoundMs: 20,
      maxBoundMs: 1500,
      statuses: [
        { key: '200', count: 1228 },
        { key: '500', count: 9 },
        { key: 'no_response', count: 3 },
      ],
    });
    // a read with format data is the mod's, not the conversation's: it leaves no log entry
    await r.call(TOOL, { run_id: RUN_HANDLE, request: 'POST /checkout' });
    expect(readsOf(r).map(([tool, , result]) => [tool, result])).toEqual([
      [TOOL, 'POST /checkout: p95 410 ms'],
    ]);
  });

  it('the handle and the UUID of the run give the same view; an unknown handle is not_found', async () => {
    const r = await rig(full);
    const byHandle = await r.call(TOOL, { run_id: RUN_HANDLE, request: 'POST /checkout' });
    const byId = await r.call(TOOL, { run_id: RUN, request: 'POST /checkout' });
    expect(byHandle.text).toBe(FULL_VIEW);
    expect(byId.text).toBe(FULL_VIEW);
    // the entry names the run by its handle either way: the handle of log.values wins over the UUID
    expect(readsOf(r).map(([, args]) => args)).toEqual([
      `${RUN_HANDLE} POST /checkout`,
      `${RUN_HANDLE} POST /checkout`,
    ]);
    const unknown = await r.call(TOOL, { run_id: 'e-00000000', request: 'POST /checkout' });
    expect(errorCode(unknown)).toBe('not_found');
  });

  it('refuses a missing name, a run that is neither a handle nor a UUID and a doubled include, before any request', async () => {
    const r = await rig(full);
    for (const args of [
      { run_id: RUN_HANDLE },
      { run_id: RUN_HANDLE, request: '   ' },
      { run_id: '../x', request: 'POST /checkout' },
      { run_id: 'E-3F9A12C4', request: 'POST /checkout' },
      { run_id: RUN_HANDLE, request: 'POST /checkout', include: ['series', 'series'] },
    ]) {
      const result = await r.call(TOOL, args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.text, JSON.stringify(args)).not.toMatch(/^\[not_implemented\]/u);
    }
    expect(runCalls(r)).toEqual([]);
  });

  it('answers in Polish with every key of the view', async () => {
    const r = await rig(full, 'pl');
    const result = await r.call(TOOL, { run_id: RUN_HANDLE, request: 'POST /checkout' });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('e-3f9a12c4');
    expect(result.text).not.toMatch(/results_get_request\.[a-z]/u);
    expect(result.text).not.toBe(FULL_VIEW);
  });
});
