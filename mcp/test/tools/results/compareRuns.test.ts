// `results_compare_runs` (module results): one run against another or against the baseline
// pinned for its scenario and load, metric by metric, with an assessment only when the runs are
// comparable. `a` of the backend is the run compared with (earlier), `b` this run.

import { describe, expect, it } from 'vitest';

import { resultsCompareRuns } from '../../../src/tools/results/compareRuns.js';
import { seedComparison, type SeededComparison } from '../../fake-backend/routes/compare.js';
import { seedBaseline, type BaselineBody, type Seeded } from '../../fake-backend/routes/results.js';
import {
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepExecution,
} from '../../fake-backend/worlds/sklep.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import type { ToolRig } from '../../helpers/rig.js';
import {
  BASELINE_CONFLICT,
  BASELINE_ESTABLISHED,
  BASELINE_NOT_ESTABLISHED,
  BASELINE_SELF,
  BASELINE_UNMEASURED,
  COMPARE_NO_RESULT,
  COMPARE_NOT_COMPARABLE,
  COMPARE_SYNTHETIC,
  executionPath,
  OTHER,
  OTHER_HANDLE,
  PROJECT,
  RUN,
  RUN_HANDLE,
  STATE_WITH_RUN,
  STATE_WITHOUT_RUN,
} from './fixtures.js';
import {
  BOUND,
  CONTROL,
  dataOf,
  errorCode,
  readsOf,
  resultsRig,
  runCalls,
  STATE_PATH,
  stateFile,
  target,
} from './rig.js';

const TOOL = 'results_compare_runs';
const COMPARE = `/api/v1/projects/${PROJECT}/gatling/executions/compare`;

interface Metric {
  readonly key: string;
  readonly other: number | null;
  readonly run: number | null;
  readonly delta: number | null;
  readonly deltaPct: number | null;
  readonly judgement: 'better' | 'worse' | 'same' | null;
}

interface CompareData {
  readonly run: string;
  readonly run_id: string;
  readonly other: string;
  readonly other_id: string;
  readonly baseline: boolean;
  readonly comparable: boolean | null;
  readonly reasons: readonly string[];
  readonly metrics: readonly Metric[];
  readonly better: number;
  readonly worse: number;
  readonly errors?: {
    readonly onlyRun: readonly { readonly message: string; readonly count: number }[];
    readonly onlyOther: readonly { readonly message: string; readonly count: number }[];
    readonly common: readonly unknown[];
  };
}

interface Options {
  readonly comparison?: SeededComparison;
  readonly baseline?: Seeded<BaselineBody>;
  readonly state?: string;
  readonly locale?: 'en' | 'pl';
}

function rig(options: Options = {}): Promise<ToolRig> {
  return resultsRig({
    tools: [resultsCompareRuns],
    locale: options.locale ?? 'en',
    files: {
      'loadcraft/project.json': BOUND,
      ...(options.state === undefined ? {} : { [STATE_PATH]: options.state }),
    },
    seed: (fake) => {
      seedComparison(fake.store, OTHER, RUN, options.comparison ?? COMPARE_SYNTHETIC);
      if (options.baseline !== undefined) seedBaseline(fake.store, RUN, options.baseline);
    },
  });
}

/**
 * The environment a run's manifest names: the source of the environment of `run_list` and `run_get`
 * (the comparison itself names one only for a run saved with a configuration).
 */
function setManifestEnvironment(
  r: ToolRig,
  id: string,
  environment: { readonly id: string; readonly name: string } | null,
): void {
  const executions = r.fake.store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
  const run = executions.require(id);
  executions.delete(id);
  executions.insert({
    ...run,
    run_manifest: {
      ...run.run_manifest,
      target_environment_id: environment?.id ?? null,
      target_environment_name: environment?.name ?? null,
    } as SklepExecution['run_manifest'],
  });
}

const executionReads = (r: ToolRig) =>
  runCalls(r)
    .filter((call) => call.method === 'GET' && /\/executions\/[0-9a-f-]{36}$/u.test(call.path))
    .map((call) => call.path.slice(call.path.lastIndexOf('/') + 1));

const compareCalls = (r: ToolRig) => runCalls(r).filter((call) => call.path === COMPARE);
/** The requests of the comparison and of the baseline, in order. */
const reads = (r: ToolRig) =>
  runCalls(r)
    .filter((call) => call.path === COMPARE || call.path.endsWith('/baseline'))
    .map(target);

/** Runs of spaces made one: the widths of the columns are the business of `columns()`. */
const squeeze = (text: string): string => text.replace(/ {2,}/gu, ' ');

const VIEW = [
  'run e-3f9a12c4 against e-8c2d4f17',
  'comparable: the same load, target and build',
  'metric was now change',
  'p50 ms 150 148 -1.3% same',
  'p75 ms 210 220 +4.8% same',
  'p90 ms 320 300 -6.3% better',
  'p95 ms 410 380 -7.3% better',
  'p99 ms 780 — —',
  'mean ms 200 204 +2.0% same',
  'max ms 1,500 1,800 +20.0% worse',
  'KO req 100 50 -50.0% better',
  'req/s 20.0 21.5 +7.5% better',
  '— = no figure in the run report: p99 ms',
  '4 better, 1 worse; under 5% is the same',
  '→ console errors: include ["errors"]',
  '→ every metric: format "data"',
];

describe('results_compare_runs', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(resultsCompareRuns);
    expect(resultsCompareRuns.implemented).toBe(true);
  });

  it('compares the run with another, row by row, in one request', async () => {
    const r = await rig();
    const result = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text.split('\n').map(squeeze)).toEqual(VIEW);
    const rows = result.text.split('\n').slice(2, 12);
    for (const row of rows) expect(row.length, row).toBeLessThanOrEqual(40);
    expect(reads(r)).toEqual([`${COMPARE}?a=${OTHER}&b=${RUN}`]);
    expect(readsOf(r).map(([tool, , logged]) => [tool, logged])).toEqual([
      [TOOL, '4 better, 1 worse'],
    ]);
  });

  it('format data carries all twelve rows, in their order, with the assessment', async () => {
    const r = await rig();
    const data = dataOf<CompareData>(
      await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE, format: 'data' }),
    );
    expect(data).toMatchObject({
      run: RUN_HANDLE,
      run_id: RUN,
      other: OTHER_HANDLE,
      other_id: OTHER,
      baseline: false,
      comparable: true,
      better: 4,
      worse: 1,
    });
    expect(data.metrics.map((row) => [row.key, row.judgement])).toEqual([
      ['p50', 'same'],
      ['p75', 'same'],
      ['p90', 'better'],
      ['p95', 'better'],
      ['p99', null],
      ['mean_response_time', 'same'],
      ['max_response_time', 'worse'],
      ['min_response_time', null],
      ['ko_count', 'better'],
      ['ok_count', null],
      ['total_requests', null],
      ['requests_per_second', 'better'],
    ]);
    expect(data.metrics[11]).toMatchObject({ other: 20, run: 21.5, delta: 1.5 });
    expect(data.metrics[11]?.deltaPct).toBeCloseTo(7.5, 6);
    expect(data.metrics[4]).toMatchObject({ other: 780, run: null, delta: null, deltaPct: null });
  });

  it('against the baseline reads the baseline first, then compares it with the run', async () => {
    const r = await rig({ baseline: BASELINE_ESTABLISHED });
    const result = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: 'baseline' });
    expect(result.isError, result.text).toBe(false);
    expect(result.text.split('\n')[0]).toBe('run e-3f9a12c4 against its baseline e-8c2d4f17');
    expect(reads(r)).toEqual([executionPath(RUN, '/baseline'), `${COMPARE}?a=${OTHER}&b=${RUN}`]);
    const data = dataOf<CompareData>(
      await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: 'baseline', format: 'data' }),
    );
    expect(data.baseline).toBe(true);
  });

  it('with no arguments takes the run and the choice of the workspace', async () => {
    const r = await rig({ baseline: BASELINE_ESTABLISHED, state: stateFile(STATE_WITH_RUN) });
    const result = await r.call(TOOL, {});
    expect(result.isError, result.text).toBe(false);
    expect(result.text.split('\n')[0]).toBe('run e-3f9a12c4 against its baseline e-8c2d4f17');
    expect(reads(r)).toEqual([executionPath(RUN, '/baseline'), `${COMPARE}?a=${OTHER}&b=${RUN}`]);
  });

  it('without a run in the workspace asks for run_id before any request', async () => {
    const r = await rig({ state: stateFile(STATE_WITHOUT_RUN) });
    const result = await r.call(TOOL, { compare_to: OTHER_HANDLE });
    expect(errorCode(result)).toBe('missing_argument');
    expect(result.text).toContain('run_id');
    expect(runCalls(r)).toEqual([]);
  });

  it('a run in the state file outside the shape of a run is never sent', async () => {
    for (const run_id of ['../x', 'e-3F9A12C4']) {
      const r = await rig({
        state: stateFile({ ...STATE_WITH_RUN, ids: { project_id: PROJECT, run_id } }, false),
      });
      const result = await r.call(TOOL, { compare_to: OTHER });
      expect(result.isError, run_id).toBe(true);
      expect(result.text, run_id).not.toMatch(/^\[not_implemented\]/u);
      expect(runCalls(r).filter((call) => call.path.includes('..'))).toEqual([]);
      expect(compareCalls(r), run_id).toEqual([]);
    }
  });

  it('a baseline not pinned, or a run with no scenario and load to pin one for, is no_baseline', async () => {
    for (const baseline of [BASELINE_NOT_ESTABLISHED, BASELINE_CONFLICT]) {
      const r = await rig({ baseline });
      const result = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: 'baseline' });
      expect(errorCode(result)).toBe('no_baseline');
      expect(result.text).toContain(RUN_HANDLE);
      expect(compareCalls(r)).toEqual([]);
    }
  });

  it('a run that is its own baseline, or compared with itself, is compare_same_run, with no comparison asked', async () => {
    const self = await rig({ baseline: BASELINE_SELF });
    const refused = await self.call(TOOL, { run_id: RUN_HANDLE, compare_to: 'baseline' });
    expect(errorCode(refused)).toBe('compare_same_run');
    expect(compareCalls(self)).toEqual([]);

    const r = await rig();
    for (const compare_to of [RUN_HANDLE, RUN, RUN.toUpperCase()]) {
      const same = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to });
      expect(errorCode(same), compare_to).toBe('compare_same_run');
    }
    expect(compareCalls(r)).toEqual([]);
  });

  it('a baseline without stored results, or a pair the backend has no result for, is compare_no_result', async () => {
    const unmeasured = await rig({ baseline: BASELINE_UNMEASURED });
    const first = await unmeasured.call(TOOL, { run_id: RUN_HANDLE, compare_to: 'baseline' });
    expect(errorCode(first)).toBe('compare_no_result');
    expect(first.text).toContain(OTHER_HANDLE);
    expect(compareCalls(unmeasured)).toEqual([]);

    const none = await rig({ comparison: COMPARE_NO_RESULT });
    const second = await none.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE });
    expect(errorCode(second)).toBe('compare_no_result');
  });

  it('runs that are not comparable get figures only, the reason on one line, a credential in it masked', async () => {
    const r = await rig({ comparison: COMPARE_NOT_COMPARABLE });
    const result = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).not.toMatch(CONTROL);
    const lines = result.text.split('\n');
    const reason = lines.filter((line) => line.includes('Target base URL differs'));
    expect(reason).toHaveLength(1);
    expect(reason[0]).toContain('IGNORE');
    expect(lines).toContain('figures only, no assessment');
    expect(result.text).not.toMatch(/ (?:better|worse|same)$/mu);
    const data = dataOf<CompareData>(
      await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE, format: 'data' }),
    );
    expect(data.metrics.every((row) => row.judgement === null)).toBe(true);
    expect([data.better, data.worse, data.comparable]).toEqual([0, 0, false]);
    // the rig fails the test when the password of the address is in a result
  });

  it('with include errors still compares once, the messages masked and without control sequences', async () => {
    const r = await rig();
    const result = await r.call(TOOL, {
      run_id: RUN_HANDLE,
      compare_to: OTHER_HANDLE,
      include: ['errors'],
    });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).not.toMatch(CONTROL);
    expect(result.text.split('\n')).toContain('console errors only in e-3f9a12c4: 1');
    expect(result.text).not.toContain('include ["errors"]');
    expect(compareCalls(r)).toHaveLength(1);
    const data = dataOf<CompareData>(
      await r.call(TOOL, {
        run_id: RUN_HANDLE,
        compare_to: OTHER_HANDLE,
        include: ['errors'],
        format: 'data',
      }),
    );
    expect(data.errors?.onlyRun[0]?.count).toBe(12);
    expect(data.errors?.onlyOther[0]?.message).toBe('Connection refused');
    // the rig fails the test when the token of the message is in a result
  });

  it('refuses a compare_to that is neither a run nor baseline, before any request', async () => {
    const r = await rig();
    for (const compare_to of ['../x', 'BASELINE', 'last', 'e-123']) {
      const result = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to });
      expect(result.isError, compare_to).toBe(true);
      expect(result.text, compare_to).not.toMatch(/^\[not_implemented\]/u);
    }
    expect(runCalls(r)).toEqual([]);
  });

  it('the handle and the UUID of each run give the same view; an unknown handle is not_found', async () => {
    const r = await rig();
    const byHandle = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE });
    const byId = await r.call(TOOL, { run_id: RUN, compare_to: OTHER });
    expect(byHandle.isError, byHandle.text).toBe(false);
    expect(byId.text).toBe(byHandle.text);
    const unknown = await r.call(TOOL, { run_id: 'e-00000000', compare_to: OTHER_HANDLE });
    expect(errorCode(unknown)).toBe('not_found');
  });

  // DOKTOR-07 point 2: the comparison names no environment for a run saved with none, but the run's
  // manifest does (the source `run_list` and `run_get` use), so the view uses that.
  describe('the environment of the runs', () => {
    const PERF = { id: SKLEP_WORLD_IDS.environments.perf, name: 'perf' };
    const QA = { id: SKLEP_WORLD_IDS.environments.qa, name: 'qa' };

    interface EnvData {
      readonly sameEnvironment: boolean | null;
      readonly environments: {
        readonly other: string | null;
        readonly run: string | null;
      } | null;
    }

    it('names the environment both runs used when the comparison names none', async () => {
      const r = await rig({ comparison: LONGER });
      const result = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE });
      expect(result.isError, result.text).toBe(false);
      expect(result.text).toContain('environment: perf (both runs)');
      expect(result.text).not.toContain('environment: unknown');
      expect(executionReads(r).sort()).toEqual([OTHER, RUN].sort());
      const data = dataOf<EnvData>(
        await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE, format: 'data' }),
      );
      expect(data.sameEnvironment).toBe(true);
      expect(data.environments).toEqual({ other: 'perf', run: 'perf' });
    });

    it('names both environments when the runs used different ones', async () => {
      const r = await rig({ comparison: LONGER });
      setManifestEnvironment(r, OTHER, QA);
      setManifestEnvironment(r, RUN, PERF);
      const result = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE });
      expect(result.text).toContain(
        'the runs used different environments: qa (was) and perf (now)',
      );
      const data = dataOf<EnvData>(
        await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE, format: 'data' }),
      );
      expect(data.sameEnvironment).toBe(false);
      expect(data.environments).toEqual({ other: 'qa', run: 'perf' });
    });

    it('keeps the environment unknown when a run cannot be read', async () => {
      const r = await rig({ comparison: LONGER });
      r.fake.faults.next('GET', '/api/v1/projects/{project_id}/gatling/executions/{execution_id}', {
        status: 500,
        body: { detail: 'boom' },
      });
      const result = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE });
      expect(result.isError, result.text).toBe(false);
      expect(result.text).toContain('environment: unknown');
    });

    it('reads no run when the comparison names both environments', async () => {
      const r = await rig();
      const result = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE });
      expect(result.isError, result.text).toBe(false);
      expect(executionReads(r)).toEqual([]);
    });

    it('says it in Polish', async () => {
      const r = await rig({ comparison: LONGER, locale: 'pl' });
      const result = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE });
      expect(result.text).toContain('środowisko: perf (oba przebiegi)');
    });
  });

  it('answers in Polish with every key of the view', async () => {
    const r = await rig({ locale: 'pl' });
    const result = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).not.toMatch(/results_compare_runs\.[a-z]/u);
    expect(result.text).not.toContain('against e-8c2d4f17');
  });

  // DOKTOR M-RESULTS-01-FIX, points 4–7, on the shapes of a real backend (two runs of 11:25 and
  // 10:13 of the same load, the same request count, the backend sending no warning).
  const LONGER = {
    ...COMPARE_SYNTHETIC,
    environment_a_id: null,
    environment_b_id: null,
    metrics: {
      ...COMPARE_SYNTHETIC.metrics,
      total_requests: { a: 1200, b: 1200, delta: 0 },
      requests_per_second: { a: 1.95, b: 1.75, delta: -0.2 },
      p75: { a: null, b: null, delta: null },
    },
  };

  it.each([
    [
      'en',
      'note: the runs lasted differently',
      'throughput is not assessed: the runs lasted differently',
      'environment: unknown',
    ],
    [
      'pl',
      'uwaga: wykonania trwały różnie',
      'przepustowości nie oceniam: wykonania trwały różnie',
      'środowisko: nieznane',
    ],
  ] as const)(
    'runs of different durations: the note, req/s not assessed, the environment unknown (%s)',
    async (locale, note, rps, environment) => {
      const r = await rig({ comparison: LONGER, locale });
      setManifestEnvironment(r, RUN, null);
      setManifestEnvironment(r, OTHER, null);
      const result = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE });
      expect(result.isError, result.text).toBe(false);
      const text = squeeze(result.text);
      expect(text).toContain(note);
      expect(text).toContain(rps);
      expect(text).toContain(environment);
      expect(text).not.toMatch(/req\/s 2\.0 1\.8 -10\.3% (worse|gorzej)/u);
      const data = dataOf<
        CompareData & {
          readonly durationsS?: { readonly other: number; readonly run: number } | null;
          readonly sameEnvironment: boolean | null;
        }
      >(await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE, format: 'data' }));
      expect(data.metrics.find((row) => row.key === 'requests_per_second')?.judgement).toBeNull();
      expect(data.durationsS).toEqual({ other: 615.4, run: 685.7 });
      expect(data.sameEnvironment).toBeNull();
    },
  );

  it('p75 the run report does not measure says so, not a dash', async () => {
    const r = await rig({ comparison: LONGER });
    const result = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE });
    expect(squeeze(result.text)).toContain('p75 ms — — —');
    expect(result.text).toContain('— = no figure in the run report: p75 ms, p99 ms');
  });

  it('against the baseline it says where the baseline comes from, in the view and the data', async () => {
    const r = await rig({ baseline: BASELINE_ESTABLISHED });
    const result = await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: 'baseline' });
    expect(result.text).toContain(
      'the baseline is the reference run of this scenario and load: its first measured run, or one pinned with results_set_baseline or in the app (LoadCraft does not say which)',
    );
    const data = dataOf<CompareData & { readonly baselineSource?: string }>(
      await r.call(TOOL, { run_id: RUN_HANDLE, compare_to: 'baseline', format: 'data' }),
    );
    expect(data.baselineSource).toBe('reference_of_scenario_and_load');
  });

  it.each(['en', 'pl'] as const)(
    'a compare_to the project does not have is not_found naming that run (%s)',
    async (locale) => {
      const r = await rig({ locale });
      const result = await r.call(TOOL, {
        run_id: RUN_HANDLE,
        compare_to: '00000000-0000-4000-8000-000000000999',
      });
      expect(errorCode(result)).toBe('not_found');
      expect(result.text).toContain('e-00000000');
      if (locale === 'pl') expect(result.text).not.toMatch(/ or /u);
      expect(result.text).not.toContain(RUN_HANDLE);
    },
  );
});
