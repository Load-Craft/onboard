// Run 3 from a description, end to end on the fake backend: `flows_describe_journeys` with the account of
// `.env.perf`, `flows_record_journeys` (three variants of the walk), then the scenario, the data, the test
// and the report on one continuous state. Each result is compared with its golden text.
//
// A: the walk goes without obstacles. B: the agent asks for help (`needs_user`, then `process_wait` after
// the user handed the browser back). C: the server process is replaced in the middle of the walk
// and `process_wait` rebuilds the state from the backend.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { RigCallResult } from '../helpers/rig.js';
import { assertNoCanary, CANARY, FILE_CANARY } from '../helpers/canary.js';
import { goldenText, SKLEP_IDS } from '../golden/index.js';
import {
  registerDescribeRoutes,
  type DescribeHandles,
  type DescribeWorld,
} from '../fake-backend/routes/describe.js';
import {
  selfCheckDocument as selfCheckDoc,
  type SelfCheckFake,
} from '../fake-backend/routes/selfCheck.js';
import { SKLEP_COLLECTIONS, SKLEP_WORLD_IDS } from '../fake-backend/worlds/sklep.js';
import type { JobStep } from '../fake-backend/jobs.js';
import {
  fixtureFiles,
  runScript,
  setupSteps,
  type RunRows,
  type ScriptOptions,
  type ScriptRun,
  type Step,
} from './driver.js';
import {
  ENVIRONMENTS,
  PERF,
  RUN_REPORT_DIAGNOSIS,
  SCENARIO_AND_DATA,
  SPLIT,
  writesOf,
} from './shared.js';

vi.setConfig({ testTimeout: 120_000 });

const DESCRIPTION =
  'Klient loguje się, szuka produktu, dodaje go do koszyka i płaci kartą, część z kodem ' +
  'rabatowym. Część klientów przegląda katalog, część sprawdza swoje zamówienia.';

const RUN = SKLEP_IDS.recordRun;
const PLAN = `r-${RUN.slice(0, 8)}`;
const HANDLE = `record_run:${RUN}`;
/** The handshake of a socket has 10 s of the test clock: a step of the driver must be shorter. */
const SOCKET_STEP = 2000;

/** The password of the browser account in `.env.perf`: the sentinel of the customer's file. */
const ENV_FILE = [
  'API_URL=https://api.perf.example.com',
  'WEB_URL=https://perf.example.com',
  'TEST_USER_EMAIL=user@example.com',
  `TEST_USER_PASSWORD=${FILE_CANARY}`,
  '',
].join('\n');

const HEAD: readonly Step[] = [
  ...setupSteps({ name: 'sklep', openapi: 'loadcraft/openapi.json', environments: ENVIRONMENTS }),
  {
    tool: 'project_connect_telemetry',
    args: { label: 'sklep-logs', url: 'https://logs-mcp.perf.example.com/mcp' },
    expect: '02-project_connect_telemetry',
  },
  {
    tool: 'flows_describe_journeys',
    args: {
      description: DESCRIPTION,
      environment: 'perf',
      account: { from_env: '.env.perf' },
    },
    expect: '03-flows_describe_journeys',
    stepMs: SOCKET_STEP,
  },
];

const TAIL: readonly Step[] = [
  ...SCENARIO_AND_DATA,
  {
    tool: 'scenario_check_self',
    args: { scenarios: ['zakupy', 'konto'] },
    expect: '09-scenario_check_self-rabat',
    unlinked: true,
  },
  ...RUN_REPORT_DIAGNOSIS,
];

const RECORD_ARGS = { plan: PLAN, paths: 'all' };

const RECORD: Step = {
  tool: 'flows_record_journeys',
  args: RECORD_ARGS,
  expect: '04-flows_record_journeys',
  stepMs: SOCKET_STEP,
};

const STEPS_A: readonly Step[] = [...HEAD, RECORD, ...TAIL];

/** Where the walk is among the results: right after the head (the setup, the logs, the plan). */
const WALK = HEAD.length;

/** The checks of `zakupy` and `konto`: the flow of the description has the step of the coupon. */
const CHECK_RUNS: Readonly<Record<string, RunRows>> = {
  [SKLEP_WORLD_IDS.selfCheckZakupy]: [
    ['logowanie', 1, 0, 200],
    ['wyszukanie', 1, 0, 300],
    ['koszyk', 1, 0, 300],
    ['rabat', 1, 0, 100],
    ['zamówienie', 1, 0, 400],
  ],
};

function planChecks(checks: SelfCheckFake): void {
  const step = <S>(afterMs: number, state: S): JobStep<S> => ({ afterMs, state });
  const passed = (runId: string, finishedAt: string) =>
    selfCheckDoc({
      status: 'passed',
      execution_ids: [runId],
      started_at: '2026-11-22T10:19:55Z',
      finished_at: finishedAt,
    });
  checks.plan(SKLEP_WORLD_IDS.scenarios.zakupy, [
    step(0, selfCheckDoc({})),
    step(
      2000,
      selfCheckDoc({ status: 'running', execution_ids: [SKLEP_WORLD_IDS.selfCheckZakupy] }),
    ),
    step(5000, passed(SKLEP_WORLD_IDS.selfCheckZakupy, '2026-11-22T10:20:03Z')),
  ]);
  checks.plan(SKLEP_WORLD_IDS.scenarios.konto, [
    step(0, selfCheckDoc({})),
    step(
      4000,
      selfCheckDoc({ status: 'running', execution_ids: [SKLEP_WORLD_IDS.selfCheckKonto] }),
    ),
    step(9000, passed(SKLEP_WORLD_IDS.selfCheckKonto, '2026-11-22T10:21:02Z')),
  ]);
}

interface World {
  handles?: DescribeHandles;
}

function options(world: DescribeWorld, seen: World): ScriptOptions {
  return {
    run: 'run3',
    runScript: PERF,
    batch: { plans: [] },
    split: SPLIT,
    executionIds: [SKLEP_IDS.executionPerf],
    capabilities: ['api_token_sockets'],
    checkRuns: CHECK_RUNS,
    checks: planChecks,
    files: { ...fixtureFiles(), '.env.perf': ENV_FILE },
    before: (fake) => {
      seen.handles = registerDescribeRoutes(fake, { runIds: [RUN], ...world });
    },
  };
}

/** The writes of run 3 up to the walk: the start of the run, nothing else from the description. */
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
  'POST /projects/:id/scenario-from-description/generate',
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

/** The project `project_create` made; the golden texts carry the project of the world instead. */
function projectOf(rig: ScriptRun['rig']): string {
  const [project] = rig.fake.store.collection<{ id: string }>(SKLEP_COLLECTIONS.projects).list();
  if (project === undefined) throw new Error('no project on the fake backend');
  return project.id;
}

/** The text of a result with the project of the world, the way the golden texts show it. */
const inWorld = (rig: ScriptRun['rig'], text: string): string =>
  text.replaceAll(projectOf(rig), SKLEP_IDS.project);

/** The run's channel on the fake. */
function channelOf(rig: ScriptRun['rig']) {
  return rig.fake.channel('describe', { project_id: projectOf(rig), run_id: RUN });
}

const statusesOf = (calls: readonly RigCallResult[]): (string | undefined)[] =>
  calls.map((call) => call.outcome?.status);

const progressOf = (calls: readonly RigCallResult[]): string[] =>
  calls.flatMap((call) => call.progress.map((entry) => entry.message ?? ''));

/** What every variant must leave behind: a state without operations, no secret anywhere. */
function expectEndState(run: ScriptRun, handles: DescribeHandles | undefined): void {
  const { rig } = run;
  expect(handles?.runs).toEqual([RUN]);
  // One approval in all, with the paths as the planner proposed them.
  expect(handles?.approvals).toHaveLength(1);
  expect(handles?.approvals[0]?.map((path) => path['name'])).toEqual([
    'zakupy',
    'przeglądanie',
    'konto',
  ]);
  // The account of the file went to the backend in the body of the start, and only there.
  expect(handles?.bodies).toHaveLength(1);
  expect(JSON.stringify(handles?.bodies[0])).toContain(FILE_CANARY);
  expect(readFileSync(join(rig.workspace, '.env.perf'), 'utf8')).toContain(FILE_CANARY);

  expect(writesOf(rig.fake.calls)).toEqual(WRITES);
  expect(rig.fake.calls.some((call) => call.method === 'DELETE')).toBe(false);
  expect(rig.fake.calls.some((call) => call.path.endsWith('/cancel'))).toBe(false);

  const state = JSON.parse(
    readFileSync(join(rig.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as { opPayloads: Record<string, unknown> };
  expect(state.opPayloads).toEqual({});

  // The password of the account and the token: in no result, no log line, no file, no socket.
  for (const result of run.results) assertNoCanary(result.calls.map((call) => call.text));
  rig.assertClean();
  expect(JSON.stringify(rig.lines)).not.toContain(CANARY);
  expect(JSON.stringify(rig.lines)).not.toContain(FILE_CANARY);
  const channel = channelOf(rig);
  // The channel did carry the walk (the approval was sent on it), and nothing secret went over it.
  expect(channel.received.length).toBeGreaterThan(0);
  expect(channel.addresses.length).toBeGreaterThan(0);
  assertNoCanary(channel.received, channel.addresses);
}

describe('run 3 on the fake backend', () => {
  it('A: every result is the golden text, three flows, one approval, no secret left behind', async () => {
    const seen: World = {};
    const run = await runScript(STEPS_A, options({}, seen));
    const { rig } = run;
    expect(run.results).toHaveLength(STEPS_A.length);

    // The plan waits for the approval, the walk is one call that shows its progress.
    const walk = run.results[WALK];
    expect(statusesOf(walk?.calls ?? [])).toEqual(['done']);
    expect(progressOf(walk?.calls ?? [])).toContain(
      goldenText('run3', '04-flows_record_journeys-postep').trim(),
    );
    for (const message of progressOf(walk?.calls ?? [])) expect(message).not.toContain('gotowy');

    const status = await rig.call('process_get_status', {});
    expect(status.isError, status.text).toBe(false);
    expect(status.text).toContain('3 flowy · 3 scenariusze · 1 kompozycja');
    expectEndState(run, seen.handles);
  });

  it('A: flows_describe_journeys shown again gives the same plan and does not open the run again', async () => {
    const seen: World = {};
    const describe = HEAD.at(-1);
    if (describe === undefined) throw new Error('no describe step');
    const steps: readonly Step[] = [...HEAD, { ...describe, expect: '03-flows_describe_journeys' }];
    const run = await runScript(steps, options({}, seen));
    expect(run.results).toHaveLength(steps.length);
    expect(seen.handles?.runs).toEqual([RUN]);
    expect(seen.handles?.bodies).toHaveLength(1);
    expect(seen.handles?.approvals).toEqual([]);
    // The second answer is the first one: the plan from the cache.
    expect(run.results[WALK]?.last.text).toBe(run.results[WALK - 1]?.last.text);
  });

  it('B: the agent asks for help, process_wait says needs_user until the browser is handed back, then the golden text', async () => {
    const seen: World = {};
    // The user's part was a second factor: the path is saved whole, and the result adds the
    // warning that the load test cannot pass that step. The rest is the golden text.
    const steps = STEPS_A.map((step) =>
      step.expect === '04-flows_record_journeys' ? { ...step, contains: '3 flowy zapisane' } : step,
    );
    const run = await runScript(
      steps,
      options(
        {
          walk: {
            zakupy: {
              help: {
                atStep: 1,
                reason: 'second_factor',
                agentSays: 'Podaj kod z SMS',
                returnedAfterMs: 150_000,
              },
            },
          },
        },
        seen,
      ),
    );
    const { rig } = run;
    expect(run.results).toHaveLength(steps.length);

    const walk = run.results[WALK];
    expect(inWorld(rig, walk?.last.text ?? '')).toBe(
      goldenText('run3', '04-flows_record_journeys')
        .trimEnd()
        .replace(
          '3 flowy zapisane',
          '⚠ zakupy: logowanie dwuskładnikowe — test obciążeniowy nie przejdzie tego\n' +
            '  kroku; wyłącz go na środowisku testowym\n3 flowy zapisane',
        ),
    );
    const statuses = statusesOf(walk?.calls ?? []);
    // The first call asks the user for help; the model continues with `process_wait` on the same handle.
    expect(statuses[0]).toBe('needs_user');
    expect(statuses.at(-1)).toBe('done');
    expect(walk?.calls.length).toBeGreaterThan(1);
    const first = walk?.calls[0];
    expect(first?.text).toContain('Podaj kod z SMS');
    expect(inWorld(rig, first?.text ?? '')).toContain(
      `↗ podgląd na żywo: https://app.loadcraft.io/projects/${SKLEP_IDS.project}/scenario-from-description/runs/${RUN}`,
    );
    expect(first?.text).toContain(HANDLE);
    // Waiting never approves again: one approval, one start, no cancel.
    expect(seen.handles?.approvals).toHaveLength(1);
    // The server never connected to the live preview.
    const channel = channelOf(rig);
    for (const address of channel.addresses) expect(address).not.toMatch(/\/live/u);
    expectEndState(run, seen.handles);
  });

  it('C: a new server process in the middle of the walk, process_wait rebuilds the state and ends with the golden text', async () => {
    const seen: World = {};
    const steps: readonly Step[] = [
      ...HEAD,
      {
        ...RECORD,
        args: { ...RECORD_ARGS, max_wait_s: 5 },
        contains: HANDLE,
        once: true,
      },
      {
        tool: 'process_wait',
        args: { operation: HANDLE },
        expect: '04-flows_record_journeys',
        restart: true,
      },
      ...TAIL,
    ];
    const run = await runScript(steps, options({}, seen));
    const { rig } = run;
    expect(run.results).toHaveLength(steps.length);

    // The first process left the walk running; the second one found it by the handle in the file.
    expect(statusesOf(run.results[WALK]?.calls ?? [])).toEqual(['running']);
    expect(statusesOf(run.results[WALK + 1]?.calls ?? []).at(-1)).toBe('done');
    // The walk was approved once, by the first process, and followed to the end by the second.
    expect(seen.handles?.approvals).toHaveLength(1);
    const socket = channelOf(rig);
    expect(
      socket.received.filter((m) => (m as { type?: string }).type === 'split_resume'),
    ).toHaveLength(1);
    expect(socket.opened).toBeGreaterThanOrEqual(2);
    expectEndState(run, seen.handles);
  });
});
