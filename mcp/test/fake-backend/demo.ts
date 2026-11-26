// Entry of `dist/demo-backend.mjs`: the fake backend on the world "sklep" as a sample LoadCraft for
// the demonstration mode of the server (`LOADCRAFT_DEMO=1`, `src/demo/index.ts`). The world is the
// one the end-to-end tests walk (`test/e2e/driver.ts`): the same routes, the same scripted
// responses of the generators, the same test run, but on a clock that runs faster than the real one
// and with no test around it, so the run of a test ends by itself and its record becomes the
// world's record as soon as the test is over.

import type { components } from '../../src/http/generated/api.js';
import ZAKUPY from '../fixtures/flows/zakupy-run1.json' with { type: 'json' };
import { SKLEP_IDS } from '../golden/index.js';
import type { JobStep } from './jobs.js';
import { registerCompareRoute } from './routes/compare.js';
import { registerDescribeRoutes } from './routes/describe.js';
import { registerFlowGenerationRoutes } from './routes/flowGeneration.js';
import { registerHarRoutes } from './routes/har.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
  registerOpenapiUploadRoute,
} from './routes/documentation.js';
import { registerBatchGenerateRoute } from './routes/batch.js';
import { registerCompositionRoutes } from './routes/compositions.js';
import { registerDataRoutes, seedAutoDatasets } from './routes/data.js';
import {
  planExecutionIds,
  registerExecutionRoutes,
  scriptRuns,
  startedRuns,
  type RunScript,
} from './routes/executions.js';
import {
  registerAnalysisReadRoute,
  registerAnalysisStartRoute,
  registerErrorGroupsRoute,
} from './routes/analysis.js';
import { registerFlowRoutes } from './routes/flows.js';
import { registerLookupRoutes } from './routes/lookup.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerProvisionRoutes } from './routes/provision.js';
import { registerResultRoutes } from './routes/results.js';
import { registerScenarioBuilderRoutes, scriptBuilderModel } from './routes/scenarioBuilder.js';
import {
  MINUTES_PER_FLOW,
  registerScenarioRoutes,
  registerTestTypeRoutes,
} from './routes/scenarios.js';
import {
  registerSelfCheckRoutes,
  selfCheckDocument,
  type SelfCheckDocument,
  type SelfCheckFake,
} from './routes/selfCheck.js';
import { registerSetupRoutes } from './routes/setup.js';
import { registerStatusRoutes } from './routes/status.js';
import {
  registerOpenapiReadRoute,
  registerSuggestionRoutes,
  SKLEP_SUGGESTIONS,
} from './routes/suggestions.js';
import { registerTelemetryRoutes } from './routes/telemetry.js';
import {
  startFake,
  type Fake,
  type FakeRequest,
  type FakeResponse,
  type Jobs,
  type RouteOptions,
  type Store,
} from './server.js';
import { createFastClock } from './fastClock.js';
import { createIdSource, createStore } from './store.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepEndpointRow,
  type SklepExecution,
  type SklepExecutionAnalysis,
  type SklepExecutionResult,
} from './worlds/sklep.js';

type FlowDetail = components['schemas']['FlowDetail'];

/** The only token the sample backend accepts. It exists nowhere else. */
const DEMO_TOKEN = 'demo-token-sample-backend';

interface DemoClock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface DemoBackend {
  readonly url: string;
  readonly token: string;
  close(): Promise<void>;
}

export interface DemoOptions {
  /** How many times faster than real time the clock of the sample backend runs. */
  readonly speed: number;
}

// ---- the world as the end-to-end driver sets it up ------------------------------------------

/** The flows of the world other than `zakupy`, with the identifiers its scenarios are keyed on. */
function worldFlows(): FlowDetail[] {
  const scratch = createStore(createIdSource(1));
  seedSklep(scratch, { stage: 'flows' });
  return scratch.collection<FlowDetail>(SKLEP_COLLECTIONS.flows).list();
}

type RunRows = readonly (readonly [name: string, ok: number, ko: number, ms: number])[];

/** The self-check runs of the three scenarios, their steps named as the golden texts name them. */
function nameSteps(fake: Fake): void {
  const scratch = createStore(createIdSource(1));
  seedSklep(scratch, { stage: 'data' });
  const runs: [string, RunRows][] = [
    [
      SKLEP_IDS.selfCheckExecution,
      [
        ['kategorie', 1, 0, 100],
        ['produkt', 1, 0, 200],
      ],
    ],
    [
      SKLEP_WORLD_IDS.selfCheckZakupy,
      [
        ['logowanie', 1, 0, 200],
        ['wyszukanie', 1, 0, 300],
        ['koszyk', 1, 0, 300],
        ['zamówienie', 1, 0, 400],
      ],
    ],
    [
      SKLEP_WORLD_IDS.selfCheckKonto,
      [
        ['logowanie', 1, 0, 200],
        ['zamówienia', 1, 0, 200],
      ],
    ],
  ];
  for (const [runId, rows] of runs) {
    const source = scratch.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results).get(runId)
      ? runId
      : SKLEP_WORLD_IDS.selfCheckKonto;
    const execution = {
      ...scratch.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).require(source),
      id: runId,
    };
    const result = {
      ...scratch.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results).require(source),
      id: runId,
    };
    const [template] = result.endpoints;
    if (template === undefined) throw new Error('the world has no endpoint row to copy');
    const endpoints: SklepEndpointRow[] = rows.map(([name, ok, ko, ms]) => ({
      ...template,
      name,
      count: ok + ko,
      ok_count: ok,
      ko_count: ko,
      error_count: ko,
      mean_response_time: ms,
    }));
    fake.store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).insert(execution);
    fake.store
      .collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results)
      .insert({ ...result, endpoints });
  }
}

/** What the self-checks of `zakupy` and `konto` do over time once their data is in. */
function planChecks(checks: SelfCheckFake): void {
  const step = <S>(afterMs: number, state: S): JobStep<S> => ({ afterMs, state });
  const passed = (runId: string, finishedAt: string): SelfCheckDocument =>
    selfCheckDocument({
      status: 'passed',
      execution_ids: [runId],
      started_at: '2026-11-22T10:19:55Z',
      finished_at: finishedAt,
    });
  checks.plan(SKLEP_WORLD_IDS.scenarios.zakupy, [
    step(0, selfCheckDocument({})),
    step(
      2000,
      selfCheckDocument({ status: 'running', execution_ids: [SKLEP_WORLD_IDS.selfCheckZakupy] }),
    ),
    step(5000, passed(SKLEP_WORLD_IDS.selfCheckZakupy, '2026-11-22T10:20:03Z')),
  ]);
  checks.plan(SKLEP_WORLD_IDS.scenarios.konto, [
    step(0, selfCheckDocument({})),
    step(
      4000,
      selfCheckDocument({ status: 'running', execution_ids: [SKLEP_WORLD_IDS.selfCheckKonto] }),
    ),
    step(9000, passed(SKLEP_WORLD_IDS.selfCheckKonto, '2026-11-22T10:21:02Z')),
  ]);
}

// ---- the test run ---------------------------------------------------------------------------

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

/** Every test started on the sample backend: 10 minutes of load, p95 over the limit at the end. */
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

const SPLIT = [
  { flow: 'przeglądanie', proportion: 60 },
  { flow: 'zakupy', proportion: 30 },
  { flow: 'konto', proportion: 10 },
];

type Handler = (req: FakeRequest, store: Store, jobs: Jobs) => FakeResponse | Promise<FakeResponse>;

const EXECUTION = '/api/v1/projects/{project_id}/gatling/executions/{execution_id}';
const MOCKUP_REQUESTS = ['POST /checkout', 'POST /cart/items', 'GET /products', 'GET /categories'];

/** Runs `register` with the two run routes caught instead of registered. */
function catching(fake: Fake, caught: Map<string, Handler>, register: () => void): void {
  const original = fake.route.bind(fake) as (...args: unknown[]) => void;
  const holder = fake as { route: unknown };
  holder.route = (method: string, path: string, handler: Handler, options?: RouteOptions): void => {
    const key = `${method} ${path}`;
    if (key === `GET ${EXECUTION}` || key === `GET ${EXECUTION}/result`) {
      caught.set(key, handler);
      return;
    }
    original(method, path, handler, options);
  };
  try {
    register();
  } finally {
    holder.route = original;
  }
}

/**
 * A started test follows the script on the clock; the report and the diagnosis read the record of
 * a finished test, which is the world's record of its run. The two designs own the same two routes,
 * so one route answers each: from the script while the test is on, from the records once it has
 * completed (the record is stored under the id of the test at that moment). A test that was
 * stopped or failed has no record and keeps answering from the script.
 */
function registerRunRoutes(fake: Fake, clock: Pick<DemoClock, 'now' | 'sleep'>): void {
  const scripted = new Map<string, Handler>();
  const stored = new Map<string, Handler>();
  catching(fake, scripted, () => {
    registerExecutionRoutes(fake);
    scriptRuns(fake, clock, PERF);
  });
  catching(fake, stored, () => {
    registerResultRoutes(fake);
  });

  const world = createStore(createIdSource(1));
  seedSklep(world, { stage: 'executed' });
  const finished = new Set<string>();
  const finish = (runId: string): void => {
    if (finished.has(runId)) return;
    finished.add(runId);
    const executions = fake.store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
    const results = fake.store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results);
    const analyses = fake.store.collection<SklepExecutionAnalysis>(SKLEP_COLLECTIONS.analyses);
    executions.insert({
      ...world
        .collection<SklepExecution>(SKLEP_COLLECTIONS.executions)
        .require(SKLEP_IDS.executionPerf),
      id: runId,
    });
    const result = world
      .collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results)
      .require(SKLEP_IDS.executionPerf);
    // The mock-up lists four requests of the test, the world keeps six.
    results.insert({
      ...result,
      id: runId,
      endpoints: result.endpoints.filter((row) => MOCKUP_REQUESTS.includes(row.name)),
    });
    // The fake runs an analysis by copying the one of the world, so one is stored per test.
    for (const analysis of world
      .collection<SklepExecutionAnalysis>(SKLEP_COLLECTIONS.analyses)
      .list((item) => item.execution_id === SKLEP_IDS.executionPerf)) {
      analyses.insert({ ...analysis, id: `${analysis.id}-${runId}`, execution_id: runId });
    }
  };

  const status = (key: string, req: FakeRequest, store: Store, jobs: Jobs): Promise<string> => {
    const live = scripted.get(key);
    if (live === undefined) throw new Error(`no handler caught for ${key}`);
    return Promise.resolve(live(req, store, jobs)).then((response) =>
      String((response.body as { status?: unknown } | undefined)?.status),
    );
  };

  const register = fake.route.bind(fake) as (...args: unknown[]) => void;
  for (const suffix of ['', '/result']) {
    const key = `GET ${EXECUTION}${suffix}`;
    const live = scripted.get(key);
    const done = stored.get(key);
    if (live === undefined || done === undefined) throw new Error(`no handler caught for ${key}`);
    register('GET', `${EXECUTION}${suffix}`, async (req: FakeRequest, store: Store, jobs: Jobs) => {
      const id = req.params.execution_id;
      if (id === undefined || !startedRuns(fake).some((run) => run.id === id)) {
        return done(req, store, jobs);
      }
      if (!finished.has(id)) {
        if ((await status(`GET ${EXECUTION}`, req, store, jobs)) !== 'completed') {
          return live(req, store, jobs);
        }
        finish(id);
      }
      return done(req, store, jobs);
    });
  }
}

// ---- start ----------------------------------------------------------------------------------

/**
 * Starts the sample backend on a random port of the loopback interface, in the world `sklep` as it
 * is before the first step of the session (an empty project list, nothing set up yet).
 */
export async function startDemoBackend(options: DemoOptions): Promise<DemoBackend> {
  const clock = createFastClock(options.speed);
  const fake = await startFake({
    clock,
    token: DEMO_TOKEN,
    scope: 'manual',
    meta: {
      version: '0.0.0-demo',
      capabilities: [
        'meta',
        'provision_environment',
        'provision_register_operation',
        'provision_protected_confirmation',
        'api_token_sockets',
      ],
    },
  });
  try {
    registerLookupRoutes(fake);
    registerProjectRoutes(fake);
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
          { name: 'zakupy', flow: ZAKUPY as unknown as FlowDetail },
          ...worldFlows()
            .filter((flow) => flow.name !== 'zakupy')
            .map((flow) => ({ name: flow.name, flow })),
        ],
      },
      clock,
    );
    registerFlowRoutes(fake);
    registerScenarioBuilderRoutes(fake);
    scriptBuilderModel(fake, SPLIT);
    planChecks(registerSelfCheckRoutes(fake));
    registerScenarioRoutes(fake).scriptAll(MINUTES_PER_FLOW);
    registerTestTypeRoutes(fake);
    registerCompositionRoutes(fake);
    registerDataRoutes(fake);
    registerProvisionRoutes(fake);
    registerRunRoutes(fake, clock);
    registerErrorGroupsRoute(fake);
    registerAnalysisStartRoute(fake);
    registerAnalysisReadRoute(fake);
    // What the walk of the session above does not use (HAR import, description of a journey,
    // comparison of tests, upload of a document) answers as in the fake's own routes.
    registerFlowGenerationRoutes(fake);
    registerHarRoutes(fake);
    registerDescribeRoutes(fake, { runIds: [SKLEP_IDS.recordRun] });
    registerCompareRoute(fake);
    registerOpenapiUploadRoute(fake);
    seedSklep(fake.store, { stage: 'empty' });
    seedAutoDatasets(fake.store);
    nameSteps(fake);
    planExecutionIds(fake, [SKLEP_IDS.executionPerf]);
  } catch (error) {
    await fake.close().catch(() => undefined);
    throw error;
  }
  // An answer that did not match the contract, or a handler that threw, reaches the client as a 500;
  // the reason goes to stderr (the server's log) while the session runs.
  const report = setInterval(() => {
    for (const problem of [...fake.takeViolations(), ...fake.takeErrors()]) {
      process.stderr.write(`demo backend: ${problem.message}\n`);
    }
  }, 500);
  report.unref();
  return {
    url: fake.url,
    token: fake.token,
    close: () => {
      clearInterval(report);
      clock.stop();
      return fake.close().catch((error: unknown) => {
        // Problems not yet reported are raised by close(); the session is over, so they are noted.
        process.stderr.write(
          `demo backend: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      });
    },
  };
}
