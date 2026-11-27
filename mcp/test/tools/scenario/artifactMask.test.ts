// scenario_get reads the stored artifact as LoadCraft's own documentation (DOKTOR-03 part 2): names
// of variables and fields stay. The literals of credentials the artifact carries from a recording are
// still masked, in the view and in the data: a password in a request body, the token of an
// `Authorization` header in generated code, a value the call registered as a secret (the API token of
// the plugin) and a cell of a credential column of a dataset.

import { describe, expect, it } from 'vitest';

import { scenarioGet } from '../../../src/tools/scenario/get.js';
import { newProcess } from '../../../src/workspace/migrate.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepScenario,
} from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { CANARY, leakedPieces } from '../../helpers/canary.js';
import { createTestClock } from '../../helpers/clock.js';
import { toolRig } from '../../helpers/rig.js';

const PROJECT = SKLEP_IDS.project;
const SCENARIO = SKLEP_WORLD_IDS.scenarios.przegladanie;
const NOW = '2026-11-27T12:00:00.000Z';

const PASSWORD = 'Hunter2!x';
const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ1c2VyLTEifQ', 'c2lnbmF0dXJlLTEyMzQ'].join('.');
const CELL = 'Cell-Secret-77x';

const ARTIFACT = {
  requests: [
    {
      name: 'Sign in',
      method: 'POST',
      path: '/auth/login',
      headers: { 'x-api-key': CANARY, 'x-session': '#{session_id}' },
      body: JSON.stringify({ email: '#{email}', password: PASSWORD }),
    },
  ],
  modular_files: {
    'src/gatling/scala/steps/SignInStep.scala': `exec(http("Sign in").post("/auth/login").header("Authorization","Bearer ${JWT}"))`,
  },
  feeders: [
    {
      name: 'accounts',
      feeder_type: 'csv',
      content: `email,password\nuser@example.com,${CELL}\n`,
      column_semantics: { email: 'email', password: 'credential' },
    },
  ],
  scenario_contract_v2: { session_vars: ['email', 'password', 'session_id'], locals: ['token'] },
};

async function call(format?: 'data') {
  const empty = newProcess(PROJECT, NOW);
  const r = await toolRig({
    tools: [scenarioGet],
    world: (fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'scenario' });
      fake.store
        .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
        .update(SCENARIO, { scenario_artifact: ARTIFACT } as unknown as Partial<SklepScenario>);
    },
    clock: createTestClock(Date.parse(NOW)),
    env: { LOADCRAFT_LOCALE: 'en' },
    files: {
      'loadcraft/project.json': JSON.stringify({
        schema: 1,
        url: 'https://app.loadcraft.io',
        project: { id: PROJECT, name: 'sklep' },
      }),
      'loadcraft/.cache/state.json': JSON.stringify({ schema: 3, process: { [PROJECT]: empty } }),
    },
  });
  const result = await r.call('scenario_get', {
    scenario_id: SCENARIO,
    include: ['artifact'],
    ...(format === undefined ? {} : { format }),
  });
  return { r, result };
}

describe('scenario_get artifact: names stay, credentials of the recording do not', () => {
  it.each([undefined, 'data'] as const)(
    'masks every credential literal (format %s)',
    async (format) => {
      const { result } = await call(format);
      expect(result.isError, result.text).toBe(false);
      const shown = `${result.text}\n${JSON.stringify(result.outcome ?? null)}`;
      for (const secret of [PASSWORD, JWT, CANARY, CELL])
        expect(leakedPieces(shown, [secret])).toEqual([]);
      // the names of the variables and the references stay
      expect(shown).toContain('session_id');
      expect(shown).toContain('#{email}');
      // the artifact itself is shown, not left out
      expect(shown).toContain('SignInStep');
      expect(shown).toContain('user@example.com');
    },
  );
});
