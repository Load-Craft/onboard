// The views of the project setup tools on the fake backend and against the golden texts: the map of
// the documentation (title, operations, areas) and the conformance of the default environment in
// `project_apply_setup`, the connection lines of `project_check_env`, the fields a person should
// look at, the differences from the request in `project_save_env`, and every view of step 01.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import {
  renderAnalyzeSetup,
  renderApplySetup,
  renderCheckEnv,
  renderProjectCreate,
  renderSaveEnv,
  type AnalyzeSetupData,
  type ApplySetupData,
  type CheckEnvData,
  type ProjectCreateData,
  type SaveEnvData,
} from '../src/render/views/projectSetup.js';
import { goldenText, SKLEP_IDS } from './golden/index.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
} from './fake-backend/routes/documentation.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import { registerSetupRoutes } from './fake-backend/routes/setup.js';
import { registerOpenapiReadRoute } from './fake-backend/routes/suggestions.js';
import type { Fake, FakeCall } from './fake-backend/server.js';
import { seedSklep, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import {
  SETUP_TOOLS,
  setUpProject,
  type SetupArgs,
  type SetupCalls,
} from './helpers/projectSetup.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

const ENVIRONMENTS = [
  { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com', default: true },
  { name: 'qa', api: 'api.qa.example.com', frontend: 'qa.example.com', limit: [100, 20] },
  { name: 'dev', api: 'api.dev.example.com', frontend: 'dev.example.com' },
  { name: 'prod', api: 'api.example.com', frontend: 'example.com', limit: [20, 5] },
];

const DOCS_ARGS: SetupArgs = {
  name: 'sklep',
  openapi: 'loadcraft/openapi.json',
  environments: ENVIRONMENTS,
};

const CONFORMANCE = '/api/v1/projects/{project_id}/environments/{environment_id}/conformance';
const API_MAP = '/api/v1/projects/{project_id}/api-map';
const TEST_CONNECTION =
  '/api/v1/projects/{project_id}/environments/{environment_id}/test-connection';

const DOCUMENT = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Sklep API', version: '2.14.0', 'x-loadcraft-source': { commit: 'a41f9c2' } },
  paths: { '/items': { get: { operationId: 'listItems' } } },
});

function world(stage: 'empty' | 'project') {
  return (fake: Fake): void => {
    registerLookupRoutes(fake);
    registerProjectRoutes(fake);
    registerSetupRoutes(fake);
    registerOpenapiReadRoute(fake);
    registerApiMapRoute(fake);
    registerConformanceRoute(fake);
    seedSklep(fake.store, { stage });
  };
}

async function rig(stage: 'empty' | 'project', locale: 'en' | 'pl' = 'pl'): Promise<ToolRig> {
  return toolRig({
    tools: SETUP_TOOLS,
    world: world(stage),
    env: { LOADCRAFT_LOCALE: locale },
    files: { 'loadcraft/openapi.json': DOCUMENT },
  });
}

/** The whole setup; every call must succeed. */
async function run(r: ToolRig, args: SetupArgs = DOCS_ARGS): Promise<SetupCalls> {
  const calls = await setUpProject(r, args);
  const failed = [calls.create, calls.saveEnv, calls.checkEnv, calls.analyze, calls.apply].find(
    (call) => call?.isError === true,
  );
  if (failed !== undefined) throw new Error(`the setup failed: ${failed.text}`);
  return calls;
}

/** The text of `project_check_env` after the whole setup. */
async function probed(r: ToolRig, args: SetupArgs = DOCS_ARGS): Promise<string> {
  return (await run(r, args)).checkEnv?.text ?? '';
}

/** The text of `project_apply_setup` after the whole setup. */
async function applied(r: ToolRig, args: SetupArgs = DOCS_ARGS): Promise<string> {
  return (await run(r, args)).apply?.text ?? '';
}

/** Long lines are wrapped under their first words; this puts a wrapped line back together. */
const unwrapped = (text: string): string => text.replace(/\n {2,}(?=\S)/gu, ' ');

const lineWith = (text: string, start: string): string | undefined =>
  text.split('\n').find((line) => line.startsWith(start));

const callsTo = (r: ToolRig, method: string, suffix: string): FakeCall[] =>
  r.fake.calls.filter((call) => call.method === method && call.path.endsWith(suffix));

function goldenView<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(`./golden/${path}`, import.meta.url), 'utf8')) as T;
}

describe('project_apply_setup: documentation and conformance', () => {
  it('shows the title, operations and areas of the API map in the header', async () => {
    const r = await rig('project');
    const calls = await run(r);
    expect(calls.create.text).toBe('Projekt „sklep” · istniejący');
    expect(calls.apply?.text.split('\n')[0]).toBe(
      'Projekt „sklep” · Sklep API · 42 operacje · 6 obszarów',
    );
    expect(callsTo(r, 'GET', '/api-map')).toHaveLength(1);
  });

  it('of a project that has documentation, leaves the conformance to project_check_env', async () => {
    const r = await rig('project');
    const calls = await run(r);
    expect(lineWith(calls.apply?.text ?? '', 'perf ★')).toBeUndefined();
    expect(callsTo(r, 'POST', '/conformance')).toHaveLength(1);
  });
});

describe('project_check_env: conformance against the documentation the project has', () => {
  it('checks the conformance of the default environment only and prints it on its line', async () => {
    const r = await rig('project');
    const text = await probed(r);
    expect(lineWith(text, 'perf ★')).toBe(
      'perf ★  domyślne · zgodność: 18 GET ✓ · 24 niesprawdzone (nie-GET)',
    );
    const posts = callsTo(r, 'POST', '/conformance');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.path).toContain(SKLEP_WORLD_IDS.environments.perf);
    expect(lineWith(text, 'qa ')).toBeUndefined();
  });

  it('en: the same line in English', async () => {
    const r = await rig('project', 'en');
    const text = await probed(r);
    expect(lineWith(text, 'perf ★')).toBe(
      'perf ★  default · conformance: 18 GET ✓ · 24 unchecked (non-GET)',
    );
  });

  it('does not call conformance when the default environment is protected, and says so', async () => {
    const r = await rig('project');
    const args: SetupArgs = {
      ...DOCS_ARGS,
      environments: ENVIRONMENTS.map((item) =>
        item.name === 'qa'
          ? { ...item, default: true }
          : { name: item.name, api: item.api, frontend: item.frontend },
      ),
    };
    const text = await probed(r, args);
    expect(callsTo(r, 'POST', '/conformance')).toHaveLength(0);
    expect(unwrapped(text)).toContain('zgodność: pominięta — środowisko chronione');
  });

  it('lists the missing and inconclusive endpoints and the unchecked ones by reason', async () => {
    const r = await rig('project');
    r.fake.faults.next('POST', CONFORMANCE, {
      status: 200,
      body: {
        base_url: 'https://api.perf.example.com',
        checked_at: '2026-11-22T10:00:00Z',
        exists: [],
        missing: ['/a', '/b', '/c', '/d', '/e'].map((path) => ({
          classification: 'missing',
          method: 'GET',
          path,
          http_status: 404,
        })),
        sampled: { probed: 8, not_probed_methods: 20, skipped_param_paths: 4 },
        status: 'complete',
        // the backend counts the 20 operations it did not send among the inconclusive ones
        totals: { exists: 2, inconclusive: 21, missing: 5 },
      },
    });
    const text = unwrapped(await probed(r));
    expect(text).toContain('zgodność: 2 GET ✓ · brakujące 5: GET /a, GET /b, GET /c, i 2 więcej ·');
    expect(text).toContain('niejednoznaczne 1 · 24 niesprawdzone (nie-GET, parametry)');
  });

  it('says when the conformance check failed, and still finishes the setup', async () => {
    const r = await rig('project');
    r.fake.faults.next('POST', CONFORMANCE, { status: 502, body: { detail: 'upstream' } });
    const calls = await run(r);
    expect(unwrapped(calls.checkEnv?.text ?? '')).toContain(
      'zgodność: sprawdzenie nie powiodło się',
    );
    expect(calls.apply?.text).toContain('profil zastosowany ✓');
  });

  it.each([401, 403])(
    'a %i of the conformance probe fails the call with a hint',
    async (status) => {
      const r = await rig('project');
      r.fake.faults.next('POST', CONFORMANCE, { status, body: { detail: 'No access' } });
      const calls = await setUpProject(r, DOCS_ARGS);
      expect(calls.checkEnv?.isError).toBe(true);
      expect(calls.checkEnv?.text).toMatch(/→ /);
    },
  );
});

describe('project_apply_setup: documentation, continued', () => {
  it('leaves out the map and the conformance when there is no documentation', async () => {
    const r = await rig('empty');
    const calls = await run(r, { name: 'sklep', environments: ENVIRONMENTS });
    expect(callsTo(r, 'GET', '/api-map')).toHaveLength(0);
    expect(callsTo(r, 'POST', '/conformance')).toHaveLength(0);
    const text = calls.apply?.text ?? '';
    const project = /projects\/([0-9a-f-]{36})\//.exec(text)?.[1];
    expect(project).toBeDefined();
    const inWorld = (shown: string): string =>
      `${shown.replaceAll(project ?? '', SKLEP_IDS.project)}\n`;
    expect(inWorld(calls.analyze?.text ?? '')).toBe(
      goldenText('run4', '01d-project_analyze_setup-without-docs'),
    );
    expect(inWorld(text)).toBe(goldenText('run4', '01e-project_apply_setup-without-docs'));
  });

  it('a named backend error of the map comes with a hint', async () => {
    const r = await rig('project');
    r.fake.faults.next('GET', API_MAP, { status: 401, body: { detail: 'Invalid token' } });
    const calls = await setUpProject(r, DOCS_ARGS);
    expect(calls.apply?.isError).toBe(true);
    expect(calls.apply?.text).toMatch(/→ /);
  });

  it('keeps the canary out of the results and the log', async () => {
    const r = await rig('project');
    await run(r);
    r.assertClean();
  });
});

describe('project_check_env: connections', () => {
  it('one environment that cannot be reached gets a line of its own, with the reason', async () => {
    const r = await rig('project');
    r.fake.faults.next('POST', TEST_CONNECTION, {
      status: 200,
      body: {
        checked_at: '2026-11-22T10:00:00Z',
        protected: false,
        results: [
          { kind: 'base_url', target: 'https://api.perf.example.com', status: 'unreachable' },
        ],
      },
    });
    const text = (await run(r)).checkEnv?.text ?? '';
    expect(text).toContain('połączenie ok: qa, dev, prod');
    expect(text).toContain('połączenie perf: API nieosiągalne');
    // The line names the cause; the next one says what to do about it.
    expect(text).toMatch(/połączenie perf: API nieosiągalne\n→ LoadCraft nie dosięgnął adresu/u);
    expect(text.replace(/\s+/gu, ' ')).toContain(
      'do czasu odpowiedzi nie uruchamiaj na tym środowisku testu',
    );
  });
});

describe('project setup: fields to review and differences', () => {
  it('the analysis counts the fields to review; the applied setup lists them: name, value, source', async () => {
    const r = await rig('empty');
    const calls = await run(r);
    expect(calls.analyze?.text).toContain('proponowany profil: 9 pól, 2 do sprawdzenia');
    const lines = (calls.apply?.text ?? '').split('\n');
    const start = lines.indexOf('do sprawdzenia, zapytaj użytkownika:');
    expect(start).toBeGreaterThan(0);
    expect(lines.slice(start + 1, start + 3)).toEqual([
      '  app_architecture: spa (model)',
      '  has_async_operations: true (openapi)',
    ]);
    expect(lines[start - 1]).toMatch(/^perf ★ /);
  });

  it('en: the heading of the list', async () => {
    const r = await rig('empty', 'en');
    const text = await applied(r);
    expect(text).toContain('to check, ask the user:\n  app_architecture: spa (model)');
  });

  it('project_save_env ends with one warning per difference, naming the stored and the requested value', async () => {
    const r = await rig('project');
    const args: SetupArgs = {
      ...DOCS_ARGS,
      environments: ENVIRONMENTS.map((item) =>
        item.name === 'qa' ? { ...item, api: 'api-v2.qa.example.com', limit: [200, 40] } : item,
      ),
    };
    const text = unwrapped((await run(r, args)).saveEnv?.text ?? '');
    const lines = text.split('\n');
    expect(lines.filter((line) => line.startsWith('uwaga:'))).toEqual([
      'uwaga: środowisko qa ma inny adres API niż w żądaniu: https://api.qa.example.com (żądano https://api-v2.qa.example.com) — bez zmian',
      'uwaga: środowisko qa zostaje chronione: 100 użytkowników / 20 zapytań/s. Luźniejsza część żądania (max_vu 200, max_rps 40) nie została zastosowana; ochronę luzuje się albo zdejmuje tylko w interfejsie LoadCraft, ręcznie.',
    ]);
    // The warnings close the text: the result of the environments has no link.
    expect(lines.at(-1)).toMatch(/^uwaga: środowisko qa zostaje chronione/);
  });
});

/** The golden text without its link lines (the registry adds the links under the view). */
const unlinkedGolden = (run: 'run1' | 'run4', name: string): string =>
  goldenText(run, name)
    .trimEnd()
    .split('\n')
    .filter((line) => !line.startsWith('↗ '))
    .join('\n');

describe('project setup: views against the golden texts', () => {
  const pl = createTranslator('pl');
  const en = createTranslator('en');
  const create = goldenView<ProjectCreateData>('run1/01a-project_create.view.json');
  const saved = goldenView<SaveEnvData>('run1/01b-project_save_env.view.json');
  const checked = goldenView<CheckEnvData>('run1/01c-project_check_env.view.json');
  const analyzed = goldenView<AnalyzeSetupData>('run1/01d-project_analyze_setup.view.json');
  const apply = goldenView<ApplySetupData>('run1/01e-project_apply_setup.view.json');

  it('pl: run 1, the five results of step 01', () => {
    expect(renderProjectCreate(create, pl)).toBe(unlinkedGolden('run1', '01a-project_create'));
    expect(renderSaveEnv(saved, pl)).toBe(unlinkedGolden('run1', '01b-project_save_env'));
    expect(renderCheckEnv(checked, pl)).toBe(unlinkedGolden('run1', '01c-project_check_env'));
    expect(renderAnalyzeSetup(analyzed, pl)).toBe(
      unlinkedGolden('run1', '01d-project_analyze_setup'),
    );
    expect(renderApplySetup(apply, pl)).toBe(unlinkedGolden('run1', '01e-project_apply_setup'));
  });

  it('pl: run 4, the analysis and the setup without documentation', () => {
    const name = (base: string): string => `${base}-without-docs`;
    expect(
      renderAnalyzeSetup(
        goldenView<AnalyzeSetupData>(`run4/${name('01d-project_analyze_setup')}.view.json`),
        pl,
      ),
    ).toBe(unlinkedGolden('run4', name('01d-project_analyze_setup')));
    expect(
      renderApplySetup(
        goldenView<ApplySetupData>(`run4/${name('01e-project_apply_setup')}.view.json`),
        pl,
      ),
    ).toBe(unlinkedGolden('run4', name('01e-project_apply_setup')));
  });

  it('en: the same views in English', () => {
    expect(renderProjectCreate(create, en)).toBe('Project “sklep”');
    expect(renderSaveEnv(saved, en).split('\n')[0]).toBe('perf ★  default');
    expect(renderCheckEnv(checked, en)).toBe(
      'connection ok: perf, qa, dev, prod (API and frontend)',
    );
    expect(renderAnalyzeSetup(analyzed, en)).toContain('→ next: project_apply_setup with analysis');
    expect(renderApplySetup(apply, en).split('\n')[0]).toBe(
      'Project “sklep” · Sklep API · 42 operations · 6 areas',
    );
  });

  it('a reused project says so; a running handle is named in the next step', () => {
    expect(
      renderProjectCreate(
        { ...create, project: { ...create.project, reused: true }, created: false, adopted: true },
        pl,
      ),
    ).toBe('Projekt „sklep” · istniejący');
    expect(unwrapped(renderAnalyzeSetup(analyzed, pl))).toContain(
      `project_apply_setup z analysis "setup_analysis:${SKLEP_IDS.setupAnalysis}"`,
    );
    expect(renderAnalyzeSetup({ analysis: 'kept', fieldsTotal: 0, needsReview: [] }, pl)).toContain(
      'project_apply_setup bez analysis',
    );
  });
});
