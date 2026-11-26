// The fake backend the live gate runs against in `--fake` mode (`scripts/live-gate.ts`): run 1 of
// the `sklep` world, from an empty instance, on a clock that runs `speed` times faster than the
// real one. The gate talks to it over HTTP exactly as it talks to a real backend, so the steps,
// the reads that check their effects and the report are the same code in both modes.
//
// Two things differ from the end-to-end driver, because the gate is a separate process: a run
// ends by itself when its script says so (nobody tells the fake), and the record of a finished run
// carries the load the plugin actually sent, the way the backend's run manifest does, so the
// gate's check of the clamped load reads what was started, not a figure of the world.

import { readFileSync } from 'node:fs';

import type { components } from '../../src/http/generated/api.js';
import type { Clock } from '../../src/ops/clock.js';
import { SKLEP_IDS } from '../golden/index.js';
import { createFastClock } from '../fake-backend/fastClock.js';
import { registerBatchGenerateRoute } from '../fake-backend/routes/batch.js';
import { registerCompositionRoutes } from '../fake-backend/routes/compositions.js';
import { registerDataRoutes, seedAutoDatasets } from '../fake-backend/routes/data.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
} from '../fake-backend/routes/documentation.js';
import {
  planExecutionIds,
  registerExecutionRoutes,
  scriptRuns,
  startedRuns,
  type RunScript,
  type StartedRun,
} from '../fake-backend/routes/executions.js';
import {
  registerAnalysisReadRoute,
  registerAnalysisStartRoute,
  registerErrorGroupsRoute,
} from '../fake-backend/routes/analysis.js';
import {
  registerDescribeRoutes,
  SKLEP_PROPOSAL,
  type DescribeHandles,
  type DescribeWorld,
  type ProposedPath,
} from '../fake-backend/routes/describe.js';
import { registerFlowRoutes } from '../fake-backend/routes/flows.js';
import { registerHarRoutes, type HarJourney } from '../fake-backend/routes/har.js';
import { registerLookupRoutes } from '../fake-backend/routes/lookup.js';
import { registerProjectRoutes } from '../fake-backend/routes/projects.js';
import { registerProvisionRoutes, setFakeProvision } from '../fake-backend/routes/provision.js';
import { registerResultRoutes } from '../fake-backend/routes/results.js';
import {
  registerScenarioBuilderRoutes,
  scriptBuilderModel,
} from '../fake-backend/routes/scenarioBuilder.js';
import {
  generatedScenarioHooks,
  MINUTES_PER_FLOW,
  registerScenarioRoutes,
  registerTestTypeRoutes,
} from '../fake-backend/routes/scenarios.js';
import {
  failureDocument,
  registerSelfCheckRoutes,
  selfCheckReadsOwnPicks,
  selfCheckDocument,
} from '../fake-backend/routes/selfCheck.js';
import { registerSetupRoutes } from '../fake-backend/routes/setup.js';
import { registerStatusRoutes } from '../fake-backend/routes/status.js';
import {
  registerOpenapiReadRoute,
  registerSuggestionRoutes,
  SKLEP_SUGGESTIONS,
} from '../fake-backend/routes/suggestions.js';
import { registerTelemetryRoutes } from '../fake-backend/routes/telemetry.js';
import {
  startFake,
  type Fake,
  type FakeRequest,
  type FakeResponse,
  type Jobs,
  type Store,
} from '../fake-backend/server.js';
import { createIdSource, createStore } from '../fake-backend/store.js';
import { FILE_CANARY, HEADER_CANARY } from '../helpers/canary.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepExecution,
  type SklepExecutionAnalysis,
  type SklepExecutionResult,
  type SklepScenario,
  type SklepSlot,
} from '../fake-backend/worlds/sklep.js';
import { catching, fixtureFiles, nameSteps, planChecks, worldFlows } from './driver.js';

type FlowDetail = components['schemas']['FlowDetail'];
type Handler = (req: FakeRequest, store: Store, jobs: Jobs) => FakeResponse | Promise<FakeResponse>;

/** Faults the gate's own test plants to see the gate fail at the right step. */
export const GATE_FAULTS = [
  'self-check-failed',
  'run-over-limit',
  'leftover-project',
  'har-one-flow',
  'har-no-pauses',
  'describe-one-path',
  'describe-none-saved',
  'describe-no-pauses',
  'describe-help',
  'describe-echo-password',
  'describe-long-walk',
  'describe-channel-blocked',
  'probes-ignored',
  'provision-fails',
  'data-no-source',
] as const;
export type GateFault = (typeof GATE_FAULTS)[number];

export interface GateFakeOptions {
  /** Port to listen on; 0 picks a free one. */
  readonly port: number;
  /** How many times faster than the real clock the fake's clock runs. */
  readonly speed: number;
  readonly token: string;
  readonly fault?: GateFault;
  /** Tests run for hours (fake time), so a limit of the gate stops one that is under way. */
  readonly longRuns?: boolean;
}

const ZAKUPY = JSON.parse(
  readFileSync(new URL('../fixtures/flows/zakupy-run1.json', import.meta.url), 'utf8'),
) as FlowDetail;

/** A short test: built in 4 s, a minute of load, completed (in fake time). */
const RUN: RunScript = {
  createdBeforeS: 1,
  startsAtS: 4,
  loadS: 60,
  end: 'completed',
  live: (elapsed) => ({ rps: 2 + elapsed / 10, p95: 300, errorRate: 0.004 }),
  final: { rps: 8, p95: 320, errorRate: 0.004 },
  series: [1, 3, 5, 7, 8, 8],
};

/**
 * The slot of plain data the generation of a scenario built from an OpenAPI flow leaves without
 * rows: its contract only (`generate_feeder_data_node.py` writes no content without the flow's
 * DataPack), so the data hub's model, not the generation, would have to fill it. The gate meets it
 * in the shopping scenario: `data_create_dataset` with the slot makes its rows from the slot's columns.
 */
export const CONTENTLESS_SLOT: SklepSlot = {
  slot: 'scenario_auto_data',
  label: 'Coupon & email & notes',
  columns: ['couponCode', 'email', 'notes'],
  strategy: 'circular',
  column_specs: [
    { name: 'couponCode', type: 'string' },
    { name: 'email', type: 'email' },
    { name: 'notes', type: 'string' },
  ],
  identity_kind: null,
  default_file: 'scenario_auto_data.csv',
  role: 'data',
  generated: false,
  generated_rows: null,
};

/**
 * The shopping scenario (the one with an order) also reads the slot of plain data without rows.
 * With `noSource`, the account scenario reads it too, with a column the shopping one lacks: no
 * member has every column, so nothing can make the rows and only a file fills the slot.
 */
function withContentlessSlot(scenario: SklepScenario, noSource: boolean): SklepScenario {
  const names = scenario.feeder_slots.map((slot) => slot.slot);
  if (names.includes(CONTENTLESS_SLOT.slot)) return scenario;
  const shopping = names.includes('order_details');
  const account = noSource && names.length === 1 && names[0] === 'accounts';
  if (!shopping && !account) return scenario;
  const slot: SklepSlot = shopping
    ? structuredClone(CONTENTLESS_SLOT)
    : { ...structuredClone(CONTENTLESS_SLOT), columns: ['couponCode', 'voucher'] };
  return {
    ...scenario,
    feeder_slots: [...scenario.feeder_slots, slot],
    scenario_artifact: {
      ...scenario.scenario_artifact,
      feeders: [
        ...scenario.scenario_artifact.feeders,
        {
          feeder_type: 'csv',
          file: CONTENTLESS_SLOT.default_file,
          strategy: CONTENTLESS_SLOT.strategy,
          columns: [...slot.columns],
          role: 'data',
          content: null,
          record_count: null,
        },
      ],
    },
  };
}

/** A test that is still loading when a limit of the gate stops it. */
const LONG_RUN: RunScript = { ...RUN, loadS: 36_000 };

/** How the model of the fake splits the traffic when it proposes the composition. */
const SPLIT = [
  { flow: 'przeglądanie', proportion: 60 },
  { flow: 'zakupy', proportion: 30 },
  { flow: 'konto', proportion: 10 },
];

const EXECUTION = '/api/v1/projects/{project_id}/gatling/executions/{execution_id}';
const LIST = '/api/v1/projects/{project_id}/gatling/executions';

/** Registers `register` with one route caught instead of registered; returns its handler. */
function catchRoute(fake: Fake, key: string, register: () => void): Handler {
  let caught: Handler | undefined;
  const original = fake.route.bind(fake) as (...args: unknown[]) => void;
  const holder = fake as { route: unknown };
  holder.route = (method: string, path: string, handler: Handler, ...rest: unknown[]): void => {
    if (`${method} ${path}` === key) {
      caught = handler;
      return;
    }
    original(method, path, handler, ...rest);
  };
  try {
    register();
  } finally {
    holder.route = original;
  }
  if (caught === undefined) throw new Error(`no handler caught for ${key}`);
  return caught;
}

/**
 * The run manifest of a started run: the load and the environment of its start request. With the
 * fault `run-over-limit` a run on an environment with a user limit records one user more than the
 * limit, as if more load had been started than the environment allows.
 */
function manifestOf(
  fake: Fake,
  run: StartedRun,
  fault: GateFault | undefined,
): Record<string, unknown> {
  const workload = run.workload;
  const limit =
    fault === 'run-over-limit' && run.environment_id !== null
      ? fake.store
          .collection<{ id: string; workload_caps: { max_vu?: number | null } | null }>(
            SKLEP_COLLECTIONS.environments,
          )
          .get(run.environment_id)?.workload_caps?.max_vu
      : undefined;
  return {
    workload:
      workload === null
        ? null
        : {
            kind: 'adr005',
            value: {
              type: workload.type,
              vusers: typeof limit === 'number' ? limit + 1 : workload.vusers,
              ramp: workload.ramp ?? 0,
              hold: workload.hold ?? 0,
            },
          },
    // What the start request does not say stays null, as for a manifest written before the load.
    proportions: null,
    target_base_url: null,
    target_environment_id: run.environment_id,
    target_environment_name: null,
    members: null,
    feeders: null,
  };
}

/**
 * The two run routes. A started run follows the script; once the script ends it, a run the world
 * keeps a record for (the first test of the gate) becomes that record, so the report and the
 * diagnosis read the finished test, with the manifest of what was really started. A run the world
 * has no record for stays the scripted row, with the same manifest.
 */
function registerGateRunRoutes(
  fake: Fake,
  clock: Clock,
  fault: GateFault | undefined,
  script: RunScript,
  storedList: Handler,
): void {
  const scripted = new Map<string, Handler>();
  const stored = new Map<string, Handler>();
  catching(fake, scripted, () => {
    registerExecutionRoutes(fake);
    scriptRuns(fake, clock, script);
  });
  catching(fake, stored, () => {
    registerResultRoutes(fake);
  });
  const handler = (map: Map<string, Handler>, key: string): Handler => {
    const found = map.get(key);
    if (found === undefined) throw new Error(`no handler caught for ${key}`);
    return found;
  };
  const liveRow = handler(scripted, `GET ${EXECUTION}`);
  const liveResult = handler(scripted, `GET ${EXECUTION}/result`);
  const doneRow = handler(stored, `GET ${EXECUTION}`);
  const doneResult = handler(stored, `GET ${EXECUTION}/result`);

  const world = createStore(createIdSource(1));
  seedSklep(world, { stage: 'executed' });
  const adopted = new Set<string>();
  const adopt = (run: StartedRun): boolean => {
    if (adopted.has(run.id)) return true;
    const record = world.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).get(run.id);
    const result = world.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results).get(run.id);
    if (record === undefined || result === undefined) return false;
    fake.store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).insert({
      ...record,
      run_manifest: { ...record.run_manifest, ...manifestOf(fake, run, fault) },
    });
    fake.store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results).insert(result);
    for (const analysis of world
      .collection<SklepExecutionAnalysis>(SKLEP_COLLECTIONS.analyses)
      .list((item) => item.execution_id === run.id)) {
      fake.store.collection<SklepExecutionAnalysis>(SKLEP_COLLECTIONS.analyses).insert(analysis);
    }
    adopted.add(run.id);
    return true;
  };
  const startedRun = (id: string | undefined): StartedRun | undefined =>
    startedRuns(fake).find((run) => run.id === id);

  const route = fake.route.bind(fake) as (...args: unknown[]) => void;
  route('GET', EXECUTION, async (req: FakeRequest, store: Store, jobs: Jobs) => {
    const run = startedRun(req.params.execution_id);
    if (run === undefined) return doneRow(req, store, jobs);
    if (adopted.has(run.id)) return doneRow(req, store, jobs);
    const live = await liveRow(req, store, jobs);
    const body = live.body as Record<string, unknown>;
    // Only a completed run becomes the world's record; a cancelled one stays what it is.
    if (body.status === 'completed' && adopt(run)) return doneRow(req, store, jobs);
    return {
      ...live,
      body: { ...body, run_manifest: manifestOf(fake, run, fault), run_manifest_state: 'captured' },
    };
  });
  // The list of runs holds the runs under way as well, as the backend's does: the gate finds a run
  // it has no handle for there and cancels it by its id.
  route('GET', LIST, async (req: FakeRequest, store: Store, jobs: Jobs) => {
    const listed = await storedList(req, store, jobs);
    const body = listed.body as { executions: Record<string, unknown>[]; total: number };
    const live: Record<string, unknown>[] = [];
    for (const run of startedRuns(fake)) {
      if (adopted.has(run.id)) continue;
      const row = await liveRow(
        { ...req, params: { ...req.params, execution_id: run.id } },
        store,
        jobs,
      );
      // The list row is the run row without its log, plus whether a result is stored, who drives the
      // run, where it came from and the saved run it belongs to.
      const fields = Object.fromEntries(
        Object.entries(row.body as Record<string, unknown>).filter(([key]) => key !== 'logs'),
      );
      live.unshift({
        ...fields,
        has_result: false,
        saved_run_id: null,
        saved_run_name: null,
        source: null,
        supervised: true,
        run_manifest: manifestOf(fake, run, fault),
        run_manifest_state: 'captured',
      });
    }
    const executions = [...live, ...body.executions];
    return { status: 200, body: { executions, total: executions.length } };
  });
  route('GET', `${EXECUTION}/result`, (req: FakeRequest, store: Store, jobs: Jobs) => {
    const run = startedRun(req.params.execution_id);
    if (run === undefined || adopted.has(run.id)) return doneResult(req, store, jobs);
    return liveResult(req, store, jobs);
  });
}

/** `DELETE /api/v1/projects/{id}`: the gate removes the project it made when it passes. */
function registerProjectDelete(fake: Fake): void {
  const route = fake.route.bind(fake) as (...args: unknown[]) => void;
  route('DELETE', '/api/v1/projects/{project_id}', (req: FakeRequest, store: Store) => {
    const id = req.params.project_id ?? '';
    const projects = store.collection<{ id: string }>(SKLEP_COLLECTIONS.projects);
    projects.require(id, `Project not found: ${id}`);
    projects.delete(id);
    return { status: 200, body: { deleted: true, message: 'Project deleted' } };
  });
}

/** The check of `zakupy` ends in a failure: the gate must stop at the self-check. */
function plantSelfCheckFailure(fake: Fake): void {
  registerSelfCheckRoutes(fake).plan(SKLEP_WORLD_IDS.scenarios.zakupy, [
    { afterMs: 0, state: selfCheckDocument({}) },
    {
      afterMs: 2000,
      state: selfCheckDocument({
        status: 'running',
        execution_ids: [SKLEP_WORLD_IDS.selfCheckZakupy],
      }),
    },
    {
      afterMs: 5000,
      state: selfCheckDocument({
        status: 'failed',
        execution_ids: [SKLEP_WORLD_IDS.selfCheckZakupy],
        failure: failureDocument('koszyk', 'status 500 != 201'),
        started_at: '2026-11-22T10:19:55Z',
        finished_at: '2026-11-22T10:20:03Z',
      }),
    },
  ]);
}

/** Name of the project an earlier gate run left behind (fault `leftover-project`). */
export const LEFTOVER_PROJECT = 'sklep-20261122-100000';

/** A project of an earlier gate run is still there: the gate must refuse to start next to it. */
function plantLeftoverProject(fake: Fake): void {
  const scratch = createStore(createIdSource(7));
  seedSklep(scratch, { stage: 'project' });
  const [project] = scratch
    .collection<{ id: string; name: string }>(SKLEP_COLLECTIONS.projects)
    .list();
  if (project === undefined) throw new Error('the sklep world has no project to copy');
  fake.store
    .collection<{ id: string; name: string }>(SKLEP_COLLECTIONS.projects)
    .insert({ ...project, id: '0d6e2b84-5a1c-4f97-8e30-b2c9d4a7f165', name: LEFTOVER_PROJECT });
}

/** Journeys the fake finds in the recording of the gate; their names differ from the journeys of the documentation. */
const RECORDED_JOURNEYS: HarJourney[] = [
  {
    name: 'nagranie-zakupy',
    steps: ['POST /auth/login', 'GET /products', 'POST /cart/items', 'POST /checkout'],
  },
  { name: 'nagranie-przegladanie', steps: ['GET /categories', 'GET /products'] },
  { name: 'nagranie-konto', steps: ['POST /auth/login', 'GET /orders'] },
];

/** A path of the plan the gate must leave out: it deletes an account. */
const ACCOUNT_REMOVAL: ProposedPath = {
  name: 'account removal',
  steps: ['settings', 'delete the account'],
  depends_on_prior: false,
  needs_verify: false,
  mutates: true,
  creates_own_identity: false,
  rationale: 'Usunięcie konta',
};

/** The login of the browser account in the env file of the target. */
const ACCOUNT_EMAIL = 'user@example.com';

/**
 * The run of a description in the gate's world: the three paths of run 3 and one the gate leaves
 * out, walked without obstacles; each fault changes one thing the gate must notice.
 */
function describeWorld(fault: GateFault | undefined): DescribeWorld {
  const paths = [...SKLEP_PROPOSAL, ACCOUNT_REMOVAL];
  switch (fault) {
    case 'describe-one-path':
      return { paths: SKLEP_PROPOSAL.slice(0, 1) };
    case 'describe-none-saved':
      return {
        paths,
        walk: Object.fromEntries(
          SKLEP_PROPOSAL.map((path) => [path.name, { outcome: 'failed' as const }]),
        ),
      };
    case 'describe-help':
      return {
        paths,
        walk: {
          // The agent repeats the password it typed: the plugin must mask it in the request too.
          zakupy: {
            help: {
              atStep: 1,
              reason: 'second_factor',
              agentSays: `Hasło ${FILE_CANARY} przyjęte, podaj kod z SMS`,
            },
          },
        },
      };
    case 'describe-echo-password':
      // The backend repeats the password of the account in the reason of a failed path.
      return {
        paths,
        walk: {
          konto: {
            outcome: 'failed',
            failure: `Logowanie nie powiodło się: ${ACCOUNT_EMAIL} / ${FILE_CANARY}`,
          },
        },
      };
    case 'describe-long-walk':
      // Two hundred steps a path: the walk is under way for minutes of the fake's clock.
      return {
        paths: paths.map((path) => ({
          ...path,
          steps: Array.from(
            { length: 200 },
            (_, i) => `${path.steps[i % path.steps.length] ?? path.name} ${String(i + 1)}`,
          ),
        })),
      };
    default:
      return { paths };
  }
}

const FLOW = '/api/v1/projects/{project_id}/flows/{flow_id}';

/**
 * The flows the walk saved come without the pauses of a person (fault `describe-no-pauses`): their
 * pauses read as taken from a recording, the other flows stay as they are.
 */
function registerFlowsWithoutPersonPauses(fake: Fake): void {
  const detail = catchRoute(fake, `GET ${FLOW}`, () => {
    registerFlowRoutes(fake);
  });
  const route = fake.route.bind(fake) as (...args: unknown[]) => void;
  route('GET', FLOW, async (req: FakeRequest, store: Store, jobs: Jobs) => {
    const answer = await detail(req, store, jobs);
    const body = answer.body as FlowDetail;
    if (body.generated_by !== 'scenario_from_description') return answer;
    return {
      ...answer,
      body: {
        ...body,
        blocks: body.blocks.map((block) =>
          block['type'] === 'pause'
            ? { ...block, config: { ...(block['config'] as object), source: 'recording' } }
            : block,
        ),
      },
    };
  });
}

const describeRuns = new WeakMap<Fake, DescribeHandles>();

const DESCRIBE_RUNS = '/api/v1/projects/{project_id}/scenario-from-description/runs';
const DESCRIBE_START = '/api/v1/projects/{project_id}/scenario-from-description/generate';
type RunDetails = components['schemas']['RunDetailsResponse'];
type RunSummary = components['schemas']['RunSummaryResponse'];

/**
 * The routes of a description, and the list of its runs (`GET …/runs`, the caller's own runs, as
 * `RunSummaryResponse`): the gate finds the run of a plan there, and the runs to stop when it ends.
 * Every row is the run as its own route reads it.
 */
function registerGateDescribeRoutes(fake: Fake, fault: GateFault | undefined): void {
  let handles: DescribeHandles | undefined;
  let generate: Handler | undefined;
  const detail = catchRoute(fake, `GET ${DESCRIBE_RUNS}/{run_id}`, () => {
    if (fault !== 'describe-channel-blocked') {
      handles = registerDescribeRoutes(fake, describeWorld(fault));
      return;
    }
    generate = catchRoute(fake, `POST ${DESCRIBE_START}`, () => {
      handles = registerDescribeRoutes(fake, describeWorld(fault));
    });
  });
  if (handles === undefined) throw new Error('the routes of a description were not registered');
  const known = handles;
  describeRuns.set(fake, known);
  const route = fake.route.bind(fake) as (...args: unknown[]) => void;
  route('GET', `${DESCRIBE_RUNS}/{run_id}`, detail);
  const start = generate;
  if (start !== undefined) {
    // The run starts, but no WebSocket opens from then on: the plan cannot be taken.
    route('POST', DESCRIBE_START, (req: FakeRequest, store: Store, jobs: Jobs) => {
      fake.faults.blockWebSocket();
      return start(req, store, jobs);
    });
  }
  route('GET', DESCRIBE_RUNS, async (req: FakeRequest, store: Store, jobs: Jobs) => {
    const all = req.query['status'] === 'all';
    const limit = Number(req.query['limit'] ?? '20');
    const runs: RunSummary[] = [];
    for (const id of [...known.runs].reverse()) {
      const answer = await detail({ ...req, params: { ...req.params, run_id: id } }, store, jobs);
      const row = answer.body as RunDetails;
      if (!all && row.status !== 'queued' && row.status !== 'running') continue;
      runs.push({
        run_id: id,
        status: row.status,
        created_at: new Date(jobs.find(id)?.startedAt ?? 0).toISOString(),
        current_step: row.current_step ?? null,
        description_excerpt: (row.description ?? '').slice(0, 120),
        awaiting_split_approval: row.awaiting_split_approval ?? false,
        last_heartbeat_at: null,
      });
    }
    return { status: 200, body: { runs: runs.slice(0, limit) } };
  });
}

/** What the fake saw of the runs of a description: the starts, the approvals and the stops. */
export function describeFacts(fake: Fake): {
  runs: number;
  approvals: string[][];
  passwords: string[];
  stops: number;
} {
  const handles = describeRuns.get(fake);
  if (handles === undefined) return { runs: 0, approvals: [], passwords: [], stops: 0 };
  let stops = 0;
  for (const project of fake.store.collection<{ id: string }>(SKLEP_COLLECTIONS.projects).list()) {
    for (const run of handles.runs) {
      stops += fake
        .channel('describe', { project_id: project.id, run_id: run })
        .received.filter(
          (message) =>
            typeof message === 'object' &&
            message !== null &&
            (message as { type?: unknown }).type === 'stop',
        ).length;
    }
  }
  return {
    runs: handles.runs.length,
    approvals: handles.approvals.map((paths) => paths.map((path) => String(path['name']))),
    passwords: handles.bodies.flatMap((body) =>
      typeof body.auth_credentials?.password === 'string' ? [body.auth_credentials.password] : [],
    ),
    stops,
  };
}

/** Runs started on the fake so far (a limit fault of the gate waits for the first one). */
export function runsStarted(fake: Fake): number {
  return startedRuns(fake).length;
}

/** Starts the fake of the gate; the caller closes it. */
export async function startGateFake(options: GateFakeOptions): Promise<Fake> {
  const clock = createFastClock(options.speed);
  const fake = await startFake({
    clock,
    token: options.token,
    port: options.port,
    scope: 'manual',
    meta: {
      capabilities: [
        'meta',
        'provision_environment',
        'provision_register_operation',
        'provision_protected_confirmation',
        'api_token_sockets',
      ],
    },
  });
  registerGateDescribeRoutes(fake, options.fault);
  const storedList = catchRoute(fake, `GET ${LIST}`, () => {
    registerLookupRoutes(fake);
  });
  registerProjectRoutes(fake);
  registerProjectDelete(fake);
  registerSetupRoutes(fake);
  registerOpenapiReadRoute(fake);
  registerApiMapRoute(fake);
  registerConformanceRoute(fake);
  registerTelemetryRoutes(fake);
  registerStatusRoutes(fake);
  registerSuggestionRoutes(fake, SKLEP_SUGGESTIONS);
  registerBatchGenerateRoute(
    fake,
    {
      plans: [
        { name: 'zakupy', flow: ZAKUPY },
        ...worldFlows()
          .filter((flow) => flow.name !== 'zakupy')
          .map((flow) => ({ name: flow.name, flow })),
      ],
    },
    clock,
  );
  if (options.fault === 'describe-no-pauses') registerFlowsWithoutPersonPauses(fake);
  else registerFlowRoutes(fake);
  registerScenarioBuilderRoutes(fake);
  scriptBuilderModel(fake, SPLIT);
  planChecks(registerSelfCheckRoutes(fake));
  selfCheckReadsOwnPicks.add(fake);
  if (options.fault === 'self-check-failed') plantSelfCheckFailure(fake);
  registerScenarioRoutes(fake).scriptAll(MINUTES_PER_FLOW);
  generatedScenarioHooks.set(fake, (scenario) =>
    withContentlessSlot(scenario, options.fault === 'data-no-source'),
  );
  registerTestTypeRoutes(fake);
  registerCompositionRoutes(fake);
  registerDataRoutes(fake);
  registerProvisionRoutes(fake);
  // As the backend creates every project: the probes are off until the user switches them on.
  setFakeProvision(fake.store, {
    probes: false,
    ignoreProbesPut: options.fault === 'probes-ignored',
    ...(options.fault === 'provision-fails' ? { failPerBatch: 50 } : {}),
  });
  registerHarRoutes(fake, {
    clock,
    generate: {
      // One journey is no split: the flow of the whole recording, as the backend builds it.
      journeys:
        options.fault === 'har-one-flow' ? RECORDED_JOURNEYS.slice(0, 1) : RECORDED_JOURNEYS,
      pauseSource: options.fault === 'har-no-pauses' ? 'default_human' : 'recording',
    },
  });
  registerGateRunRoutes(
    fake,
    clock,
    options.fault,
    options.longRuns === true ? LONG_RUN : RUN,
    storedList,
  );
  registerErrorGroupsRoute(fake);
  registerAnalysisStartRoute(fake);
  registerAnalysisReadRoute(fake);
  seedSklep(fake.store, { stage: 'empty' });
  seedAutoDatasets(fake.store);
  nameSteps(fake);
  if (options.fault === 'leftover-project') plantLeftoverProject(fake);
  // The first test of the gate is the world's recorded test; the clamped one gets a new id.
  planExecutionIds(fake, [SKLEP_IDS.executionPerf]);
  return fake;
}

/** The files of the synthetic customer repository the gate copies into its workspace. */
export function gateFiles(): Record<string, string> {
  return fixtureFiles();
}

/**
 * The env file of the target application: the account of the LoadCraft browser, whose password is
 * the sentinel `FILE_CANARY`, among other settings of the application the gate does not copy.
 */
export function gateEnvFile(): string {
  return [
    'API_URL=https://api.perf.example.com',
    'WEB_URL=https://perf.example.com',
    `TEST_USER_EMAIL=${ACCOUNT_EMAIL}`,
    `TEST_USER_PASSWORD=${FILE_CANARY}`,
    '',
  ].join('\n');
}

/**
 * The env file of the target with the value of its fixed header, the sentinel `HEADER_CANARY`,
 * among other settings the gate does not copy: the gate must show the value nowhere.
 */
export function gateHeaderEnvFile(): string {
  return ['API_URL=https://api.perf.example.com', `SHOP_API_KEY=${HEADER_CANARY}`, ''].join('\n');
}

const RECORDED_HOST = 'https://perf.example.com';

/**
 * A synthetic recording of the shop: a login with a token, the browsing, the cart and the checkout,
 * with the credentials of a session in the cookie, the header, the bodies and the answers. They are
 * the sentinel `FILE_CANARY`: the gate must show it nowhere.
 */
export function gateRecording(): string {
  const entry = (method: string, path: string, answer: unknown, body?: unknown) => ({
    request: {
      method,
      url: `${RECORDED_HOST}${path}`,
      headers: [
        { name: 'Cookie', value: `session=${FILE_CANARY}` },
        { name: 'Authorization', value: `Bearer ${FILE_CANARY}` },
      ],
      ...(body === undefined
        ? {}
        : { postData: { mimeType: 'application/json', text: JSON.stringify(body) } }),
    },
    response: {
      status: 200,
      headers: [{ name: 'Set-Cookie', value: `refresh=${FILE_CANARY}; Path=/` }],
      content: { size: 120, text: JSON.stringify(answer) },
    },
  });
  return JSON.stringify({
    log: {
      version: '1.2',
      entries: [
        entry('POST', '/auth/login', { token: FILE_CANARY }, { password: FILE_CANARY }),
        entry('GET', '/products', { items: [] }),
        entry('POST', '/cart/items', { cartId: 'cart-7731' }),
        entry('POST', '/checkout', { ok: true }),
        entry('GET', '/categories', { items: [] }),
        entry('GET', '/orders', { items: [] }),
      ],
    },
  });
}
