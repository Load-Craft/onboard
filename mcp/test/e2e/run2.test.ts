// Run 2 from the documentation of the API, end to end on the fake backend: the flow "zakupy" by
// hand (nine steps, two of the proposals taken from `flows_suggest_journeys`), and the AI repair of the
// self-check. The tools are called in the order of the run on one continuous state and each result
// is compared with its golden text.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { CANARY } from '../helpers/canary.js';
import { registerFlowGenerationRoutes } from '../fake-backend/routes/flowGeneration.js';
import {
  failureDocument,
  selfCheckDocument as selfCheckDoc,
  checkRunDocument,
  type StepSpec,
  type SelfCheckFake,
} from '../fake-backend/routes/selfCheck.js';
import { SKLEP_WORLD_IDS } from '../fake-backend/worlds/sklep.js';
import type { JobStep } from '../fake-backend/jobs.js';
import { SKLEP_IDS } from '../golden/index.js';
import {
  runScript,
  setupSteps,
  worldFlows,
  type RunRows,
  type ScriptOptions,
  type Step,
} from './driver.js';
import {
  ENVIRONMENTS,
  fixtureFlow,
  PERF,
  RUN_REPORT_DIAGNOSIS,
  SCENARIO_AND_DATA,
  SPLIT,
  writesOf,
} from './shared.js';

vi.setConfig({ testTimeout: 60_000 });

const DESCRIPTION =
  'Klient loguje się, szuka produktu, dodaje go do koszyka, ogląda koszyk i składa zamówienie.';

const FIRST_PASS = '5d0c2a7e-9b13-4f68-a1d4-8e3b7c6f0a29';

const STEPS: readonly Step[] = [
  ...setupSteps({ name: 'sklep', openapi: 'loadcraft/openapi.json', environments: ENVIRONMENTS }),
  {
    tool: 'project_connect_telemetry',
    args: { label: 'sklep-logs', url: 'https://logs-mcp.perf.example.com/mcp' },
    expect: '02-project_connect_telemetry',
  },
  {
    tool: 'flows_generate_from_endpoints',
    args: {
      name: 'zakupy',
      description: DESCRIPTION,
      endpoints: [
        'POST:/auth/login',
        'GET:/products',
        'POST:/cart/items',
        'GET:/cart',
        'POST:/checkout',
      ],
    },
    expect: '03-flows_generate_from_endpoints',
  },
  { tool: 'flows_suggest_journeys', args: {}, expect: '03-flows_suggest_journeys' },
  {
    tool: 'flows_generate_from_suggestions',
    args: { suggestions: ['przeglądanie', 'konto'] },
    expect: '05-flows_generate_from_suggestions',
  },
  ...SCENARIO_AND_DATA,
  {
    tool: 'scenario_check_self',
    args: { scenarios: ['zakupy', 'konto'] },
    expect: '10-scenario_check_self-naprawa',
    unlinked: true,
  },
  ...RUN_REPORT_DIAGNOSIS,
];

/** The check of `zakupy` fails on the checkout, the AI repairs it, and the second pass is green. */
const CHECK_RUNS: Readonly<Record<string, RunRows>> = {
  [FIRST_PASS]: [
    ['logowanie', 1, 0, 200],
    ['wyszukanie', 1, 0, 300],
    ['koszyk', 1, 0, 300],
    ['podgląd koszyka', 1, 0, 200],
    ['zamówienie', 0, 1, 400],
  ],
  [SKLEP_WORLD_IDS.selfCheckZakupy]: [
    ['logowanie', 1, 0, 200],
    ['wyszukanie', 1, 0, 300],
    ['koszyk', 1, 0, 300],
    ['podgląd koszyka', 1, 0, 200],
    ['zamówienie', 1, 0, 400],
  ],
};

function planChecks(checks: SelfCheckFake): void {
  const step = <S>(afterMs: number, state: S): JobStep<S> => ({ afterMs, state });
  const failure = failureDocument('POST /checkout', 'HTTP 403 Forbidden', null, 403);
  const repair = {
    round: 1,
    failure,
    changes_summary: 'dodano nagłówek X-CSRF-Token',
    refused_reason: null,
    refused_code: null,
    refused_message: null,
    scenario_version_after: 2,
    verdict: 'passed' as const,
    recording_available: true,
  };
  // The steps of a run in the order they ran; the checkout fails on the first pass and is repaired.
  const names = ['logowanie', 'wyszukanie', 'koszyk', 'podgląd koszyka'] as const;
  const passing: StepSpec[] = names.map((name) => [name, 'ok']);
  const runs = [
    checkRunDocument(FIRST_PASS, 1, 'failed', [
      ...passing,
      ['zamówienie', 'failed', 403, 'HTTP 403 Forbidden'],
    ]),
    checkRunDocument(SKLEP_WORLD_IDS.selfCheckZakupy, 2, 'passed', [
      ...passing,
      ['zamówienie', 'ok'],
    ]),
  ];
  checks.plan(SKLEP_WORLD_IDS.scenarios.zakupy, [
    step(0, selfCheckDoc({})),
    step(2000, selfCheckDoc({ status: 'running', execution_ids: [FIRST_PASS] })),
    step(4000, selfCheckDoc({ status: 'repairing', execution_ids: [FIRST_PASS], failure })),
    step(
      7000,
      selfCheckDoc({
        status: 'passed_after_repair',
        scenario_version: 2,
        execution_ids: [FIRST_PASS, SKLEP_WORLD_IDS.selfCheckZakupy],
        repairs: [repair],
        runs,
        started_at: '2026-11-22T10:19:55Z',
        finished_at: '2026-11-22T10:20:09Z',
      }),
    ),
  ]);
  checks.plan(SKLEP_WORLD_IDS.scenarios.konto, [
    step(0, selfCheckDoc({})),
    step(
      4000,
      selfCheckDoc({ status: 'running', execution_ids: [SKLEP_WORLD_IDS.selfCheckKonto] }),
    ),
    step(
      9000,
      selfCheckDoc({
        status: 'passed',
        execution_ids: [SKLEP_WORLD_IDS.selfCheckKonto],
        started_at: '2026-11-22T10:19:55Z',
        finished_at: '2026-11-22T10:21:02Z',
      }),
    ),
  ]);
}

const OPTIONS: ScriptOptions = {
  run: 'run2',
  runScript: PERF,
  batch: {
    // Only the two journeys of the proposals: "zakupy" was built by hand.
    plans: worldFlows()
      .filter((flow) => flow.name !== 'zakupy')
      .map((flow) => ({ name: flow.name, flow })),
  },
  split: SPLIT,
  executionIds: [SKLEP_IDS.executionPerf],
  checkRuns: CHECK_RUNS,
  checks: planChecks,
  before: (fake, clock) => {
    // The generator makes the flow of the description the tool sent: nine blocks, four pauses.
    registerFlowGenerationRoutes(
      fake,
      { flow: { ...fixtureFlow('zakupy-run2-reczne'), id: SKLEP_IDS.flowZakupy } },
      clock,
    );
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
  'POST /projects/:id/flows/generate-async',
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
  'POST /projects/:id/gatling/feeders',
  'POST /projects/:id/gatling/feeders/:feeder/provision',
  'PUT /projects/:id/gatling/compositions/:id/slot-bindings',
  'PUT /projects/:id/gatling/scenarios/:id/slot-bindings',
  'POST /projects/:id/gatling/feeders/:feeder/provision',
  'POST /projects/:id/gatling/compositions/:id/feeders/preflight',
  'POST /projects/:id/gatling/scenarios/:id/self-check',
  'POST /projects/:id/gatling/compositions/:id/feeders/preflight',
  'POST /projects/:id/gatling/compositions/:id/execute',
  'POST /projects/:id/gatling/executions/:id/analyze-async',
];

describe('run 2 on the fake backend', () => {
  it('every result is the golden text, and the run leaves no secret and no operation behind', async () => {
    const run = await runScript(STEPS, OPTIONS);
    const { rig } = run;
    expect(run.results).toHaveLength(STEPS.length);

    // The flow by hand reached the backend as the list of the endpoints and the description.
    const generation = rig.fake.calls.find((call) => call.path.endsWith('/flows/generate-async'));
    expect(generation?.body).toMatchObject({
      flow_name: 'zakupy',
      description: DESCRIPTION,
      endpoint_ids: [
        'POST:/auth/login',
        'GET:/products',
        'POST:/cart/items',
        'GET:/cart',
        'POST:/checkout',
      ],
    });

    // The state after the run: three flows (one by hand, two from the proposals), one repair.
    const status = await rig.call('process_get_status', {});
    expect(status.isError, status.text).toBe(false);
    expect(status.text).toContain('3 flowy · 3 scenariusze · 1 kompozycja');
    expect(status.text).toMatch(/e-3f9a12c4 {2}checkout {2}SLA FAILED/u);

    expect(writesOf(rig.fake.calls)).toEqual(WRITES);
    expect(rig.fake.calls.some((call) => call.method === 'DELETE')).toBe(false);

    const bound = JSON.parse(
      readFileSync(join(rig.workspace, 'loadcraft', 'project.json'), 'utf8'),
    ) as { project: { name: string } };
    expect(bound.project.name).toBe('sklep');
    const state = JSON.parse(
      readFileSync(join(rig.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
    ) as { opPayloads: Record<string, unknown> };
    expect(state.opPayloads).toEqual({});

    rig.assertClean();
    expect(readFileSync(join(rig.workspace, '.env.perf'), 'utf8')).toContain(CANARY);
    expect(JSON.stringify(rig.lines)).not.toContain(CANARY);
  });
});
