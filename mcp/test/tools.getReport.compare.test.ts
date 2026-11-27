import { describe, expect, it } from 'vitest';

import { buildComparison } from '../src/report/compare.js';
import { resultsGetReport } from '../src/tools/resultsGetReport.js';
import { SKLEP_IDS } from './golden/index.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerResultRoutes } from './fake-backend/routes/results.js';
import type { Fake } from './fake-backend/server.js';
import type { StoredRecord } from './fake-backend/store.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  type SklepExecution,
  type SklepExecutionResult,
} from './fake-backend/worlds/sklep.js';
import { createTestClock } from './helpers/clock.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

const NOW = Date.parse('2026-11-22T11:00:00Z');
const PERF = SKLEP_IDS.executionPerf;
const PROJECT = SKLEP_IDS.project;
/** The earlier run the tests compare with. */
const PREVIOUS = '5d0a7e31-92c4-4b68-8f1d-3a6c7e9b2d14';
const SCENARIO = 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607';
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: PROJECT, name: 'sklep' },
  }),
};

type Loose = StoredRecord & Record<string, unknown>;

async function rig(locale: 'en' | 'pl' = 'pl'): Promise<ToolRig> {
  return toolRig({
    tools: [resultsGetReport],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerResultRoutes(fake);
      seedSklep(fake.store, { stage: 'executed' });
    },
    clock: createTestClock(NOW),
    env: { LOADCRAFT_LOCALE: locale },
    files: BOUND,
  });
}

const runs = (r: ToolRig) => r.fake.store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
const resultRows = (r: ToolRig) =>
  r.fake.store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results);
const loose = (r: ToolRig, name: string) =>
  r.fake.store.collection<Loose>(
    name === 'runs' ? SKLEP_COLLECTIONS.executions : SKLEP_COLLECTIONS.results,
  );

/** The earlier run: the perf run again under another id, its result changed by `result`. */
function addPrevious(
  r: ToolRig,
  result: Record<string, unknown> = {},
  run: Record<string, unknown> = {},
): void {
  runs(r).insert({ ...runs(r).require(PERF), id: PREVIOUS });
  resultRows(r).insert({ ...resultRows(r).require(PERF), id: PREVIOUS });
  loose(r, 'results').update(PREVIOUS, result);
  loose(r, 'runs').update(PREVIOUS, run);
}

/** Both runs are of one scenario, not of the composition. */
function bothSingle(r: ToolRig): void {
  for (const id of [PERF, PREVIOUS]) {
    loose(r, 'runs').update(id, { scenario_id: SCENARIO, composite_id: null });
  }
}

/** The load of one run's manifest, replaced. */
function setWorkload(r: ToolRig, id: string, vusers: number): void {
  const manifest = runs(r).require(id).run_manifest;
  loose(r, 'runs').update(id, {
    run_manifest: {
      ...manifest,
      workload: { kind: 'adr005', value: { type: 'ramp_concurrency', vusers, ramp: 600 } },
    },
  });
}

const compare = (r: ToolRig) =>
  r.call('results_get_report', { execution: PERF, compare_to: PREVIOUS });

/** The comparison section: from its label to the end of the report body. */
function section(text: string): string {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => /^(porównanie|comparison) /u.test(line));
  expect(at, text).toBeGreaterThanOrEqual(0);
  return lines
    .slice(at)
    .filter((line) => !line.startsWith('↗ '))
    .join('\n')
    .replace(/\u202f/gu, ' ');
}

/** The sentences of the section with their wrapped lines joined again. */
const flat = (text: string): string => text.replace(/\n {15}/gu, ' ');

const compareLink = `↗ https://app.loadcraft.io/projects/${PROJECT}/gatling/executions/compare?compare=${PREVIOUS},${PERF}`;

describe('results_get_report compare_to: comparable runs', () => {
  it('draws was → now for p95, errors and throughput, and calls a 60% better p95 an improvement', async () => {
    const r = await rig();
    addPrevious(r, { p95: 2800 });
    bothSingle(r);
    const result = await compare(r);
    expect(result.isError, result.text).toBe(false);
    const text = section(result.text);
    expect(text).toContain('z e-5d0a7e31');
    expect(text).toMatch(/p95 +2 800 ms → 1 120 ms \(−60%\) +poprawa/u);
    expect(text).toMatch(/błędy +0,6% → 0,6% \(0%\) +bez istotnej zmiany/u);
    expect(text).toMatch(/żądania\/s +690 → 690 \(0%\) +bez istotnej zmiany/u);
    expect(text).not.toContain('nieporównywalne');
    expect(result.text.split('\n').at(-1)).toBe(compareLink);
  });

  it('says "no significant change" for a 2% move and never improvement or regression', async () => {
    const r = await rig();
    addPrevious(r, { p95: 1143 });
    bothSingle(r);
    const text = section((await compare(r)).text);
    expect(text).toMatch(/p95 +1 143 ms → 1 120 ms \(−2%\) +bez istotnej zmiany/u);
    expect(text).not.toMatch(/poprawa|regresja/u);
  });

  it.each([
    [1050, 'regresja', 'exactly 5% is a change'],
    [1049, 'bez istotnej zmiany', 'just under 5% is noise'],
  ])('p95 %i against 1000 reads as %s (%s)', async (p95, word) => {
    const r = await rig();
    addPrevious(r, { p95: 1000 });
    loose(r, 'results').update(PERF, { p95 });
    bothSingle(r);
    const text = section((await compare(r)).text);
    expect(text).toMatch(new RegExp(`p95 .*${word}`, 'u'));
  });

  it('calls a worse p95 a regression and a worse error rate too, but throughput only a change', async () => {
    const r = await rig();
    addPrevious(r, { p95: 600, ko_count: 0, requests_per_second: 900 });
    bothSingle(r);
    const text = section((await compare(r)).text);
    expect(text).toMatch(/p95 +600 ms → 1 120 ms \(\+87%\) +regresja/u);
    expect(text).toMatch(/błędy +0% → 0,6% +regresja/u);
    expect(text).toMatch(/żądania\/s +900 → 690 \(−23%\) +zmiana/u);
  });

  it('takes 0.05 points of error rate for noise although it is 9% relatively', async () => {
    const r = await rig();
    // 0.6016% now; 0.5% before is +20% relative but 0.10 points: a change; 0.55% before is noise.
    addPrevious(r, { ko_count: 2268 });
    bothSingle(r);
    expect(section((await compare(r)).text)).toMatch(/błędy .*bez istotnej zmiany/u);
  });

  it('says it in English with the same figures', async () => {
    const r = await rig('en');
    addPrevious(r, { p95: 2800 });
    bothSingle(r);
    const text = section((await compare(r)).text);
    expect(text).toContain('with e-5d0a7e31');
    expect(text).toMatch(/p95 +2,800 ms → 1,120 ms \(−60%\) +improvement/u);
    expect(text).toContain('a change under 5% is noise');
  });

  it('says what it cannot know before the figures when the backend has no evidence of the load', async () => {
    const r = await rig();
    addPrevious(r, { p95: 2800 });
    bothSingle(r);
    for (const id of [PERF, PREVIOUS]) {
      const manifest = runs(r).require(id).run_manifest;
      loose(r, 'runs').update(id, { run_manifest: { ...manifest, workload: null } });
    }
    const text = flat(section((await compare(r)).text));
    expect(text).toContain('nie wiadomo, czy warunki były te same');
    expect(text.indexOf('nie wiadomo')).toBeLessThan(text.indexOf('2 800 ms'));
  });

  it('names a run the environment limited before the figures', async () => {
    const r = await rig();
    addPrevious(r, { p95: 2800 });
    bothSingle(r);
    loose(r, 'runs').update(PREVIOUS, {
      warnings: ['Workload clamped to environment caps: vusers 2000 → 100'],
    });
    const text = flat(section((await compare(r)).text));
    expect(text).toContain('poprzednie wykonanie ograniczył limit środowiska (100 z 2 000)');
    expect(text.indexOf('ograniczył')).toBeLessThan(text.indexOf('2 800 ms'));
  });
});

describe('results_get_report compare_to: what the figures rest on', () => {
  it('shows ≈ and no assessment when the two p95 come from different estimators', async () => {
    const r = await rig();
    addPrevious(r, { p95: 2800, percentile_source: 'histogram' });
    bothSingle(r);
    const text = flat(section((await compare(r)).text));
    expect(text).toMatch(/p95 +≈2 800 ms → ≈1 120 ms \(−60%\) +zmiana/u);
    expect(text).toContain('różnych (lub nieznanych) estymatorów');
    expect(text).not.toMatch(/poprawa|regresja/u);
  });

  it('does the same when the source of one p95 is unknown', async () => {
    const r = await rig();
    addPrevious(r, { p95: 2800, percentile_source: 'not-measured' });
    bothSingle(r);
    const text = section((await compare(r)).text);
    expect(text).toContain('≈2 800 ms');
    expect(text).not.toMatch(/poprawa|regresja/u);
  });

  it('tells runs of different length before the figures', async () => {
    const r = await rig();
    addPrevious(r, { p95: 2800 }, { duration_seconds: 300 });
    bothSingle(r);
    const text = flat(section((await compare(r)).text));
    expect(text).toContain('wykonania trwały różnie (5 min i 10 min)');
    expect(text.indexOf('trwały różnie')).toBeLessThan(text.indexOf('2 800 ms'));
  });

  it('is silent about length within 10%', async () => {
    const r = await rig();
    addPrevious(r, { p95: 2800 }, { duration_seconds: 560 });
    bothSingle(r);
    expect(section((await compare(r)).text)).not.toContain('trwały różnie');
  });

  it('leaves the profile to the backend when one run has no manifest load', async () => {
    const r = await rig();
    addPrevious(r, { p95: 2800 });
    bothSingle(r);
    const manifest = runs(r).require(PREVIOUS).run_manifest;
    loose(r, 'runs').update(PREVIOUS, { run_manifest: { ...manifest, workload: null } });
    const text = section((await compare(r)).text);
    expect(text).toContain('nie wiadomo, czy warunki były te same');
    expect(text).toMatch(/p95 +2 800 ms → 1 120 ms/u);
  });
});

describe('results_get_report compare_to: runs that are not comparable', () => {
  it('names a different load with both, and draws no figures', async () => {
    const r = await rig();
    addPrevious(r, { p95: 2800 });
    bothSingle(r);
    setWorkload(r, PREVIOUS, 500);
    const result = await compare(r);
    expect(result.isError, result.text).toBe(false);
    const text = flat(section(result.text));
    expect(text).toContain('nieporównywalne z e-5d0a7e31: inny profil (było');
    expect(text).toContain('500');
    expect(text).toContain('2 000');
    expect(text).toContain('liczb nie zestawiam');
    expect(text).not.toMatch(/→ 1 120|2 800 ms/u);
    expect(text).not.toMatch(/poprawa|regresja/u);
    expect(result.text.split('\n').at(-1)).toBe(compareLink);
  });

  it('names a different environment', async () => {
    const r = await rig();
    addPrevious(r, { p95: 2800 });
    bothSingle(r);
    const manifest = runs(r).require(PREVIOUS).run_manifest;
    loose(r, 'runs').update(PREVIOUS, {
      run_manifest: { ...manifest, target_environment_id: '0e9d8c7b-6a5f-4e3d-8c2b-1a0f9e8d7c6b' },
    });
    const text = section((await compare(r)).text);
    expect(text).toContain('inne środowisko');
    expect(text).not.toContain('2 800 ms');
  });

  it('carries a difference of target or build in the backend’s words, cleaned', async () => {
    const r = await rig();
    addPrevious(r, { p95: 2800 });
    bothSingle(r);
    const manifest = runs(r).require(PREVIOUS).run_manifest;
    loose(r, 'runs').update(PREVIOUS, {
      run_manifest: { ...manifest, target_base_url: 'https://stage.example.test\u001b[31m' },
    });
    const text = section((await compare(r)).text);
    expect(text).toContain('target_base_url differs');
    expect(text).not.toContain('\u001b');
    expect(text).not.toContain('2 800 ms');
  });

  it('names a different scenario or composition', async () => {
    const r = await rig();
    addPrevious(r, { p95: 2800 });
    loose(r, 'runs').update(PREVIOUS, { scenario_id: SCENARIO, composite_id: null });
    const text = flat(section((await compare(r)).text));
    expect(text).toContain('inny scenariusz albo inna kompozycja');
    expect(text).not.toContain('2 800 ms');
  });

  it('names several reasons together, in one sentence before the refusal of figures', async () => {
    const r = await rig();
    addPrevious(r, { p95: 2800 });
    bothSingle(r);
    setWorkload(r, PREVIOUS, 500);
    loose(r, 'runs').update(PREVIOUS, { status: 'cancelled' });
    const text = flat(section((await compare(r)).text));
    expect(text).toContain('poprzednie wykonanie anulowano');
    expect(text).toContain('inny profil');
    expect(text.indexOf('nieporównywalne')).toBeLessThan(text.indexOf('liczb nie zestawiam'));
  });
});

describe('results_get_report compare_to: compositions', () => {
  it('draws the figures of two composition runs without any assessment', async () => {
    const r = await rig();
    addPrevious(r, { p95: 2800 });
    const text = section((await compare(r)).text);
    expect(text).toMatch(/p95 +2 800 ms → 1 120 ms \(−60%\)/u);
    expect(text).toContain('kompozycja: liczby i ich zmiana, bez oceny zmiany');
    expect(text).not.toMatch(/poprawa|regresja/u);
  });

  it('still says "no significant change" for a composition inside the noise', async () => {
    const r = await rig();
    addPrevious(r, { p95: 1130 });
    expect(section((await compare(r)).text)).toMatch(/p95 .*bez istotnej zmiany/u);
  });
});

describe('results_get_report compare_to: refusals', () => {
  it('names an unknown handle', async () => {
    const r = await rig();
    const result = await r.call('results_get_report', {
      execution: PERF,
      compare_to: 'e-deadbeef',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft nie zna tej pozycji');
  });

  it('names an unknown full id the same way', async () => {
    const r = await rig();
    const result = await compare(r);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft nie zna tej pozycji');
  });

  it('refuses to compare a run with itself', async () => {
    const r = await rig();
    const result = await r.call('results_get_report', { execution: PERF, compare_to: PERF });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('compare_to wskazuje ten sam test');
  });

  it('points to wait when the earlier run is still going', async () => {
    const r = await rig();
    addPrevious(r, {}, { status: 'running' });
    const result = await compare(r);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('jeszcze trwa');
    expect(result.text).toContain(`test_run:${PREVIOUS}`);
  });

  it('says the earlier run left no result', async () => {
    const r = await rig();
    addPrevious(r);
    r.fake.store.collection(SKLEP_COLLECTIONS.results).delete(PREVIOUS);
    const result = await compare(r);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('nie ma wyniku');
  });

  it('adds no comparison and calls no comparison route when compare_to is not given', async () => {
    const r = await rig();
    const result = await r.call('results_get_report', { execution: PERF });
    expect(result.text).not.toContain('porównanie');
    expect(r.fake.calls.filter((call) => call.path.endsWith('/compare'))).toHaveLength(0);
  });
});

describe('buildComparison (the rule, without the tool)', () => {
  const side = {
    planned: { type: 'ramp_concurrency', vusers: 100, ramp: 600 } as const,
    scenarioId: 's',
    compositionId: null,
    state: 'sla_passed',
    durationS: 600,
    percentileSource: 'gatling-report',
  };
  const metric = (was: number | null, is: number | null) => ({ was, is });
  const comparison = {
    environments: { was: 'e', is: 'e' },
    sameWorkload: true,
    comparable: true,
    reasons: [],
    warnings: [],
    totalRequests: metric(1000, 1000),
    failedRequests: metric(10, 10),
    p95: metric(null, 300),
    requestsPerSecond: metric(10, 10),
  } as const;

  it('marks a figure missing on one side as unknown, never as a change', () => {
    const data = buildComparison({ previous: 'e-1', was: side, is: side, comparison });
    expect(data.rows?.[0]?.verdict).toBe('unknown');
  });

  it('is not comparable when the backend says so without naming why', () => {
    const data = buildComparison({
      previous: 'e-1',
      was: side,
      is: side,
      comparison: { ...comparison, comparable: false },
    });
    expect(data.state).toBe('not_comparable');
    expect(data.differences).toEqual([{ kind: 'unspecified' }]);
    expect(data.rows).toBeUndefined();
  });
});
