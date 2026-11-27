import { describe, expect, it, vi } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import { renderGetReport, type ReportData } from '../src/render/views/getReport.js';
import { resultsGetReport } from '../src/tools/resultsGetReport.js';
import { SKLEP_IDS } from './golden/index.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerResultRoutes } from './fake-backend/routes/results.js';
import type { Fake } from './fake-backend/server.js';
import type { StoredRecord } from './fake-backend/store.js';
import { seedSklep, SKLEP_COLLECTIONS, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { createTestClock } from './helpers/clock.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

vi.setConfig({ testTimeout: 120_000 });

const PERF = SKLEP_IDS.executionPerf;
const PROJECT = SKLEP_IDS.project;
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: PROJECT, name: 'sklep' },
  }),
};

type Loose = StoredRecord & Record<string, unknown>;

async function rig(options: {
  readonly capable: boolean;
  readonly locale?: 'en' | 'pl';
}): Promise<ToolRig> {
  return toolRig({
    tools: [resultsGetReport],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerResultRoutes(fake);
      seedSklep(fake.store, { stage: 'executed' });
    },
    fake: {
      meta: { capabilities: options.capable ? ['meta', 'peak_active_users'] : ['meta'] },
    },
    clock: createTestClock(Date.parse('2026-11-22T11:00:00Z')),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'pl' },
    files: BOUND,
  });
}

function patchResult(r: ToolRig, patch: Record<string, unknown>): void {
  r.fake.store.collection<Loose>(SKLEP_COLLECTIONS.results).update(PERF, patch);
}
function patchRun(r: ToolRig, patch: Record<string, unknown>): void {
  r.fake.store.collection<Loose>(SKLEP_COLLECTIONS.executions).update(PERF, patch);
}

/** The text with the lines the view wrapped under the value column joined again. */
const flat = (text: string): string[] => text.replace(/\n {15}/gu, ' ').split('\n');
const lineOf = (text: string, label: string): string =>
  flat(text).find((l) => l.startsWith(label)) ?? '';
/** The perf run of the world is a composition run; this makes it a run of one scenario. */
function singleScenario(r: ToolRig): void {
  patchRun(r, { scenario_id: SKLEP_WORLD_IDS.scenarios.zakupy, composite_id: null });
}

const runLine = (text: string): string => lineOf(text, 'przebieg');
const peakLine = (text: string): string => lineOf(text, 'szczyt');

describe('results_get_report: the measured peak of concurrent users', () => {
  it('puts the measured peak beside the planned load and keeps the planned load', async () => {
    const r = await rig({ capable: true });
    singleScenario(r);
    patchResult(r, { peak_active_users: 1870 });
    const { text, isError } = await r.call('results_get_report', { execution: PERF });
    expect(isError, text).toBe(false);
    expect(runLine(text)).toBe(
      'przebieg       10 min · planowane 0 → 2 000 jednocześnie · szczyt sesji użytkowników w locie naraz: 1 870',
    );
    expect(peakLine(text)).toBe('');
    r.assertClean();
  });

  it('says the peak is not available when the backend stored none, and shows no number', async () => {
    const r = await rig({ capable: true });
    singleScenario(r);
    patchResult(r, { peak_active_users: null });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(runLine(text)).toBe('przebieg       10 min · planowane 0 → 2 000 jednocześnie');
    expect(peakLine(text)).toBe(
      'szczyt         niedostępny: LoadCraft nie zmierzył go dla tego testu (starszy test)',
    );
  });

  it('treats a result without the field like a null and never draws 0', async () => {
    const r = await rig({ capable: true });
    singleScenario(r);
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(peakLine(text)).toContain('niedostępny');
    expect(text).not.toMatch(/naraz: 0/u);
  });

  it('says why for a composition run, even when the field carries a number', async () => {
    const r = await rig({ capable: true });
    patchResult(r, { peak_active_users: 900 });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(peakLine(text)).toBe(
      'szczyt         niedostępny: dla kompozycji LoadCraft nie liczy szczytu',
    );
    expect(text).not.toContain('szczyt sesji');
  });

  it('without the capability names the older backend and ignores a number in the result', async () => {
    const r = await rig({ capable: false });
    singleScenario(r);
    patchResult(r, { peak_active_users: 1870 });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(peakLine(text)).toBe(
      'szczyt         niedostępny: serwer jest starszy i nie mierzy szczytu',
    );
    expect(text).not.toContain('1 870');
    expect(runLine(text)).not.toContain('szczyt');
  });

  it('draws the peak in en', async () => {
    const r = await rig({ capable: true, locale: 'en' });
    singleScenario(r);
    patchResult(r, { peak_active_users: 1870 });
    const { text } = await r.call('results_get_report', { execution: PERF });
    expect(lineOf(text, 'run')).toContain(
      'planned 0 → 2,000 concurrent · peak user sessions in flight at once: 1,870',
    );
  });
});

describe('results_get_report view: the peak', () => {
  const base: ReportData = {
    verdict: { state: 'sla_passed', reasons: [] },
    run: { durationS: 600, planned: { type: 'ramp', vusers: 2000, ramp: 600 } },
    requests: {},
    errors: [],
    endpoints: [],
  };
  const draw = (peak: NonNullable<ReportData['run']['peak']>, locale: 'en' | 'pl'): string =>
    renderGetReport({ ...base, run: { ...base.run, peak } }, createTranslator(locale));

  it('says an open-model peak depends on the length of the user path (pl and en)', () => {
    expect(flat(draw({ users: 120 }, 'pl')).join('\n')).toContain(
      ' · szczyt sesji użytkowników w locie naraz: 120 (zależy też od długości ścieżki)',
    );
    expect(flat(draw({ users: 120 }, 'en')).join('\n')).toContain(
      'peak user sessions in flight at once: 120 (also depends on the length of the user path)',
    );
  });

  it('does not say it for a closed model', () => {
    const closed: ReportData = {
      ...base,
      run: {
        durationS: 600,
        planned: { type: 'constant_concurrency', vusers: 100, hold: 600 },
        peak: { users: 100 },
      },
    };
    expect(renderGetReport(closed, createTranslator('pl'))).not.toContain('ścieżki');
  });

  it.each([
    [
      'no_capability',
      'en',
      'peak           not available: the server is older and does not measure it',
    ],
    [
      'composition',
      'en',
      'peak           not available: LoadCraft does not count a peak for a composition',
    ],
    [
      'not_recorded',
      'en',
      'peak           not available: LoadCraft did not measure it for this test (an older test)',
    ],
    ['composition', 'pl', 'szczyt         niedostępny: dla kompozycji LoadCraft nie liczy szczytu'],
  ] as const)('draws the reason %s in %s', (unavailable, locale, line) => {
    expect(flat(draw({ unavailable }, locale)).join('\n')).toContain(line);
  });
});
