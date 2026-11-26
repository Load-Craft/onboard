import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import { renderGetReport, type ReportData } from '../src/render/views/getReport.js';
import { resultsGetReport } from '../src/tools/resultsGetReport.js';
import { runStart } from '../src/tools/runStart.js';
import { processWait } from '../src/tools/processWait.js';
import { goldenText, SKLEP_IDS } from './golden/index.js';
import { registerDataRoutes } from './fake-backend/routes/data.js';
import {
  planExecutionIds,
  registerExecutionRoutes,
  scriptRuns,
  type RunScript,
} from './fake-backend/routes/executions.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerResultRoutes } from './fake-backend/routes/results.js';
import type { Fake } from './fake-backend/server.js';
import type { StoredRecord } from './fake-backend/store.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  type SklepEndpointRow,
  type SklepExecution,
  type SklepExecutionResult,
  type SklepTimePoint,
} from './fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { CANARY, toolRig, type ToolRig } from './helpers/rig.js';

vi.setConfig({ testTimeout: 120_000 });

const NOW = Date.parse('2026-11-22T11:00:00Z');
const PERF = SKLEP_IDS.executionPerf;
const QA = SKLEP_IDS.executionQa;
const PROJECT = SKLEP_IDS.project;
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: PROJECT, name: 'sklep' },
  }),
};

const REPORT_PATH = (id: string): string => `/api/v1/projects/${PROJECT}/gatling/executions/${id}`;

/** A document with fields the typed world does not allow (a percentile that was not measured). */
type Loose = StoredRecord & Record<string, unknown>;

interface RigOptions {
  readonly locale?: 'en' | 'pl';
  /** The load `run_start` kept for the run of the qa environment. */
  readonly savedRun?: { readonly requested: number; readonly effective: number };
  /** The `state.json` another server process left in the workspace. */
  readonly state?: string;
}

function stateWith(savedRun: NonNullable<RigOptions['savedRun']>): string {
  return JSON.stringify({
    schema: 1,
    runLoads: {
      [QA]: {
        savedAt: NOW,
        value: {
          execution_id: QA,
          requested_vu: savedRun.requested,
          effective_vu: savedRun.effective,
        },
      },
    },
  });
}

async function rig(options: RigOptions = {}): Promise<ToolRig> {
  return toolRig({
    tools: [resultsGetReport],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerResultRoutes(fake);
      seedSklep(fake.store, { stage: 'executed' });
    },
    clock: createTestClock(NOW),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'pl' },
    files: {
      ...BOUND,
      ...(options.savedRun === undefined
        ? {}
        : { 'loadcraft/.cache/state.json': stateWith(options.savedRun) }),
      ...(options.state === undefined ? {} : { 'loadcraft/.cache/state.json': options.state }),
    },
  });
}

const executions = (r: ToolRig) =>
  r.fake.store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
const results = (r: ToolRig) =>
  r.fake.store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results);

/** Changes fields of a stored run or result, including to values the typed world does not allow. */
function patchRun(r: ToolRig, id: string, patch: Record<string, unknown>): void {
  r.fake.store.collection<Loose>(SKLEP_COLLECTIONS.executions).update(id, patch);
}
function patchResult(r: ToolRig, id: string, patch: Record<string, unknown>): void {
  r.fake.store.collection<Loose>(SKLEP_COLLECTIONS.results).update(id, patch);
}

function view(name: string, run: 'run1' | 'run5' = 'run1'): ReportData {
  const path = fileURLToPath(new URL(`./golden/${run}/${name}.view.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as ReportData;
}

/** The backend fails every attempt of a read (a read is tried three times). */
function failReads(r: ToolRig, path: string, status: number, detail: string): void {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    r.fake.faults.next('GET', path, { status, body: { detail } });
  }
}

/** The text of a result with the lines the view wrapped joined again. */
const unwrapped = (text: string): string => text.replace(/\n {15}/gu, ' ');

const resultsLink = (id: string): string =>
  `↗ https://app.loadcraft.io/projects/${PROJECT}/gatling/executions/${id}?tab=Overview`;

/** The text of a finished call without the link line the registry adds. */
function body(text: string): string[] {
  const lines = text.split('\n');
  return lines.at(-1)?.startsWith('↗ ') === true ? lines.slice(0, -1) : lines;
}

const golden = (run: 'run1' | 'run5', name: string): string[] =>
  goldenText(run, name).replace(/\n$/u, '').split('\n');

/** The perf run as the mock-up shows it: the four requests it lists, not the six of the world. */
function mockupRequests(r: ToolRig): void {
  const row = results(r).require(PERF);
  const wanted = ['POST /checkout', 'POST /cart/items', 'GET /products', 'GET /categories'];
  patchResult(r, PERF, { endpoints: row.endpoints.filter((e) => wanted.includes(e.name)) });
}

/** A passed run of the qa environment whose load the plugin clamped; no percentiles, no rows. */
function seedQa(r: ToolRig, overrides: Partial<SklepExecution> = {}): void {
  const perf = executions(r).require(PERF);
  const passed = (actual: number, index: number) => {
    const assertion = perf.sla_verdict?.assertions[index];
    if (assertion === undefined) throw new Error('the perf run has two assertions');
    return { ...assertion, actual, passed: true, samples: 10_900 };
  };
  const { sla_verdict: perfVerdict } = perf;
  if (perfVerdict === null) throw new Error('the perf run has a verdict');
  executions(r).insert({
    ...perf,
    id: QA,
    run_exit_code: 0,
    sla_verdict: { ...perfVerdict, status: 'passed', assertions: [passed(210, 0), passed(0, 1)] },
    result_has_errors: false,
    total_requests: 10_900,
    ok_count: 10_900,
    ko_count: 0,
    duration_seconds: 600,
    warnings: [],
    run_manifest: {
      ...perf.run_manifest,
      workload: { kind: 'adr005', value: { type: 'ramp_concurrency', vusers: 100, ramp: 600 } },
    },
    ...overrides,
  });
  const perfResult = results(r).require(PERF);
  const unmeasured: Loose = {
    ...perfResult,
    id: QA,
    total_requests: 10_900,
    ok_requests: 10_900,
    ko_requests: 0,
    ok_count: 10_900,
    ko_count: 0,
    error_rate: 0,
    requests_per_second: 18.17,
    throughput: 18.17,
    duration_seconds: 600,
    p50: null,
    p75: null,
    p95: null,
    p99: null,
    percentile_source: 'not-measured',
    error_summary: [],
    per_request: [],
    endpoints: [],
    errors: [],
    time_series_data: [],
  };
  r.fake.store.collection<Loose>(SKLEP_COLLECTIONS.results).insert(unmeasured);
}

describe('results_get_report: the golden texts', () => {
  it('draws run 1 (perf, SLA failed) exactly as the mock-up, in pl, with the link to Overview', async () => {
    const r = await rig();
    mockupRequests(r);
    const result = await r.call('results_get_report', { execution: 'e-3f9a12c4' });
    expect(result.isError, result.text).toBe(false);
    expect(result.text.split('\n')).toEqual(golden('run1', '11-results_get_report'));
    expect(result.text.split('\n').at(-1)).toBe(resultsLink(PERF));
    r.assertClean();
  });

  it('draws run 5 (qa, passed, load clamped) exactly as the mock-up', async () => {
    const r = await rig({ savedRun: { requested: 2000, effective: 100 } });
    seedQa(r);
    const result = await r.call('results_get_report', { execution: QA });
    expect(result.isError, result.text).toBe(false);
    expect(body(result.text)).toEqual(golden('run5', '12-results_get_report-qa'));
    expect(result.text.split('\n').at(-1)).toBe(resultsLink(QA));
  });

  it.each([
    ['run1', '11-results_get_report', 'run1' as const],
    ['run5', '12-results_get_report-qa', 'run5' as const],
  ])('the view data of %s %s renders to the golden text', (_run, name, run) => {
    const t = createTranslator('pl');
    const expected = golden(run, name);
    // The registry adds the link line, so a golden text that ends with one is drawn without it.
    const last = expected.at(-1) ?? '';
    const drawn = renderGetReport(view(name, run), t).split('\n');
    expect(last.startsWith('↗ ') ? [...drawn, last] : drawn).toEqual(expected);
  });

  it('renders the same data in en', () => {
    const t = createTranslator('en');
    expect(renderGetReport(view('11-results_get_report'), t)).toMatchSnapshot();
    expect(renderGetReport(view('12-results_get_report-qa', 'run5'), t)).toMatchSnapshot();
  });

  it('draws the whole world of run 1: six requests, the slowest first, nothing marked with a tick', async () => {
    const r = await rig();
    const { text } = await r.call('results_get_report', { execution: PERF });
    const lines = body(text);
    const at = lines.indexOf('p95 według żądań (szacunek)');
    const rows = lines.slice(at + 1, at + 7);
    expect(rows.map((line) => line.trim().replace(/\s+/gu, ' '))).toEqual([
      'POST /checkout 1 840 ms',
      'POST /cart/items 620 ms',
      'GET /products 290 ms',
      'GET /orders 210 ms',
      'POST /auth/login 140 ms',
      'GET /categories 110 ms',
    ]);
  });

  it('shows the same report in en', async () => {
    const r = await rig({ locale: 'en' });
    mockupRequests(r);
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).toMatchSnapshot();
  });
});

describe('results_get_report: what it says only as far as the backend measured', () => {
  it('puts thresholds on the whole test only: no tick or cross beside a request', async () => {
    const r = await rig();
    const { text } = await r.call('results_get_report', { execution: PERF });
    const lines = body(text);
    const at = lines.indexOf('p95 według żądań (szacunek)');
    expect(lines.slice(at).join('\n')).not.toMatch(/[✓✕]/u);
    expect(lines.filter((line) => /[✓✕]/u.test(line))).toHaveLength(1);
    expect(lines.find((line) => line.startsWith('progi'))).toContain('✕');
  });

  it('counts an unmet threshold of a single request without marking the request', async () => {
    const r = await rig();
    const run = executions(r).require(PERF);
    const [first] = run.sla_verdict?.assertions ?? [];
    if (run.sla_verdict === null || first === undefined) throw new Error('verdict expected');
    patchRun(r, PERF, {
      sla_verdict: {
        ...run.sla_verdict,
        assertions: [
          ...run.sla_verdict.assertions,
          {
            ...first,
            subject: { scope: 'named', path: ['POST /checkout'] },
            passed: false,
            actual: 1840,
          },
        ],
      },
    });
    const { text } = await r.call('results_get_report', { execution: PERF });
    const lines = body(text);
    const thresholdLine = unwrapped(text)
      .split('\n')
      .find((line) => line.startsWith('progi'));
    expect(thresholdLine?.split(' · ')).toEqual([
      'progi          p95 1\u202f120 ms > 400 ms ✕',
      'błędy 0,6% < 1% ✓',
      'niespełnione progi dla pojedynczych żądań: 1',
    ]);
    expect(thresholdLine).not.toMatch(/1\u202f840|checkout/u);
    const at = lines.indexOf('p95 według żądań (szacunek)');
    expect(lines.slice(at).join('\n')).not.toMatch(/[✓✕]/u);
  });

  it('heads the per-request p95 as an estimate', async () => {
    const r = await rig({ locale: 'en' });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).toContain('p95 by request (estimate)');
  });

  it('replaces the estimated sections with a sentence once the series expired', async () => {
    const r = await rig();
    patchResult(r, PERF, {
      series_source: 'absent_retention',
      time_series_data: [],
      endpoints: [],
    });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).not.toContain('p95 według żądań (szacunek)');
    expect(text).not.toContain('ponad progiem');
    expect(text).toContain('serie metryk tego testu wygasły');
    // The exact figures stay: they were stored with the result.
    expect(text).toContain('p50 180 ms · p95 1 120 ms · p99 2 900 ms');
  });

  it('says it when the metrics store does not answer, and keeps the facts of the run', async () => {
    const r = await rig();
    failReads(
      r,
      `${REPORT_PATH(PERF)}/result`,
      503,
      'Metrics backend unreachable at http://prometheus (down)',
    );
    const { text } = await settleClock(r, r.call('results_get_report', { execution: PERF }));
    expect(text).toContain('werdykt        SLA FAILED');
    expect(text).toContain('412 300');
    expect(text).toContain('magazyn metryk nie odpowiedział');
  });

  it('always calls the load planned, and gives the measured duration beside it', async () => {
    const r = await rig();
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).toContain('przebieg       10 min · planowane 0 → 2 000 jednocześnie');
  });

  it('plans from the run manifest for every kind of profile', async () => {
    const r = await rig();
    const run = executions(r).require(PERF);
    patchRun(r, PERF, {
      run_manifest: {
        ...run.run_manifest,
        workload: { kind: 'adr005', value: { type: 'constant', vusers: 4, hold: 900 } },
      },
    });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).toContain('planowane 4 nowych/s');
  });

  it('leaves the plan out when the run recorded none, and says nothing of it', async () => {
    const r = await rig();
    const run = executions(r).require(PERF);
    patchRun(r, PERF, { run_manifest: { ...run.run_manifest, workload: null } });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).toContain('przebieg       10 min\n');
    expect(text).not.toContain('planowane');
  });
});

describe('results_get_report: the clamped load', () => {
  it('takes it from the run the plugin started (the operation saved in the workspace)', async () => {
    const r = await rig({ savedRun: { requested: 2000, effective: 100 } });
    seedQa(r);
    const { text } = await r.call('results_get_report', { execution: QA });
    expect(text).toContain(
      'uwaga          obciążenie ograniczone limitem środowiska (100 z 2 000)',
    );
  });

  it('takes it from the warnings of the run when another session started it', async () => {
    const r = await rig();
    seedQa(r, {
      warnings: [
        "Workload clamped to environment caps: 'ramp_concurrency' vusers 2000 → 100 (max_vu=100, max_rps=None).",
      ],
    });
    const { text } = await r.call('results_get_report', { execution: QA });
    expect(text).toContain('obciążenie ograniczone limitem środowiska (100 z 2 000)');
  });

  it('says the load was limited even when the warning has no numbers it can read', async () => {
    const r = await rig();
    seedQa(r, { warnings: ['Workload clamped to environment caps: something else entirely.'] });
    const { text } = await r.call('results_get_report', { execution: QA });
    expect(text).toContain('uwaga          obciążenie ograniczone limitem środowiska\n');
  });

  it('draws no line when nothing says the load was clamped', async () => {
    const r = await rig({ savedRun: { requested: 100, effective: 100 } });
    seedQa(r, { warnings: ['Something unrelated happened.'] });
    const { text } = await r.call('results_get_report', { execution: QA });
    expect(text).not.toContain('uwaga');
  });

  it('prefers the saved numbers to the warning, and ignores a run that was not clamped', async () => {
    const r = await rig({ savedRun: { requested: 500, effective: 200 } });
    seedQa(r, {
      warnings: ["Workload clamped to environment caps: 'x' vusers 900 → 300 (max_vu=300)."],
    });
    const { text } = await r.call('results_get_report', { execution: QA });
    expect(text).toContain('(200 z 500)');
    expect(text).not.toContain('300 z 900');
  });
});

// ---- the load of a test that is over -----------------------------------------------------------

/** A run of 600 s of load after 18 s of build, flat at the clamped 18 requests/s. */
const QA_RUN: RunScript = {
  createdBeforeS: 2,
  startsAtS: 16,
  loadS: 600,
  end: 'completed',
  live: () => ({ rps: 18, p95: 205, errorRate: 0 }),
  final: { rps: 18, p95: 210, errorRate: 0 },
  series: Array<number>(60).fill(18),
};
const RAMP = (vusers: number) => ({ type: 'ramp_concurrency', vusers, ramp: 600 }) as const;

/** `run_start` on the environment, then `process_wait` until the run is over. Returns the `state.json` left behind. */
async function runUntilEnd(
  environment: 'qa' | 'perf',
  vusers: number,
  executionId: string,
  state?: string,
): Promise<string> {
  const clock = createTestClock(NOW);
  const starter = await toolRig({
    tools: [runStart, processWait],
    world: (fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerDataRoutes(fake);
      registerExecutionRoutes(fake);
      seedSklep(fake.store, { stage: 'data' });
      scriptRuns(fake, clock, QA_RUN);
      planExecutionIds(fake, [executionId]);
    },
    clock,
    env: { LOADCRAFT_LOCALE: 'pl' },
    files: {
      ...BOUND,
      ...(state === undefined ? {} : { 'loadcraft/.cache/state.json': state }),
    },
  });
  const args = {
    scenario: 'checkout',
    environment,
    profile: RAMP(vusers),
    ...(environment === 'qa' ? { confirm_capped: true } : {}),
  };
  let result = await settleClock(starter, starter.call('run_start', args));
  for (let again = 0; again < 12; again += 1) {
    const seen = result.outcome;
    if (result.isError || seen?.status !== 'running' || seen.operation === undefined) break;
    result = await settleClock(
      starter,
      starter.call('process_wait', { operation: seen.operation }),
    );
  }
  expect(result.isError, result.text).toBe(false);
  expect(result.outcome?.status).toBe('done');
  return readFileSync(join(starter.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8');
}

describe('results_get_report: the load of a test that is over', () => {
  it('still says the plugin clamped the load, in a new server process', async () => {
    const left = await runUntilEnd('qa', 2000, QA);
    // The run is over: its operation is gone from the workspace, what is left is the kept load.
    expect(Object.keys((JSON.parse(left) as { opPayloads: object }).opPayloads)).toEqual([]);

    const r = await rig({ state: left });
    seedQa(r);
    const { text } = await r.call('results_get_report', { execution: QA });
    expect(text).toContain(
      'uwaga          obciążenie ograniczone limitem środowiska (100 z 2 000)',
    );
    expect(body(text)).toEqual(golden('run5', '12-results_get_report-qa'));
  });

  it('draws no note for a test of an environment that did not clamp the load', async () => {
    const left = await runUntilEnd('perf', 2000, QA);
    const kept = (JSON.parse(left) as { runLoads: Record<string, unknown> }).runLoads;
    expect(Object.keys(kept)).toEqual([]);
    const r = await rig({ state: left });
    seedQa(r);
    const { text } = await r.call('results_get_report', { execution: QA });
    expect(text).not.toContain('uwaga');
  });

  it('says it for the run it was kept for only, by its id or by its short handle', async () => {
    const entry = (id: string, requested: number, effective: number) => ({
      savedAt: NOW,
      value: { execution_id: id, requested_vu: requested, effective_vu: effective },
    });
    const state = JSON.stringify({
      schema: 1,
      runLoads: { other: entry('other', 500, 200), [QA]: entry(QA, 2000, 100) },
    });
    const r = await rig({ state });
    seedQa(r);
    const byId = await r.call('results_get_report', { execution: QA });
    expect(byId.text).toContain('(100 z 2\u202f000)');
    expect(byId.text).not.toContain('200 z 500');
    const byShort = await r.call('results_get_report', { execution: 'e-8c2d4f17' });
    expect(byShort.text).toContain('(100 z 2\u202f000)');
    const another = await r.call('results_get_report', { execution: PERF });
    expect(another.isError, another.text).toBe(false);
    expect(another.text).not.toContain('uwaga');
  });

  it('keeps the loads of the last 50 runs only, the oldest dropped', async () => {
    const old = (index: number) => ({
      savedAt: NOW - 1_000_000 + index,
      value: { execution_id: `old-${index}`, requested_vu: 2000, effective_vu: 100 },
    });
    const crowded = JSON.stringify({
      schema: 1,
      runLoads: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`old-${i}`, old(i)])),
    });
    const left = JSON.parse(await runUntilEnd('qa', 2000, QA, crowded)) as {
      runLoads: Record<string, { value: unknown }>;
    };
    const kept = Object.keys(left.runLoads);
    expect(kept).toHaveLength(50);
    expect(kept).toContain(QA);
    expect(kept).not.toContain('old-0');
    expect(kept).not.toContain('old-10');
    expect(kept).toContain('old-11');
    expect(left.runLoads[QA]?.value).toEqual({
      run_id: QA,
      requested_vu: 2000,
      effective_vu: 100,
    });
  });
});

describe('results_get_report: when the p95 went over the threshold', () => {
  /** A p95 series of one bucket per 5 s, `over` seconds above 400 ms and the rest at 100 ms. */
  function series(over: readonly [number, number]): SklepTimePoint[] {
    return Array.from({ length: 120 }, (_unused, index) => {
      const elapsed = index * 5;
      const high = elapsed >= over[0] && elapsed < over[1];
      return {
        elapsed_seconds: elapsed,
        requests_per_second: 100,
        ok_per_second: 100,
        ko_per_second: 0,
        mean_response_time: 100,
        p50_histogram: 80,
        p95_histogram: high ? 900 : 100,
        p99_histogram: 200,
        max_response_time: 300,
      };
    });
  }

  it('says "from" only for a window that lasts to the end of the test', async () => {
    const r = await rig();
    patchResult(r, PERF, { time_series_data: series([370, 600]) });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).toContain('p95 ponad progiem od około 6:10');
    expect(text).not.toContain('chwilowo');
  });

  it('says "for a moment" for a window that ended, with the time it started', async () => {
    const r = await rig();
    patchResult(r, PERF, { time_series_data: series([120, 150]) });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).toContain('p95 chwilowo ponad progiem (około 2:00)');
    expect(text).not.toContain('ponad progiem od');
  });

  it('names the moment as approximate in English too', async () => {
    const r = await rig({ locale: 'en' });
    patchResult(r, PERF, { time_series_data: series([370, 600]) });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).toContain('p95 over the threshold from around 6:10');
    patchResult(r, PERF, { time_series_data: series([120, 150]) });
    const brief = await r.call('results_get_report', { execution: PERF });
    expect(brief.text).toContain('p95 over the threshold for a moment (around 2:00)');
  });

  it('does not count a single bucket over the limit', async () => {
    const r = await rig();
    patchResult(r, PERF, { time_series_data: series([120, 125]) });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).not.toContain('ponad progiem');
  });

  it('says nothing when the run has no p95 threshold to compare with', async () => {
    const r = await rig();
    const run = executions(r).require(PERF);
    const [, errors] = run.sla_verdict?.assertions ?? [];
    if (run.sla_verdict === null || errors === undefined) throw new Error('verdict expected');
    patchRun(r, PERF, { sla_verdict: { ...run.sla_verdict, assertions: [errors] } });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).not.toContain('ponad progiem');
  });

  it('does not hold the series against a bound that is not in milliseconds', async () => {
    const r = await rig();
    const run = executions(r).require(PERF);
    if (run.sla_verdict === null) throw new Error('verdict expected');
    patchRun(r, PERF, {
      sla_verdict: {
        ...run.sla_verdict,
        assertions: run.sla_verdict.assertions.map((a) => ({ ...a, unit: 's' })),
      },
    });
    patchResult(r, PERF, { time_series_data: series([0, 600]) });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).not.toContain('ponad progiem');
  });

  it('does not place the moment for a run longer than the hour the series covers', async () => {
    const r = await rig();
    patchRun(r, PERF, { duration_seconds: 7200 });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).not.toContain('ponad progiem');
    expect(text).toContain('przebieg       2 h');
  });
});

describe('results_get_report: the verdict names', () => {
  const verdictLine = (text: string): string =>
    body(text).find((line) => line.startsWith('werdykt')) ?? '';

  async function verdictOf(patch: Record<string, unknown>): Promise<string[]> {
    const r = await rig();
    patchRun(r, PERF, patch);
    const result = await r.call('results_get_report', { execution: PERF });
    expect(result.isError, result.text).toBe(false);
    return body(result.text);
  }

  function passedVerdict(r: ToolRig): SklepExecution['sla_verdict'] {
    const run = executions(r).require(PERF);
    if (run.sla_verdict === null) throw new Error('verdict expected');
    return {
      ...run.sla_verdict,
      status: 'passed',
      assertions: run.sla_verdict.assertions.map((a) => ({ ...a, passed: true })),
    };
  }

  it('SLA PASSED', async () => {
    const r = await rig();
    patchRun(r, PERF, {
      sla_verdict: passedVerdict(r),
      run_exit_code: 0,
      result_has_errors: false,
    });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(verdictLine(text)).toBe('werdykt        SLA PASSED');
  });

  it('SLA FAILED, with no reason repeated beside it', async () => {
    const r = await rig();
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(verdictLine(text)).toBe('werdykt        SLA FAILED');
  });

  it('SLA NOT JUDGED with its reason when LoadCraft refused to judge', async () => {
    const r = await rig();
    const run = executions(r).require(PERF);
    if (run.sla_verdict === null) throw new Error('verdict expected');
    patchRun(r, PERF, {
      sla_verdict: {
        ...run.sla_verdict,
        status: 'refused',
        reason: 'latency_artifact_missing',
        assertions: [],
      },
      result_has_errors: false,
      run_exit_code: 0,
    });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(verdictLine(text)).toContain('SLA NOT JUDGED · LoadCraft odmówił oceny progów');
    expect(text).toContain('latency_artifact_missing');
    expect(body(text).some((line) => line.startsWith('progi'))).toBe(false);
  });

  it('SLA NOT JUDGED with its reason when the run has no verdict at all', async () => {
    const lines = await verdictOf({
      sla_verdict: null,
      run_exit_code: 0,
      result_has_errors: false,
    });
    expect(unwrapped(lines.join('\n'))).toContain(
      'werdykt        SLA NOT JUDGED · LoadCraft nie zapisał werdyktu progów dla tego testu',
    );
  });

  it('COMPLETED · ERRORS when the thresholds passed but requests failed', async () => {
    const r = await rig();
    patchRun(r, PERF, {
      sla_verdict: passedVerdict(r),
      run_exit_code: 0,
      result_has_errors: true,
    });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(verdictLine(text)).toBe('werdykt        COMPLETED · ERRORS');
  });

  it('INVARIANTS VIOLATED, naming the invariant', async () => {
    const r = await rig();
    patchRun(r, PERF, {
      sla_verdict: passedVerdict(r),
      run_exit_code: 0,
      result_has_errors: false,
      invariant_summary: {
        state: 'evaluated',
        results: [{ name: 'orders-total', status: 'evaluated', passed: false }],
      },
    });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(verdictLine(text)).toBe(
      'werdykt        INVARIANTS VIOLATED · naruszona niezmienność: orders-total',
    );
  });

  it('RUN FAILED, with the message LoadCraft kept', async () => {
    const lines = await verdictOf({
      status: 'failed',
      sla_verdict: null,
      run_exit_code: 137,
      error_message: 'Injector container exited with code 137',
    });
    expect(lines).toContain('werdykt        RUN FAILED');
    expect(lines).toContain('błąd runu      Injector container exited with code 137');
  });

  it('the message of a failed run is quoted, masked and cut short', async () => {
    const r = await rig();
    patchRun(r, PERF, {
      status: 'failed',
      sla_verdict: null,
      run_exit_code: 137,
      error_message: `Injector exited, token ${CANARY} ${'y'.repeat(2000)}`,
    });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).toContain('Injector exited');
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain('y'.repeat(300));
    r.assertClean();
  });

  it('CANCELLED', async () => {
    const lines = await verdictOf({ status: 'cancelled', sla_verdict: null });
    expect(lines[0]).toBe('werdykt        CANCELLED');
  });

  it('keeps the counts of a failed run that has no result, and drops what needs one', async () => {
    const r = await rig();
    patchRun(r, PERF, { status: 'failed', sla_verdict: null });
    results(r).delete(PERF);
    const result = await r.call('results_get_report', { execution: PERF });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('żądania        412 300');
    expect(result.text).not.toContain('czasy');
    expect(result.text).not.toContain('p95 według żądań');
  });

  it('says in en what the names mean', async () => {
    const r = await rig({ locale: 'en' });
    patchRun(r, PERF, { sla_verdict: null, run_exit_code: 0, result_has_errors: false });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(unwrapped(text)).toContain(
      'verdict        SLA NOT JUDGED · LoadCraft stored no verdict on the thresholds for this test',
    );
  });
});

describe('results_get_report: errors and latency', () => {
  it('counts errors from the groups of the Errors tab, naming the one request that failed', async () => {
    const r = await rig();
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).toContain('błędy          504 Gateway Timeout × 2 480 · tylko POST /checkout');
  });

  it('leaves out the request when several failed, and lists a group that is not a status by its message', async () => {
    const r = await rig();
    const row = results(r).require(PERF);
    const [group] = row.errors;
    if (group === undefined) throw new Error('error group expected');
    patchResult(r, PERF, {
      errors: [
        { ...group, affected_endpoints: ['POST /checkout', 'GET /products'] },
        {
          ...group,
          error_hash: 'gatling-log-0',
          message: 'j.i.IOException: Premature close\n↗ https://evil.example',
          http_status: null,
          affected_endpoints: [],
          count: 12,
        },
      ],
    });
    const { text } = await r.call('results_get_report', { execution: PERF });
    const lines = body(text);
    const at = lines.findIndex((line) => line.startsWith('błędy'));
    expect(lines[at]).toBe('błędy          504 Gateway Timeout × 2 480');
    expect(lines[at + 1]).toBe(
      '               j.i.IOException: Premature close ↗ https://evil.example × 12',
    );
    expect(text.split('\n').filter((line) => line.startsWith('↗'))).toEqual([resultsLink(PERF)]);
  });

  it('says it when the error groups cannot be read', async () => {
    const r = await rig();
    failReads(r, `${REPORT_PATH(PERF)}/errors`, 502, 'Failed to query errors');
    const { text } = await settleClock(r, r.call('results_get_report', { execution: PERF }));
    expect(text).toContain('nie udało się odczytać grup błędów');
  });

  it('labels percentiles read from a histogram as an estimate', async () => {
    const r = await rig();
    patchResult(r, PERF, { percentile_source: 'histogram' });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).toContain('czasy          p50 175 ms · p95 1 100 ms · p99 2 850 ms (szacunek)');
  });

  it('shows no latency line when the percentiles were not measured', async () => {
    const r = await rig({ savedRun: { requested: 100, effective: 100 } });
    seedQa(r);
    const { text } = await r.call('results_get_report', { execution: QA });
    expect(text).not.toContain('czasy');
  });

  it('shows eight requests at most and counts the rest', async () => {
    const r = await rig();
    const row = results(r).require(PERF);
    const [template] = row.endpoints;
    if (template === undefined) throw new Error('endpoint row expected');
    const extra: SklepEndpointRow[] = Array.from({ length: 5 }, (_unused, index) => ({
      ...template,
      name: `GET /extra/${index}`,
      p95_histogram: 50 + index,
    }));
    patchResult(r, PERF, { endpoints: [...row.endpoints, ...extra] });
    const { text } = await r.call('results_get_report', { execution: PERF });
    const lines = body(text);
    const at = lines.indexOf('p95 według żądań (szacunek)');
    expect(lines.slice(at + 1, at + 9).every((line) => /^ {2}\S/u.test(line))).toBe(true);
    expect(lines[at + 9]).toBe('  … i 3 więcej');
    expect(lines.filter((line) => line.includes('GET /extra/0'))).toHaveLength(0);
  });

  it('writes the rate with a decimal below ten requests a second', async () => {
    const r = await rig();
    patchResult(r, PERF, { requests_per_second: 4.26 });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(text).toContain('412 300 · 4,3 na sekundę');
  });
});

describe('results_get_report: a run that is not over, and what it does not know', () => {
  it.each(['pending', 'building', 'running'] as const)(
    'refuses a run that is %s and points to wait with the handle of the run',
    async (status) => {
      const r = await rig();
      patchRun(r, PERF, { status: status });
      const result = await r.call('results_get_report', { execution: PERF });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('jeszcze trwa');
      expect(result.text).toContain('process_wait');
      expect(result.text).toContain(`test_run:${PERF}`);
      const reads = r.fake.calls.filter((call) => call.path.endsWith('/result'));
      expect(reads).toHaveLength(0);
    },
  );

  it('names an unknown short handle and lists none it did not find', async () => {
    const r = await rig();
    const result = await r.call('results_get_report', { execution: 'e-deadbeef' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft nie zna tej pozycji');
  });

  it('names an unknown full id the same way', async () => {
    const r = await rig();
    const result = await r.call('results_get_report', {
      execution: '11111111-2222-4333-8444-555555555555',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft nie zna tej pozycji');
  });

  it('turns a refused token into the invalid-token error with its hint', async () => {
    const r = await rig({ locale: 'en' });
    r.fake.faults.next('GET', REPORT_PATH(PERF), {
      status: 401,
      body: { detail: 'Invalid token' },
    });
    const result = await r.call('results_get_report', { execution: PERF });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft did not accept the API token');
    expect(result.text).toContain('→ Create a new API token in LoadCraft');
  });

  it('refuses a backend without /meta as too old', async () => {
    const r = await rig({ locale: 'en' });
    r.fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
    const result = await r.call('results_get_report', { execution: PERF });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('older than the plugin supports');
  });

  it('reads the four documents once each, and writes nothing', async () => {
    const r = await rig();
    await r.call('results_get_report', { execution: PERF });
    const paths = r.fake.calls
      .filter((call) => call.path.includes(`/executions/${PERF}`))
      .map((call) => `${call.method} ${call.path.replace(REPORT_PATH(PERF), '')}`)
      .sort();
    expect(paths).toEqual(['GET ', 'GET /endpoints', 'GET /errors', 'GET /result']);
    expect(r.fake.calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('declares itself read-only and names the verdicts it can give', async () => {
    const r = await rig();
    const tools = await r.session.listTools();
    const tool = tools.find((candidate) => candidate.name === 'results_get_report');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.description).toMatch(/SLA NOT JUDGED/u);
    expect(tool?.description).toMatch(/estimate/iu);
  });
});
