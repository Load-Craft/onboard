// Run 4 from a recording: a project without documentation, `flows_import_har` of a 38 MB recording and
// the split of it into three flows through the HAR channel (recorded pauses), then the scenario,
// the data, the test and the report on one continuous state of the fake backend.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { assertNoCanary, CANARY, FILE_CANARY } from '../helpers/canary.js';
import { HAR_SESSIONS, registerHarRoutes, type HarJourney } from '../fake-backend/routes/har.js';
import { SKLEP_IDS } from '../golden/index.js';
import {
  fixtureFiles,
  runScript,
  SETUP_GOLDEN,
  setupSteps,
  worldFlows,
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
  type FlowDetail,
} from './shared.js';

vi.setConfig({ testTimeout: 120_000 });

const RECORDING = 'nagrania/sesja.har';
const HOST = 'https://perf.example.com';
const SIZE = 38 * 1024 * 1024;

/** A recording of the shop that holds secrets in the cookie, the header, the body and the answer. */
function recording(): string {
  const entry = (method: string, path: string, body: unknown) => ({
    request: {
      method,
      url: `${HOST}${path}`,
      headers: [
        { name: 'Cookie', value: `session=${FILE_CANARY}` },
        { name: 'Authorization', value: `Bearer ${FILE_CANARY}` },
      ],
      postData: { mimeType: 'application/json', text: JSON.stringify({ password: FILE_CANARY }) },
    },
    response: { status: 200, content: { size: 120, text: JSON.stringify(body) } },
  });
  const head = JSON.stringify({
    log: {
      version: '1.2',
      entries: [
        entry('POST', '/auth/login', { token: FILE_CANARY }),
        entry('GET', '/products', { items: [] }),
        entry('POST', '/cart/items', { cartId: 'cart-7731' }),
        entry('POST', '/checkout', { ok: true }),
        entry('GET', '/categories', { items: [] }),
        entry('GET', '/orders', { items: [] }),
      ],
    },
  });
  // The rest of the 38 MB is what a browser records besides the requests: one long comment.
  const padding = 'x'.repeat(SIZE - head.length - ',"comment":""}'.length + 1);
  return `${head.slice(0, -1)},"comment":"${padding}"}`;
}

const JOURNEYS: HarJourney[] = [
  {
    name: 'zakupy',
    steps: ['POST /auth/login', 'GET /products', 'POST /cart/items', 'POST /checkout'],
  },
  { name: 'przeglądanie', steps: ['GET /categories', 'GET /products'] },
  { name: 'konto', steps: ['POST /auth/login', 'GET /orders'] },
];

/** What the backend answers to the upload and the analysis of the recording of run 4. */
const FIXED = {
  upload: {
    duration_ms: 0,
    total_entries: 412,
    filtered_entries: 120,
    excluded_count: 69,
    base_url: HOST,
    detected_auth_pattern: 'bearer_token',
    warnings: [],
    domain_stats: [],
  },
  analysis: {
    action_groups: [
      {
        name: 'zakupy',
        entry_indices: [0, 1, 2],
        start_index: 0,
        end_index: 2,
        entries_summary: [
          { method: 'POST', path: '/auth/login?next=%2Fshop', status: 200 },
          { method: 'GET', path: '/cart', status: 200 },
          { method: 'POST', path: '/orders', status: 201 },
        ],
      },
      {
        name: 'przeglądanie',
        entry_indices: [3],
        start_index: 3,
        end_index: 3,
        entries_summary: [],
      },
      { name: 'konto', entry_indices: [4], start_index: 4, end_index: 4, entries_summary: [] },
    ],
    correlations: [
      ...['authToken', 'csrf', 'userId', 'orderId', 'sessionRef'].map((variable, i) => ({
        source_entry_index: i === 0 ? 0 : 2,
        target_entry_index: i + 1,
        source_json_path: `$.${variable}`,
        target_location: i === 0 ? 'header:Authorization' : 'path:2',
        suggested_session_var: variable,
        confidence: 0.95 - i * 0.01,
      })),
      {
        source_entry_index: 1,
        target_entry_index: 3,
        source_json_path: '$.cartId',
        target_location: 'path:2',
        suggested_session_var: 'cartId',
        confidence: 0.6,
      },
    ],
    evidence_quality: 'full',
    evidence_coverage: { response_body_ratio: 0.9, stripped_response_body_ratio: 0 },
    warnings: [],
  },
};

/** The flows the generator saves for the journeys: "zakupy" with the pauses of the recording. */
function flowsOfTheRecording(): Record<string, FlowDetail> {
  const world = worldFlows();
  const named = (name: string): FlowDetail => {
    const found = world.find((flow) => flow.name === name);
    if (found === undefined) throw new Error(`the world has no flow ${name}`);
    return found;
  };
  return {
    zakupy: { ...fixtureFlow('zakupy-run4-har'), id: SKLEP_IDS.flowZakupy },
    przeglądanie: named('przeglądanie'),
    konto: named('konto'),
  };
}

const STEPS: readonly Step[] = [
  ...setupSteps(
    { name: 'sklep', environments: ENVIRONMENTS },
    {
      ...SETUP_GOLDEN,
      analyze: '01d-project_analyze_setup-without-docs',
      apply: '01e-project_apply_setup-without-docs',
    },
  ),
  {
    tool: 'project_connect_telemetry',
    args: { label: 'sklep-logs', url: 'https://logs-mcp.perf.example.com/mcp' },
    expect: '02-project_connect_telemetry',
  },
  { tool: 'flows_import_har', args: { file: RECORDING }, expect: '03-flows_import_har' },
  {
    tool: 'flows_generate_from_har',
    args: { har: RECORDING, split: true },
    expect: '04-flows_generate_from_har',
    stepMs: 2000,
  },
  ...SCENARIO_AND_DATA,
  {
    tool: 'scenario_check_self',
    args: { scenarios: ['zakupy', 'konto'] },
    expect: '09-scenario_check_self',
  },
  ...RUN_REPORT_DIAGNOSIS,
];

const generated: Record<string, unknown>[] = [];
const cancels: string[] = [];

const OPTIONS: ScriptOptions = {
  run: 'run4',
  runScript: PERF,
  batch: { plans: [] },
  split: SPLIT,
  executionIds: [SKLEP_IDS.executionPerf],
  openapi: null,
  capabilities: ['api_token_sockets'],
  processServices: true,
  files: { ...fixtureFiles(null), [RECORDING]: recording() },
  before: (fake, clock) => {
    registerHarRoutes(fake, {
      clock,
      fixed: FIXED,
      generate: {
        journeys: JOURNEYS,
        flows: flowsOfTheRecording(),
        onGenerate: (body) => generated.push(body),
        onCancel: (_id, how) => cancels.push(how),
      },
    });
  },
};

const WRITES = [
  'POST /projects',
  'POST /projects/:id/environments',
  'POST /projects/:id/environments/:id/test-connection',
  'POST /projects/:id/setup/auto-provision',
  'POST /projects/:id/telemetry-source/test',
  'PUT /projects/:id/telemetry-source',
  'POST /projects/:id/har/upload',
  'POST /projects/:id/har/:id/analyze',
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

describe('run 4 on the fake backend', () => {
  it('every result is the golden text, and the run leaves no secret and no operation behind', async () => {
    generated.length = 0;
    cancels.length = 0;
    const run = await runScript(STEPS, OPTIONS);
    const { rig } = run;
    expect(run.results).toHaveLength(STEPS.length);

    // The recording was sent once: the split reused what `flows_import_har` had sent.
    const uploads = rig.fake.calls.filter((call) => call.path.endsWith('/har/upload'));
    expect(uploads).toHaveLength(1);
    const sessions = rig.fake.store.collection(HAR_SESSIONS).list();
    expect(sessions).toHaveLength(1);

    // One connection of the HAR channel: the generation, then the answer to the proposal.
    expect(generated).toHaveLength(1);
    expect(generated[0]).toMatchObject({ type: 'har:generate' });
    expect(cancels).toEqual([]);

    // The project has no documentation, and its three flows came from the recording.
    const status = await rig.call('process_get_status', {});
    expect(status.isError, status.text).toBe(false);
    expect(status.text).toContain('3 flowy · 3 scenariusze · 1 kompozycja');
    expect(status.text).toMatch(/e-3f9a12c4 {2}checkout {2}SLA FAILED/u);

    expect(writesOf(rig.fake.calls)).toEqual(WRITES);
    expect(rig.fake.calls.some((call) => call.method === 'DELETE')).toBe(false);

    const state = JSON.parse(
      readFileSync(join(rig.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
    ) as { opPayloads: Record<string, unknown> };
    expect(state.opPayloads).toEqual({});

    // The secrets of the recording are in no result, no log line and no file the plugin wrote.
    for (const result of run.results) assertNoCanary(result.calls.map((call) => call.text));
    rig.assertClean();
    expect(readFileSync(join(rig.workspace, '.env.perf'), 'utf8')).toContain(CANARY);
    expect(JSON.stringify(rig.lines)).not.toContain(CANARY);
    expect(JSON.stringify(rig.lines)).not.toContain(FILE_CANARY);
  });
});
