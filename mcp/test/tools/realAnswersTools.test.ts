// The tools on answers recorded from a real backend (DOKTOR-03 part 2, `test/fixtures/real-answers/`,
// neutralised): project_get_docs on the active OpenAPI documentation (it failed, and `ids.docs_id`
// never reached the state), the hint of project_get_endpoints without a documentation id, and
// scenario_get with the artifact of a registration scenario, which ended in an internal error: a
// word of the generated code after "token" ("passed") was registered as a secret and scrubbed the
// state of the self-check into "[redacted]", a key no dictionary has. An internal error leaves an
// entry in the server log with its event, the tool, the kind of the exception and where it was thrown.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { projectGetDocs } from '../../src/tools/project/getDocs.js';
import { projectGetEndpoints } from '../../src/tools/project/getEndpoints.js';
import { scenarioGet } from '../../src/tools/scenario/get.js';
import { newProcess } from '../../src/workspace/migrate.js';
import { registerAllRoutes } from '../fake-backend/routes/index.js';
import { registerLookupRoutes } from '../fake-backend/routes/lookup.js';
import { registerProjectModuleRoutes } from '../fake-backend/routes/project.js';
import { registerOpenapiReadRoute } from '../fake-backend/routes/suggestions.js';
import { seedSklep, SKLEP_WORLD_IDS } from '../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../golden/index.js';
import { createTestClock } from '../helpers/clock.js';
import { toolRig } from '../helpers/rig.js';

const DIR = join(import.meta.dirname, '..', 'fixtures', 'real-answers');
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as Record<string, unknown>;

const PROJECT = SKLEP_IDS.project;
const NOW = '2026-11-27T09:00:00.000Z';
const BOUND = JSON.stringify({
  schema: 1,
  url: 'https://app.loadcraft.io',
  project: { id: PROJECT, name: 'sklep' },
});

async function docsRig(locale: 'en' | 'pl' = 'en') {
  return toolRig({
    tools: [projectGetDocs, projectGetEndpoints],
    world: (fake) => {
      registerLookupRoutes(fake);
      registerProjectModuleRoutes(fake);
      registerOpenapiReadRoute(fake);
      seedSklep(fake.store, { stage: 'project' });
    },
    clock: createTestClock(Date.parse(NOW)),
    env: { LOADCRAFT_LOCALE: locale },
    files: { 'loadcraft/project.json': BOUND },
  });
}

const state = (r: { workspace: string }) =>
  JSON.parse(readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8')) as {
    process: Record<string, { ids: Record<string, unknown> }>;
  };

describe('project_get_docs on the active documentation of a real backend', () => {
  it('shows it and keeps its id in the state', async () => {
    const r = await docsRig();
    const docs = fixture('docs-active');
    r.fake.faults.next('GET', `/api/v1/projects/${PROJECT}/openapi`, { status: 200, body: docs });
    const result = await r.call('project_get_docs', {});
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('Shop — Store API (shopping path)');
    expect(result.text).not.toContain('operation.undefined');
    expect(result.text).not.toContain('[redacted]');
    expect(state(r).process[PROJECT]?.ids['docs_id']).toBe(docs['id']);
  });
});

describe('project_get_endpoints without a documentation id', () => {
  it.each([
    ['en', 'project_get_docs with versions=true'],
    ['pl', 'project_get_docs z versions=true'],
  ] as const)('names the call that lists the ids (%s)', async (locale, said) => {
    const r = await docsRig(locale);
    const result = await r.call('project_get_endpoints', {});
    expect(result.text).toMatch(/^\[missing_argument\] /u);
    expect(result.text).toContain(said);
    expect(result.text).not.toContain('process_get_status');
  });
});

describe('scenario_get with the artifact of a real registration scenario', () => {
  const SCENARIO = SKLEP_WORLD_IDS.scenarios.przegladanie;
  const BASE = `/api/v1/projects/${PROJECT}/gatling/scenarios/${SCENARIO}`;

  async function scenarioRig() {
    const empty = newProcess(PROJECT, NOW);
    return toolRig({
      tools: [scenarioGet],
      world: (fake) => {
        registerAllRoutes(fake);
        seedSklep(fake.store, { stage: 'scenario' });
      },
      clock: createTestClock(Date.parse(NOW)),
      env: { LOADCRAFT_LOCALE: 'en' },
      files: {
        'loadcraft/project.json': BOUND,
        'loadcraft/.cache/state.json': JSON.stringify({
          schema: 3,
          process: { [PROJECT]: { ...empty, ids: { ...empty.ids, scenario_ids: {} } } },
        }),
      },
    });
  }

  it('shows the scenario, its passed self-check and the slot label whole', async () => {
    const r = await scenarioRig();
    const body = { ...fixture('scenario-registration'), id: SCENARIO };
    r.fake.faults.next('GET', BASE, { status: 200, body }, { outsideContract: true });
    const result = await r.call('scenario_get', { scenario_id: SCENARIO, include: ['artifact'] });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('self-check: passed');
    expect(result.text).toContain('city & company');
    expect(result.text).not.toContain('[redacted]');
  });

  it('an internal error leaves its event, the tool, the kind, the message and the frames in the server log', async () => {
    const r = await scenarioRig();
    // An answer whose self-check has a state no dictionary knows makes the view throw.
    const body = {
      ...fixture('scenario-registration'),
      id: SCENARIO,
      self_check: { ...(fixture('scenario-registration')['self_check'] as object), status: 'zzz' },
    };
    r.fake.faults.next('GET', BASE, { status: 200, body }, { outsideContract: true });
    const result = await r.call('scenario_get', { scenario_id: SCENARIO });
    expect(result.text).toMatch(/^\[internal_error\] /u);
    const event = /event ([0-9a-f]{8})/u.exec(result.text)?.[1];
    const entry = r.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((record) => record['msg'] === 'tool failed');
    expect(entry).toMatchObject({ level: 'error', event, tool: 'scenario_get', error: 'Error' });
    expect((entry?.['frames'] as string[]).length).toBeGreaterThan(0);
    expect((entry?.['frames'] as string[])[0]).toMatch(/^at /u);
    expect(entry?.['message']).toContain('scenario.check_state');
    r.forgetResults();
    r.forgetLogs();
  });
});
