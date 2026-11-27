import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { listDatasets, type DataApiContext } from '../src/api/data.js';
import { createLogger } from '../src/log.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { renderDataPlan, type DataPlanView } from '../src/render/views/data.js';
import { dataCheckReadiness } from '../src/tools/dataCheckReadiness.js';
import { CallSecretScope } from '../src/workspace/secrets.js';
import { SKLEP_IDS, goldenText } from './golden/index.js';
import {
  DATA_SENTINEL,
  FAKE_SLOT_STATUS,
  type ForcedSlotStatus,
  registerDataRoutes,
  seedAutoDatasets,
} from './fake-backend/routes/data.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import type { Fake } from './fake-backend/server.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepFeeder,
  type SklepStage,
} from './fake-backend/worlds/sklep.js';
import { isCatalogDataFile } from './helpers/catalogDataFiles.js';
import { createTestClock } from './helpers/clock.js';
import { dataCheck } from './helpers/dataWorlds.js';
import { CANARY, toolRig, type ToolRig } from './helpers/rig.js';

const NOW = Date.parse('2026-11-22T10:30:00Z');
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

function world(stage: SklepStage) {
  return (fake: Fake): void => {
    registerLookupRoutes(fake);
    registerDataRoutes(fake);
    seedSklep(fake.store, { stage });
    seedAutoDatasets(fake.store);
  };
}

async function rig(stage: SklepStage, locale: 'en' | 'pl' = 'en'): Promise<ToolRig> {
  return toolRig({
    tools: [dataCheckReadiness],
    world: world(stage),
    clock: createTestClock(NOW),
    env: { LOADCRAFT_LOCALE: locale },
    files: BOUND,
  });
}

async function plan(
  r: ToolRig,
  args: Record<string, unknown> = { scenario: 'checkout' },
): Promise<{ text: string; data: DataPlanView }> {
  const result = await r.call('data_check_readiness', args);
  if (result.isError) throw new Error(`data_check_readiness failed: ${result.text}`);
  const structured = result.outcome as { status: string; data: DataPlanView };
  expect(structured.status).toBe('done');
  return { text: result.text, data: structured.data };
}

const calls = (r: ToolRig): string[] =>
  r.fake.calls.map((call) => `${call.method} ${call.path.replace(SKLEP_IDS.project, ':p')}`);

describe('data_check_readiness', () => {
  it('shows the composition of the scenario world as the golden plan', async () => {
    const r = await rig('scenario', 'pl');
    const { text, data } = await plan(r);
    expect(text).toBe(goldenText('run1', '07-data_check_readiness-plan').replace(/\n$/u, ''));
    expect(data.ready).toBe(false);
    expect(data.slots.map((slot) => [slot.label, slot.state])).toEqual([
      ['Search terms', 'auto'],
      ['Quantity & cardnumber', 'auto'],
      ['User accounts', 'missing'],
    ]);
    expect(data.fixes).toEqual([
      {
        kind: 'accounts_must_exist',
        slot: 'accounts',
        label: 'User accounts',
        environment: 'perf',
      },
    ]);
    // Without the data hub nothing names the accounts' dataset: the fix names the slot's label.
    expect(data.proposed).toEqual([]);
    expect(data.steps).toEqual([]);
    r.assertClean();
  });

  it('names the chosen environment in the fix and shows the golden plan for qa', async () => {
    const r = await rig('scenario', 'pl');
    const { text, data } = await plan(r, { scenario: 'checkout', environment: 'qa' });
    expect(text).toBe(goldenText('run5', '08-data_check_readiness-plan-qa').replace(/\n$/u, ''));
    expect(data.environment).toBe('qa');
  });

  it('is ready when every slot is pinned, without asking the data hub', async () => {
    const r = await rig('data', 'pl');
    const { text, data } = await plan(r);
    expect(data.ready).toBe(true);
    expect(data.slots.every((slot) => slot.state === 'bound')).toBe(true);
    expect(data.fixes).toEqual([]);
    expect(text.split('\n').slice(-2).join('\n')).toBe(
      'każdy slot przypięty i wypełniony · czy wierszy starczy na profil, sprawdza\n  run_plan z profilem',
    );
    expect(calls(r)).not.toContain('POST /api/v1/projects/:p/data-hub/auto-plan');
  });

  it('is not ready for a column mismatch even when the backend says all clear', async () => {
    const r = await rig('data', 'pl');
    r.fake.store
      .collection<ForcedSlotStatus>(FAKE_SLOT_STATUS)
      .insert({ id: 'order_details', status: 'column_mismatch' });
    const { text, data } = await plan(r);
    expect(data.ready).toBe(false);
    expect(data.fixes).toEqual([
      { kind: 'column_mismatch', slot: 'order_details', label: 'Quantity & cardnumber' },
    ]);
    expect(text).toContain('złe kolumny');
    expect(text).not.toContain('test może ruszyć');
  });

  it('sends a plain data slot without a dataset to data_create_dataset with its exact call, not to the accounts', async () => {
    const r = await rig('data', 'en');
    r.fake.store
      .collection<ForcedSlotStatus>(FAKE_SLOT_STATUS)
      .insert({ id: 'order_details', status: 'missing' });
    const { text, data } = await plan(r);
    expect(data.ready).toBe(false);
    expect(data.fixes).toEqual([
      { kind: 'data_generate', slot: 'order_details', label: 'Quantity & cardnumber' },
    ]);
    expect(data.steps).toEqual([
      { tool: 'data_create_dataset', args: { scenario: 'checkout', slot: 'order_details' } },
    ]);
    expect(text).toContain('data_create_dataset makes its rows');
    expect(text).toContain('1. data_create_dataset scenario: "checkout", slot: "order_details"');
    expect(text).not.toContain('data_create_accounts');
    const pl = await rig('data', 'pl');
    pl.fake.store
      .collection<ForcedSlotStatus>(FAKE_SLOT_STATUS)
      .insert({ id: 'order_details', status: 'missing' });
    expect((await plan(pl)).text).toContain('data_create_dataset zrobi wiersze');
  });

  it.each([
    ['stale_pin', 'nieaktualne wiązanie'],
    ['empty_column', 'pusta kolumna'],
    ['parse_error', 'błąd pliku'],
  ] as const)('blocks a slot that is %s', async (status, label) => {
    const r = await rig('data', 'pl');
    r.fake.store
      .collection<ForcedSlotStatus>(FAKE_SLOT_STATUS)
      .insert({ id: 'search_phrases', status });
    const { text, data } = await plan(r, { scenario: 'zakupy' });
    expect(data.ready).toBe(false);
    expect(text).toContain(label);
  });

  it('does not block on too few rows: run_start weighs the rows', async () => {
    const r = await rig('data', 'pl');
    r.fake.store
      .collection<ForcedSlotStatus>(FAKE_SLOT_STATUS)
      .insert({ id: 'accounts', status: 'short_rows' });
    const { text, data } = await plan(r);
    expect(data.ready).toBe(true);
    expect(text).toContain('za mało wierszy');
  });

  it('plans a single scenario with the scenario pre-flight', async () => {
    const r = await rig('scenario');
    const { data } = await plan(r, { scenario: 'konto' });
    expect(data.target).toEqual({ kind: 'scenario', name: 'konto' });
    expect(data.slots.map((slot) => slot.state)).toEqual(['missing']);
    expect(data.slots[0]?.usedBy).toEqual([]);
    expect(calls(r)).toContain('POST /api/v1/projects/:p/gatling/executions/preflight');
    expect(calls(r).some((call) => call.endsWith('/feeders/preflight'))).toBe(false);
  });

  it('shows a scenario without slots as ready', async () => {
    const r = await rig('scenario', 'pl');
    const { text, data } = await plan(r, { scenario: 'przeglądanie' });
    expect(data.slots).toEqual([]);
    expect(data.ready).toBe(true);
    expect(text).toBe(
      'plan danych · brak slotów\nscenariusz nie potrzebuje danych testowych · test może ruszyć',
    );
  });

  it('turns a refusal of the whole composition into a named error', async () => {
    const r = await rig('scenario');
    r.fake.faults.next(
      'POST',
      `/api/v1/projects/${SKLEP_IDS.project}/gatling/compositions/${SKLEP_WORLD_IDS.composition}/feeders/preflight`,
      {
        status: 200,
        body: {
          ready: false,
          checks: [],
          refused: { message: 'Two members read one slot differently.', slots: [] },
        },
      },
    );
    const result = await r.call('data_check_readiness', { scenario: 'checkout' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Two members read one slot differently.');
    expect(result.text).toContain('→');
  });

  it('answers a backend error with its hint', async () => {
    const r = await rig('scenario');
    r.fake.faults.next(
      'POST',
      `/api/v1/projects/${SKLEP_IDS.project}/gatling/compositions/${SKLEP_WORLD_IDS.composition}/feeders/preflight`,
      { status: 404, body: { detail: 'Composition not found in this project.' } },
    );
    const result = await r.call('data_check_readiness', { scenario: 'checkout' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('→');
    r.assertClean();
  });

  it('turns 401 into the invalid-token error', async () => {
    const r = await rig('scenario');
    r.fake.faults.next('GET', '/api/v1/auth/me', {
      status: 401,
      body: { detail: 'Invalid token' },
    });
    r.fake.faults.next('GET', '/api/v1/meta', { status: 401, body: { detail: 'Invalid token' } });
    const result = await r.call('data_check_readiness', { scenario: 'checkout' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('did not accept the API token');
  });

  it('refuses a backend without /meta as too old', async () => {
    const r = await rig('scenario');
    r.fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
    const result = await r.call('data_check_readiness', { scenario: 'checkout' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('older than the plugin supports');
  });

  it('takes no action: the arguments of the single data call are refused', async () => {
    const r = await rig('scenario');
    const result = await r.call('data_check_readiness', { scenario: 'checkout', apply: true });
    expect(result.isError).toBe(true);
    expect(r.fake.calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('writes datasets_ready into the process: false while a slot blocks, true when all are filled', async () => {
    const missing = await rig('scenario');
    await plan(missing);
    expect(dataCheck(missing.workspace, SKLEP_IDS.project, 'datasets_ready')).toMatchObject({
      ok: false,
    });
    const ready = await rig('data');
    await plan(ready);
    expect(dataCheck(ready.workspace, SKLEP_IDS.project, 'datasets_ready')).toMatchObject({
      ok: true,
    });
  });

  it('never asks the data hub, even when a slot is missing', async () => {
    const r = await rig('scenario');
    const { data } = await plan(r);
    expect(data.ready).toBe(false);
    expect(calls(r)).not.toContain('POST /api/v1/projects/:p/data-hub/auto-plan');
  });

  describe('dataset content', () => {
    const content = `email,password\nuser-1@example.com,"${DATA_SENTINEL},with ""quote"""\n`;

    function leak(r: ToolRig): void {
      const feeders = r.fake.store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
      feeders.update(SKLEP_WORLD_IDS.feeders.konta, {
        content,
        audit_metadata: {
          sample_rows_preview: [{ email: 'a@example.com', password: DATA_SENTINEL }],
        },
      } as unknown as Partial<SklepFeeder>);
    }

    it('never reaches the result, the log or the state, whatever the backend sends', async () => {
      const r = await rig('data');
      leak(r);
      const { text } = await plan(r);
      const everything = JSON.stringify(r.results) + r.lines.join('\n') + text;
      expect(everything).not.toContain(DATA_SENTINEL);
      expect(everything).not.toContain('sample_rows_preview');
      r.assertClean();
    });

    it('is dropped by the one reader of datasets, which registers the secrets it saw', async () => {
      const body = {
        feeders: [
          {
            id: 'd1',
            name: 'konta',
            columns: ['email', 'password'],
            record_count: 2,
            consumption: 'exclusive',
            separator: ',',
            column_semantics: { email: 'identity', password: 'credential' },
            recipe_summary: [],
            auto_linked_scenario_id: null,
            provenance: 'uploaded',
            content,
            audit_metadata: {
              sample_rows_preview: [{ email: 'a@example.com', password: 'pw-from-preview' }],
            },
          },
        ],
        total: 1,
      };
      const secrets = new CallSecretScope(createLogger({ level: 'debug', sink: () => undefined }));
      const api = {
        signal: new AbortController().signal,
        secrets,
        // The answer of the one call the reader sends (`callOperation` goes through `request`).
        services: { http: { request: () => Promise.resolve({ data: body }) } },
      } as unknown as DataApiContext;
      const datasets = await listDatasets(api, SKLEP_IDS.project);
      expect(datasets).toEqual([
        {
          id: 'd1',
          name: 'konta',
          columns: ['email', 'password'],
          rows: 2,
          exclusive: true,
          generators: [],
          autoLinkedScenarioId: null,
        },
      ]);
      expect(JSON.stringify(datasets)).not.toContain(DATA_SENTINEL);
      expect(
        secrets.scrub(`x ${DATA_SENTINEL},with "quote" y pw-from-preview z user-1@example.com`),
      ).toBe('x [redacted] y [redacted] z user-1@example.com');
    });
  });

  it('calls the dataset routes only from api/data.ts', () => {
    const root = fileURLToPath(new URL('../src', import.meta.url));
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? sources(join(dir, entry.name))
          : entry.name.endsWith('.ts') && !dir.includes('generated')
            ? [join(dir, entry.name)]
            : [],
      );
    const offenders = sources(root)
      .filter((file) => !isCatalogDataFile(relative(root, file)))
      .filter((file) =>
        /\/api\/v1\/[^'"`]*(?:feeders|data-hub|generate-feeder|slot-bindings)/u.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(root, file))
      .filter((file) => file !== join('api', 'data.ts'));
    expect(offenders).toEqual([]);
  });

  it('keeps the canary out of everything', async () => {
    const r = await rig('scenario');
    await plan(r);
    expect(JSON.stringify(r.results)).not.toContain(CANARY);
    r.assertClean();
  });

  describe('views', () => {
    it.each(['en', 'pl'] as const)('scenario world (%s)', async (locale) => {
      const r = await rig('scenario', locale);
      const { text } = await plan(r);
      await expect(text).toMatchFileSnapshot(
        `__snapshots__/dataCheckReadiness.scenario.${locale}.txt`,
      );
    });

    it.each(['en', 'pl'] as const)('data world (%s)', async (locale) => {
      const r = await rig('data', locale);
      const { text } = await plan(r);
      await expect(text).toMatchFileSnapshot(`__snapshots__/dataCheckReadiness.data.${locale}.txt`);
    });
  });
});

describe('data_check_readiness view against the golden plans', () => {
  it.each([
    ['run1', '07-data_check_readiness-plan'],
    ['run5', '08-data_check_readiness-plan-qa'],
  ] as const)('%s/%s renders from its view.json', (run, name) => {
    const data = JSON.parse(
      readFileSync(new URL(`./golden/${run}/${name}.view.json`, import.meta.url), 'utf8'),
    ) as DataPlanView;
    const text = renderDataPlan(data, createTranslator('pl'));
    expect(text).toBe(goldenText(run, name).replace(/\n$/u, ''));
  });
});
