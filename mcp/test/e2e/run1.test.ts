// Run 1 from the documentation of the API, end to end on the fake backend: the tools are called in
// the order of the run on one continuous state and each result is compared with its golden text.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { components } from '../../src/http/generated/api.js';
import { CANARY } from '../helpers/canary.js';
import type { RunScript } from '../fake-backend/routes/executions.js';
import { SKLEP_IDS } from '../golden/index.js';
import { SKLEP_SUGGESTIONS } from '../fake-backend/routes/suggestions.js';
import { runScript, setupSteps, worldFlows, type Step } from './driver.js';

vi.setConfig({ testTimeout: 60_000 });

type FlowDetail = components['schemas']['FlowDetail'];

const ZAKUPY = JSON.parse(
  readFileSync(new URL('../fixtures/flows/zakupy-run1.json', import.meta.url), 'utf8'),
) as FlowDetail;

const ENVIRONMENTS = [
  { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com', default: true },
  { name: 'qa', api: 'api.qa.example.com', frontend: 'qa.example.com', limit: [100, 20] },
  { name: 'dev', api: 'api.dev.example.com', frontend: 'dev.example.com' },
  { name: 'prod', api: 'api.example.com', frontend: 'example.com', limit: [20, 5] },
];

const PERF_LEVELS = [0, 0, 150, 150, 150, 290, 290, 290, 430, 570, 710, 860, 1000, 1000];

function spread(values: readonly number[], length: number): number[] {
  const points = Array<number>(length).fill(0);
  values.forEach((value, index) => {
    const from = Math.floor((index * length) / values.length);
    const to = Math.floor(((index + 1) * length) / values.length);
    for (let at = from; at < to; at += 1) points[at] = value;
  });
  return points;
}

const PERF: RunScript = {
  createdBeforeS: 2,
  startsAtS: 16,
  loadS: 600,
  end: 'completed',
  live: (elapsed) =>
    elapsed >= 390
      ? { rps: 690, p95: 910, errorRate: 0.006 }
      : { rps: elapsed * 1.7, p95: 500, errorRate: 0.006 },
  final: { rps: 1035, p95: 1120, errorRate: 0.006 },
  series: spread(PERF_LEVELS, 60),
};

const RAMP_2000 = { type: 'ramp_concurrency', vusers: 2000, ramp: 600 } as const;

const STEPS: readonly Step[] = [
  ...setupSteps({ name: 'sklep', openapi: 'loadcraft/openapi.json', environments: ENVIRONMENTS }),
  {
    tool: 'project_connect_telemetry',
    args: { label: 'sklep-logs', url: 'https://logs-mcp.perf.example.com/mcp' },
    expect: '02-project_connect_telemetry',
  },
  {
    tool: 'flows_suggest_journeys',
    args: {},
    expect: '03-flows_suggest_journeys',
  },
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
    args: { scenario: 'checkout' },
    expect: '07-data_check_readiness-plan',
  },
  {
    tool: 'data_create_accounts',
    args: { scenario: 'checkout', slot: 'accounts', count: 2000 },
    expect: '08-data_create_accounts',
  },
  {
    tool: 'scenario_check_self',
    args: { scenarios: ['zakupy', 'konto'] },
    expect: '09-scenario_check_self',
  },
  {
    tool: 'run_plan',
    args: { scenario: 'checkout', environment: 'perf', target_users: 2000 },
    expect: '09a-run_plan',
  },
  {
    tool: 'run_start',
    args: {
      scenario: 'checkout',
      environment: 'perf',
      profile: RAMP_2000,
      thresholds: { p95_ms: 400, error_rate_pct: 1 },
    },
    expect: '10-run_start',
  },
  {
    tool: 'results_get_report',
    args: { execution: 'e-3f9a12c4' },
    expect: '11-results_get_report',
  },
  {
    tool: 'results_analyze_run',
    args: { execution: 'e-3f9a12c4', force: true },
    expect: '12-results_analyze_run',
  },
];

const SPLIT = [
  { flow: 'przeglądanie', proportion: 60 },
  { flow: 'zakupy', proportion: 30 },
  { flow: 'konto', proportion: 10 },
];

const OPTIONS = {
  run: 'run1',
  runScript: PERF,
  batch: {
    plans: [
      { name: 'zakupy', flow: ZAKUPY },
      ...worldFlows()
        .filter((flow) => flow.name !== 'zakupy')
        .map((flow) => ({ name: flow.name, flow })),
    ],
  },
  split: SPLIT,
  executionIds: [SKLEP_IDS.executionPerf],
} as const;

/** The writes of the run in order, one entry for each run of the same call. */
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

function writesOf(calls: readonly { method: string; path: string }[]): string[] {
  const writes = calls
    .filter((call) => call.method !== 'GET')
    .map(
      (call) =>
        `${call.method} ${call.path
          .replace('/api/v1', '')
          .replace(/created-feeder-\d+/u, ':feeder')
          .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gu, ':id')}`,
    );
  return writes.filter((write, index) => write !== writes[index - 1]);
}

describe('run 1 on the fake backend', () => {
  it('every result is the golden text, and the run leaves no secret and no operation behind', async () => {
    const run = await runScript(STEPS, OPTIONS);
    const { rig } = run;
    expect(run.results).toHaveLength(STEPS.length);

    // The last step of the run: where things stand after the test and its diagnosis.
    const status = await rig.call('process_get_status', {});
    expect(status.isError, status.text).toBe(false);
    expect(status.text).toContain('Projekt „sklep” · konfiguracja kompletna ✓');
    expect(status.text).toContain('3 flowy · 3 scenariusze · 1 kompozycja');
    expect(status.text).toMatch(/e-3f9a12c4 {2}checkout {2}SLA FAILED/u);

    expect(writesOf(rig.fake.calls)).toEqual(WRITES);
    expect(rig.fake.calls.some((call) => call.method === 'DELETE')).toBe(false);

    // The project is bound to the repository, and nothing is left running in the cache.
    const bound = JSON.parse(
      readFileSync(join(rig.workspace, 'loadcraft', 'project.json'), 'utf8'),
    ) as {
      project: { id: string; name: string };
    };
    expect(bound.project.name).toBe('sklep');
    const state = JSON.parse(
      readFileSync(join(rig.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
    ) as { opPayloads: Record<string, unknown> };
    expect(state.opPayloads).toEqual({});

    // No result, log line or file under loadcraft/ holds the canary; the .env files are untouched.
    rig.assertClean();
    expect(readFileSync(join(rig.workspace, '.env.perf'), 'utf8')).toContain(CANARY);
    expect(JSON.stringify(rig.lines)).not.toContain(CANARY);
  });

  it('the server announces its tools without an output schema', async () => {
    const run = await runScript(STEPS.slice(0, 1), OPTIONS);
    const tools = await run.rig.session.listTools();
    expect(tools.length).toBeGreaterThan(10);
    expect(
      tools.filter((tool) => tool.outputSchema !== undefined).map((tool) => tool.name),
    ).toEqual([]);
  });

  it('with the WebSocket blocked: the refinement is an error, the rest is restored through REST', async () => {
    const steps: Step[] = STEPS.flatMap((step) =>
      step.tool === 'flows_suggest_journeys'
        ? [
            {
              tool: 'flows_suggest_journeys',
              args: {},
              expect: '03-flows_suggest_journeys',
              error:
                '[websocket_unavailable] Kanał WebSocket do LoadCraft nie otwiera się z tej sieci',
            },
            {
              ...step,
              args: { refine: false },
              contains: 'propozycje heurystyczne, nie doprecyzowane przez model',
            },
          ]
        : [step],
    );
    const run = await runScript(steps, {
      ...OPTIONS,
      suggestions: { ...SKLEP_SUGGESTIONS, heuristic: SKLEP_SUGGESTIONS.refined },
      before: (fake) => {
        fake.faults.blockWebSocket();
      },
    });
    expect(run.results).toHaveLength(steps.length);
    run.rig.assertClean();
  });
});
