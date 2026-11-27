// Run 5 on the protected environment: a new revision of the API description (`project_import_docs`),
// accounts created on `qa`, and the test on `qa` that the plugin clamps to the limit of the
// environment. Without the consent of the user nothing is started and nothing is created; with it,
// the body of `execute` that the fake received carries 100 users, not 2 000. The report carries the
// note about the clamped load and the run has no diagnosis.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { CANARY } from '../helpers/canary.js';
import { registerOpenapiUploadRoute } from '../fake-backend/routes/documentation.js';
import { startedRuns, type RunScript, type StartedRun } from '../fake-backend/routes/executions.js';
import type { Fake } from '../fake-backend/server.js';
import { createIdSource, createStore, type StoredRecord } from '../fake-backend/store.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  type SklepExecution,
  type SklepExecutionResult,
} from '../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../golden/index.js';
import {
  fixtureFiles,
  runScript,
  setupSteps,
  sklepOpenapi,
  worldFlows,
  type ScriptOptions,
  type Step,
} from './driver.js';
import { ENVIRONMENTS, RAMP_2000, SPLIT, writesOf } from './shared.js';

vi.setConfig({ testTimeout: 60_000 });

const PREVIOUS = 'a41f9c2d83b05e17c6a94f0b2d38e5a1c7f09b46';
const CURRENT = '7be03d1a95c24f68b0e7d3a1c59f82e460ab1d37';

/** The test on `qa`: 100 users for 10 minutes, 18 requests/s, p95 about 210 ms, no errors. */
const QA: RunScript = {
  createdBeforeS: 2,
  startsAtS: 16,
  loadS: 600,
  end: 'completed',
  live: () => ({ rps: 18, p95: 205, errorRate: 0 }),
  final: { rps: 18.17, p95: 210, errorRate: 0 },
  series: Array<number>(60).fill(18),
};

/** A result with fields the typed world does not allow (a percentile that was not measured). */
type Loose = StoredRecord & Record<string, unknown>;

/**
 * The stored record of the finished test on `qa`, as the backend keeps it: the verdict of two
 * passed assertions, 10 900 requests, and no percentiles per request (the load was clamped).
 */
function finishQa(fake: Fake, run: StartedRun): void {
  const scratch = createStore(createIdSource(1));
  seedSklep(scratch, { stage: 'executed' });
  const perf = scratch
    .collection<SklepExecution>(SKLEP_COLLECTIONS.executions)
    .require(SKLEP_IDS.executionPerf);
  const assertion = (index: number, actual: number) => {
    const found = perf.sla_verdict?.assertions[index];
    if (found === undefined) throw new Error('the perf run has two assertions');
    return { ...found, actual, passed: true, samples: 10_900 };
  };
  if (perf.sla_verdict === null) throw new Error('the perf run has a verdict');
  fake.store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).insert({
    ...perf,
    id: run.id,
    run_exit_code: 0,
    sla_verdict: {
      ...perf.sla_verdict,
      status: 'passed',
      assertions: [assertion(0, 210), assertion(1, 0)],
    },
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
  });
  const unmeasured: Loose = {
    ...scratch
      .collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results)
      .require(SKLEP_IDS.executionPerf),
    id: run.id,
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
  fake.store.collection<Loose>(SKLEP_COLLECTIONS.results).insert(unmeasured);
}

const STEPS: readonly Step[] = [
  ...setupSteps({ name: 'sklep', openapi: 'loadcraft/openapi.json', environments: ENVIRONMENTS }),
  {
    tool: 'project_connect_telemetry',
    args: { label: 'sklep-logs', url: 'https://logs-mcp.perf.example.com/mcp' },
    expect: '02-project_connect_telemetry',
  },
  {
    tool: 'project_import_docs',
    args: { openapi: 'loadcraft/openapi.next.json', environment: 'qa' },
    expect: '03-project_import_docs',
  },
  // The revision has 43 operations, so the coverage line differs from the one of run 1.
  { tool: 'flows_suggest_journeys', args: {}, expect: '03-flows_suggest_journeys-po-aktualizacji' },
  {
    tool: 'flows_generate_from_suggestions',
    args: { suggestions: ['zakupy', 'przeglądanie', 'konto'] },
    expect: '04-flows_generate_from_suggestions',
  },
  {
    tool: 'scenario_suggest_split',
    args: { name: 'checkout', flows: ['przeglądanie', 'zakupy', 'konto'] },
    expect: '05-scenario_suggest_split-propozycja',
  },
  {
    tool: 'scenario_generate',
    args: {
      name: 'checkout',
      proportions: { przeglądanie: 40, zakupy: 50, konto: 10 },
      data_mix: 'realistic',
    },
    expect: '06-scenario_generate-generowanie',
  },
  {
    tool: 'data_check_readiness',
    args: { scenario: 'checkout', environment: 'qa' },
    expect: '08-data_check_readiness-plan-qa',
  },
  // The accounts are created on a protected environment: nothing is sent until the user agreed.
  {
    tool: 'data_create_accounts',
    args: {
      scenario: 'checkout',
      environment: 'qa',
      slot: 'accounts',
      count: 2000,
    },
    expect: '08a-data_create_accounts-qa',
    contains: 'confirm_protected: true',
  },
  {
    tool: 'data_create_accounts',
    args: {
      scenario: 'checkout',
      environment: 'qa',
      slot: 'accounts',
      count: 2000,
      confirm_protected: true,
    },
    expect: '08a-data_create_accounts-qa',
  },
  {
    tool: 'scenario_check_self',
    args: { scenarios: ['zakupy', 'konto'] },
    expect: '09-scenario_check_self',
  },
  {
    tool: 'run_plan',
    args: { scenario: 'checkout', environment: 'qa', target_users: 2000 },
    expect: '09a-run_plan-qa',
  },
  // The profile is above the limit of `qa`: nothing is started until the user agreed to the clamp.
  {
    tool: 'run_start',
    args: {
      scenario: 'checkout',
      environment: 'qa',
      profile: RAMP_2000,
      thresholds: { p95_ms: 400, error_rate_pct: 1 },
    },
    expect: '11-run_start-qa',
    contains: 'confirm_capped: true',
  },
  {
    tool: 'run_start',
    args: {
      scenario: 'checkout',
      environment: 'qa',
      profile: RAMP_2000,
      thresholds: { p95_ms: 400, error_rate_pct: 1 },
      confirm_capped: true,
    },
    expect: '11-run_start-qa',
  },
];

/** The report of the test on `qa`; the golden text has no link line. */
const REPORT: Step = {
  tool: 'results_get_report',
  args: { execution: 'e-8c2d4f17' },
  expect: '12-results_get_report-qa',
  unlinked: true,
};

const OPTIONS: ScriptOptions = {
  run: 'run5',
  runScript: QA,
  batch: {
    plans: worldFlows().map((flow) => ({ name: flow.name, flow })),
  },
  split: SPLIT,
  executionIds: [SKLEP_IDS.executionQa],
  // The repository holds the description the project was made from and the next revision of it.
  files: {
    ...fixtureFiles(sklepOpenapi({ commit: PREVIOUS })),
    'loadcraft/openapi.next.json': sklepOpenapi({
      commit: CURRENT,
      extra: true,
      version: '2.15.0',
    }),
  },
  finish: finishQa,
  before: (fake: Fake) => {
    registerOpenapiUploadRoute(fake);
  },
};

const WRITES = [
  'POST /projects',
  'POST /projects/:id/environments',
  'POST /projects/:id/environments/:id/test-connection',
  'POST /projects/:id/setup/analyze',
  'POST /projects/:id/setup/apply',
  'POST /projects/:id/setup/auto-provision',
  'POST /projects/:id/environments/:id/conformance',
  'POST /projects/:id/telemetry-source/test',
  'PUT /projects/:id/telemetry-source',
  'POST /projects/:id/openapi/upload',
  'POST /projects/:id/flow-suggestions/heuristic',
  'POST /projects/:id/flow-suggestions/refine',
  'POST /projects/:id/flow-suggestions/heuristic',
  'POST /projects/:id/flow-suggestions/batch-generate',
  'POST /projects/:id/scenario-builder/:id/messages',
  'POST /projects/:id/gatling/scenarios/generate-async',
  'POST /projects/:id/gatling/compositions',
  // data_check_readiness reads the pre-flight only (the data hub is not asked); the pre-flight of
  // data_create_accounts right after it is the same call.
  'POST /projects/:id/gatling/compositions/:id/feeders/preflight',
  'POST /projects/:id/data-hub/auto-plan',
  // data_create_accounts reads the plan before it asks for the consent on the protected environment.
  'POST /projects/:id/gatling/compositions/:id/feeders/preflight',
  'POST /projects/:id/data-hub/auto-plan',
  'POST /projects/:id/gatling/feeders',
  'POST /projects/:id/gatling/feeders/:feeder/provision',
  'PUT /projects/:id/gatling/compositions/:id/slot-bindings',
  'PUT /projects/:id/gatling/scenarios/:id/slot-bindings',
  'POST /projects/:id/gatling/feeders/:feeder/provision',
  'POST /projects/:id/gatling/compositions/:id/feeders/preflight',
  'POST /projects/:id/gatling/scenarios/:id/self-check',
  'POST /projects/:id/gatling/compositions/:id/feeders/preflight',
  'POST /projects/:id/gatling/compositions/:id/execute',
];

describe('run 5 on the fake backend (protected qa)', () => {
  it('every result is the golden text, and nothing is sent to qa without the consent of the user', async () => {
    const run = await runScript([...STEPS, REPORT], OPTIONS);
    const { rig } = run;
    expect(run.results).toHaveLength(STEPS.length + 1);

    // The refused accounts reached no backend route; the agreed ones were created on qa.
    const provisions = rig.fake.calls.filter((call) => call.path.includes('/provision'));
    expect(provisions.length).toBeGreaterThan(0);
    expect(
      provisions.every(
        (call) => (call.body as { confirm_protected?: boolean }).confirm_protected === true,
      ),
    ).toBe(true);

    // One test was started, and the body of `execute` carries the clamped load: 100 users.
    const executes = rig.fake.calls.filter((call) => call.path.endsWith('/execute'));
    expect(executes).toHaveLength(1);
    expect(executes[0]?.body).toMatchObject({
      environment_id: expect.any(String) as string,
      workload: { type: 'ramp_concurrency', vusers: 100, ramp: 600 },
    });
    const [started] = startedRuns(rig.fake);
    expect(started?.id).toBe(SKLEP_IDS.executionQa);
    expect(started?.workload).toMatchObject({ vusers: 100 });
    // Every feeder check of the run saw the clamped load, not the asked one.
    const preflights = rig.fake.calls.filter((call) => call.path.endsWith('/feeders/preflight'));
    expect(JSON.stringify(preflights.at(-1)?.body)).toContain('"vusers":100');
    expect(JSON.stringify(preflights.at(-1)?.body)).not.toContain('"vusers":2000');

    // The run has no diagnosis: the tool was not called and nothing was analysed.
    expect(rig.fake.calls.some((call) => call.path.endsWith('/analyze-async'))).toBe(false);

    expect(writesOf(rig.fake.calls)).toEqual(WRITES);
    expect(rig.fake.calls.some((call) => call.method === 'DELETE')).toBe(false);

    const state = JSON.parse(
      readFileSync(join(rig.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
    ) as { opPayloads: Record<string, unknown> };
    expect(state.opPayloads).toEqual({});

    rig.assertClean();
    expect(readFileSync(join(rig.workspace, '.env.qa'), 'utf8')).toContain(CANARY);
    expect(JSON.stringify(rig.lines)).not.toContain(CANARY);
  });
});
