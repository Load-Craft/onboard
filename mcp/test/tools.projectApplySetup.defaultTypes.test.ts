// The project setup without documentation: `project_apply_setup` takes the default validators and
// test types from the same provisioning as after an analysis, so a realistic data mix works for
// flows that were recorded rather than read from a specification.

import { describe, expect, it } from 'vitest';

import { scenarioGenerate } from '../src/tools/scenarioGenerate.js';
import { registerCompositionRoutes } from './fake-backend/routes/compositions.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
} from './fake-backend/routes/documentation.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import { registerScenarioBuilderRoutes } from './fake-backend/routes/scenarioBuilder.js';
import { registerScenarioRoutes } from './fake-backend/routes/scenarios.js';
import { registerSelfCheckRoutes } from './fake-backend/routes/selfCheck.js';
import { registerSetupRoutes, SETUP_STATE, type SetupRow } from './fake-backend/routes/setup.js';
import { registerOpenapiReadRoute } from './fake-backend/routes/suggestions.js';
import type { Fake, FakeCall } from './fake-backend/server.js';
import { seedSklep, SKLEP_COLLECTIONS, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { settleClock } from './helpers/clock.js';
import { SETUP_TOOLS, setUpProject, type SetupCalls } from './helpers/projectSetup.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

const ENVIRONMENTS = [
  { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com', default: true },
  { name: 'qa', api: 'api.qa.example.com', frontend: 'qa.example.com', limit: [100, 20] },
  { name: 'dev', api: 'api.dev.example.com', frontend: 'dev.example.com' },
  { name: 'prod', api: 'api.example.com', frontend: 'example.com', limit: [20, 5] },
];
const NO_DOCS = { name: 'sklep', environments: ENVIRONMENTS };
const AUTO_PROVISION = 'POST /api/v1/projects/:id/setup/auto-provision';
const GENERATE = '/scenarios/generate-async';

/**
 * A project whose flows were recorded (they exist), with no documentation and no validators or
 * test types: what the project setup leaves for the recording journey.
 */
async function recordedProject(files: Record<string, string> = {}): Promise<ToolRig> {
  return toolRig({
    tools: [...SETUP_TOOLS, scenarioGenerate],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerProjectRoutes(fake);
      registerSetupRoutes(fake);
      registerOpenapiReadRoute(fake);
      registerApiMapRoute(fake);
      registerConformanceRoute(fake);
      registerFlowRoutes(fake);
      registerScenarioBuilderRoutes(fake);
      registerSelfCheckRoutes(fake);
      registerScenarioRoutes(fake);
      registerCompositionRoutes(fake);
      seedSklep(fake.store, { stage: 'flows' });
      // No documentation, no description and no analysis: the flows came from a recording.
      fake.store
        .collection(SKLEP_COLLECTIONS.projects)
        .update(SKLEP_WORLD_IDS.project, { openapi_spec_id: null, description: '' });
      fake.store.collection<SetupRow>(SETUP_STATE).insert({
        id: SKLEP_WORLD_IDS.project,
        analysis_completed_at: null,
        profile_applied_at: null,
        has_asyncapi: false,
        validators_needs_review: 0,
        test_types_needs_review: 0,
      });
      for (const name of [SKLEP_COLLECTIONS.testTypes, SKLEP_COLLECTIONS.validators]) {
        const rows = fake.store.collection(name);
        rows.list().forEach((row) => {
          rows.delete(row.id);
        });
      }
    },
    env: { LOADCRAFT_LOCALE: 'en' },
    files,
  });
}

const testTypeCount = (r: ToolRig): number =>
  r.fake.store.collection(SKLEP_COLLECTIONS.testTypes).list().length;

const route = (call: FakeCall): string =>
  `${call.method} ${call.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')}`;

const provisionCalls = (r: ToolRig): string[] =>
  r.fake.calls.map(route).filter((entry) => entry === AUTO_PROVISION);

async function init(r: ToolRig): Promise<SetupCalls> {
  const calls = await setUpProject(r, NO_DOCS);
  const failed = [calls.create, calls.saveEnv, calls.checkEnv, calls.analyze, calls.apply]
    .filter((call) => call?.isError === true)
    .map((call) => call?.text);
  expect(failed).toEqual([]);
  expect(calls.apply).toBeDefined();
  return calls;
}

describe('project setup without documentation: default test types', () => {
  it('provisions validators and test types although nothing was analysed', async () => {
    const r = await recordedProject();
    expect(testTypeCount(r)).toBe(0);
    const calls = await init(r);
    expect(provisionCalls(r)).toHaveLength(1);
    expect(testTypeCount(r)).toBeGreaterThan(0);
    const data = (calls.apply?.outcome as { data: { setup: Record<string, unknown> } }).data;
    expect(data.setup).toMatchObject({ analysis: 'none', validators: 5, testTypes: 3 });
  });

  it('a realistic data mix then works for the recorded flows', async () => {
    const r = await recordedProject();
    await init(r);
    const result = await settleClock(
      r,
      r.call('scenario_generate', {
        name: 'checkout',
        flows: ['przeglądanie', 'zakupy', 'konto'],
        proportions: { przeglądanie: 40, zakupy: 50, konto: 10 },
        data_mix: 'realistic',
      }),
    );
    expect(result.isError, result.text).toBe(false);
    expect(result.text).not.toContain('data_mix_realistic_unavailable');
    const generated = r.fake.calls.filter(
      (call) => call.method === 'POST' && call.path.endsWith(GENERATE),
    );
    expect(generated).toHaveLength(3);
    for (const call of generated) {
      expect((call.body as { class_mix?: unknown }).class_mix).toEqual({
        happy_path: 95,
        invalid_input: 4,
        boundary_values: 1,
      });
    }
  });

  it('calling it again creates no second set of test types', async () => {
    const r = await recordedProject();
    await init(r);
    const after = testTypeCount(r);
    const validators = r.fake.store.collection(SKLEP_COLLECTIONS.validators).list().length;
    await init(r);
    expect(testTypeCount(r)).toBe(after);
    expect(r.fake.store.collection(SKLEP_COLLECTIONS.validators).list()).toHaveLength(validators);
  });

  it('leaves types the user already has alone: no provisioning call', async () => {
    const r = await recordedProject();
    await init(r);
    const before = provisionCalls(r).length;
    await init(r);
    expect(provisionCalls(r)).toHaveLength(before);
  });
});

describe('data_mix_realistic_unavailable', () => {
  it('points a project without test types to project_apply_setup', async () => {
    const r = await recordedProject({
      'loadcraft/project.json': JSON.stringify({
        schema: 1,
        url: 'https://app.loadcraft.io',
        project: { id: SKLEP_WORLD_IDS.project, name: 'sklep' },
      }),
    });
    const result = await settleClock(
      r,
      r.call('scenario_generate', {
        name: 'checkout',
        flows: ['przeglądanie'],
        proportions: { przeglądanie: 100 },
        data_mix: 'realistic',
      }),
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[data_mix_realistic_unavailable]');
    expect(result.text).toMatch(/project_apply_setup[^.]*defaults/u);
    expect(result.text).toContain('"normal"');
  });
});
