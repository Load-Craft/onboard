// Driver of the end-to-end tests: starts the fake backend in the `empty` world, calls the tools of a
// run through the MCP client one after another on one continuous state, and compares the text of
// each result with the golden text. The model sees only that text, so the long steps are continued
// the way a model would: the handle is read from the text and given to the real `process_wait` tool.

import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, onTestFinished } from 'vitest';

import type { components } from '../../src/http/generated/api.js';
import { ALL_TOOLS } from '../../src/tools/index.js';
import { goldenText, SKLEP_IDS, type GoldenRun } from '../golden/index.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
} from '../fake-backend/routes/documentation.js';
import { registerBatchGenerateRoute, type BatchWorld } from '../fake-backend/routes/batch.js';
import { registerCompositionRoutes } from '../fake-backend/routes/compositions.js';
import { registerDataRoutes, seedAutoDatasets } from '../fake-backend/routes/data.js';
import {
  planExecutionIds,
  registerExecutionRoutes,
  scriptRuns,
  startedRuns,
  type RunScript,
  type StartedRun,
} from '../fake-backend/routes/executions.js';
import {
  registerErrorGroupsRoute,
  registerAnalysisReadRoute,
  registerAnalysisStartRoute,
} from '../fake-backend/routes/analysis.js';
import { registerFlowRoutes } from '../fake-backend/routes/flows.js';
import { registerLookupRoutes } from '../fake-backend/routes/lookup.js';
import { registerProjectRoutes } from '../fake-backend/routes/projects.js';
import { registerProvisionRoutes } from '../fake-backend/routes/provision.js';
import { registerResultRoutes } from '../fake-backend/routes/results.js';
import {
  registerScenarioBuilderRoutes,
  scriptBuilderModel,
} from '../fake-backend/routes/scenarioBuilder.js';
import {
  registerScenarioRoutes,
  registerTestTypeRoutes,
} from '../fake-backend/routes/scenarios.js';
import {
  registerSelfCheckRoutes,
  selfCheckDocument,
  type SelfCheckDocument,
  type SelfCheckFake,
} from '../fake-backend/routes/selfCheck.js';
import { registerSetupRoutes } from '../fake-backend/routes/setup.js';
import { registerStatusRoutes } from '../fake-backend/routes/status.js';
import {
  registerOpenapiReadRoute,
  registerSuggestionRoutes,
  SKLEP_SUGGESTIONS,
  type SuggestionWorld,
} from '../fake-backend/routes/suggestions.js';
import { registerTelemetryRoutes } from '../fake-backend/routes/telemetry.js';
import type { JobStep } from '../fake-backend/jobs.js';
import type {
  Fake,
  FakeRequest,
  FakeResponse,
  Jobs,
  RouteOptions,
  Store,
} from '../fake-backend/server.js';
import { createIdSource, createStore } from '../fake-backend/store.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepEndpoint,
  type SklepEndpointRow,
  type SklepExecution,
  type SklepExecutionAnalysis,
  type SklepExecutionResult,
} from '../fake-backend/worlds/sklep.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/log.js';
import type { Tool } from '../../src/registry.js';
import { createServer } from '../../src/server.js';
import { createTestClock, settleClock } from '../helpers/clock.js';
import { assertNoCanary } from '../helpers/canary.js';
import { connect, type CallResult } from '../helpers/mcp.js';
import { toolRig, type RigCallResult, type SeenOutcome, type ToolRig } from '../helpers/rig.js';

type ScriptClock = Parameters<typeof scriptRuns>[1];
type TestClock = ReturnType<typeof createTestClock>;

type FlowDetail = components['schemas']['FlowDetail'];

const FIXTURE = resolve(import.meta.dirname, '..', '..', '..', 'evals', 'fixtures', 'sklep');

/** The start of the test clock; the golden texts do not show the date. */
export const START = Date.parse('2026-11-22T11:00:00Z');

/** One call of a run: the tool, its arguments and the golden text its result must equal. */
export interface Step {
  readonly tool: string;
  /** The arguments, or how they come out of the results so far (a handle read from a text). */
  readonly args:
    Record<string, unknown> | ((done: readonly StepResult[]) => Record<string, unknown>);
  /** Test time that passes before the call, in milliseconds. */
  readonly advance?: number;
  /** Base name of the golden file in the run (`04-flows_generate_from_suggestions`). */
  readonly expect: string;
  /**
   * The step is expected to fail: the result is an error whose text holds this, and nothing is
   * compared with a golden text.
   */
  readonly error?: string;
  /** The step succeeds with a text that holds this; nothing is compared with a golden text. */
  readonly contains?: string;
  /**
   * Test time one turn of the step moves the clock by, in milliseconds (default 10 s). A step that
   * opens a socket needs steps shorter than the time limit of the handshake (10 s).
   */
  readonly stepMs?: number;
  /** Runs on the fake once the step has ended, before the next call (what the user did in between). */
  readonly after?: (fake: Fake) => void;
  /** The golden text has no link line (the pattern of the mock-up has none): links are left out. */
  readonly unlinked?: boolean;
  /** One call only: an unfinished result is not continued with `process_wait` (the next step does it). */
  readonly once?: boolean;
  /** The server process is replaced before the call: what is left is the state file and the backend. */
  readonly restart?: boolean;
}

export interface ScriptOptions {
  readonly run: GoldenRun;
  /** Files created in the workspace before the first call (relative path -> content). */
  readonly files?: Readonly<Record<string, string>>;
  /** What the fake backend does for the run: the scripted test, the flow of the batch, the model. */
  readonly runScript: RunScript;
  readonly batch: BatchWorld;
  readonly split: readonly { flow: string; proportion: number }[];
  readonly executionIds: readonly string[];
  readonly locale?: 'en' | 'pl';
  /** What the refinement of the journeys proposes; default: the world's own. */
  readonly suggestions?: SuggestionWorld;
  /** Applied after the fake started, before the first call (extra routes, a fault, seeded records). */
  readonly before?: (fake: Fake, clock: TestClock) => void;
  /** The self-check runs of the world by id (request rows), instead of or beside the default ones. */
  readonly checkRuns?: Readonly<Record<string, RunRows>>;
  /** What the self-checks do over time; default: `planChecks`. */
  readonly checks?: (checks: SelfCheckFake) => void;
  /** The stored record of a finished test, once the driver ends the run; default: the perf run of the world. */
  readonly finish?: (fake: Fake, run: StartedRun) => void;
  /** The API description the workspace holds; `null`: the repository has none. */
  readonly openapi?: string | null;
  /** Capabilities the backend announces besides the ones every run needs. */
  readonly capabilities?: readonly string[];
  /** One set of services for the whole run (what a tool leaves running between calls survives). */
  readonly processServices?: boolean;
}

/** What a step returned: the call that ended it plus every call made on the way (`process_wait`). */
export interface StepResult {
  readonly step: Step;
  readonly calls: readonly RigCallResult[];
  readonly last: RigCallResult;
}

export interface ScriptRun {
  readonly rig: ToolRig;
  readonly results: readonly StepResult[];
}

/** The handle of an unfinished operation, read from the text the way a model reads it. */
export function handleFromText(text: string): string | undefined {
  return /([a-z_]+:[0-9a-f]{8}-[0-9a-f-]{20,})/u.exec(text)?.[1];
}

/** The setup of a project in the order of the skill, as its old one-call arguments give it. */
export interface SetupStepArgs {
  readonly name: string;
  readonly openapi?: string;
  readonly overview?: string;
  readonly description?: string;
  readonly environments: readonly Readonly<Record<string, unknown>>[];
  readonly env_file?: string;
}

/** The golden names of the five results of the setup (`01a-project_create` …). */
export interface SetupGolden {
  readonly create: string;
  readonly saveEnv: string;
  readonly checkEnv: string;
  readonly analyze: string;
  readonly apply: string;
}

/** Run 1's names: the five results every run with the documentation shares. */
export const SETUP_GOLDEN: SetupGolden = {
  create: '01a-project_create',
  saveEnv: '01b-project_save_env',
  checkEnv: '01c-project_check_env',
  analyze: '01d-project_analyze_setup',
  apply: '01e-project_apply_setup',
};

const pick = (
  args: SetupStepArgs,
  keys: readonly (keyof SetupStepArgs)[],
): Record<string, unknown> =>
  Object.fromEntries(keys.filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));

/**
 * `project_create` with the default environment (the one marked, else the first),
 * `project_save_env` with all of them, `project_check_env`, `project_analyze_setup` with the
 * material, and `project_apply_setup` with the handle the analysis names in its text (none when it
 * names none), the way a model reads it.
 */
export function setupSteps(args: SetupStepArgs, golden: SetupGolden = SETUP_GOLDEN): Step[] {
  const first =
    args.environments.find((environment) => environment['default'] === true) ??
    args.environments[0];
  if (first === undefined) throw new Error('setupSteps: no environment');
  const environment = Object.fromEntries(
    ['name', 'api', 'frontend']
      .filter((key) => first[key] !== undefined)
      .map((key) => [key, first[key]]),
  );
  return [
    {
      tool: 'project_create',
      args: { name: args.name, ...pick(args, ['overview', 'description']), environment },
      expect: golden.create,
    },
    {
      tool: 'project_save_env',
      args: { environments: args.environments, ...pick(args, ['env_file']) },
      expect: golden.saveEnv,
    },
    { tool: 'project_check_env', args: {}, expect: golden.checkEnv },
    {
      tool: 'project_analyze_setup',
      args: pick(args, ['openapi', 'overview', 'description']),
      expect: golden.analyze,
    },
    {
      tool: 'project_apply_setup',
      args: (done) => {
        const handle = handleFromText(done.at(-1)?.last.text ?? '');
        return handle === undefined ? {} : { analysis: handle };
      },
      expect: golden.apply,
    },
  ];
}

/**
 * The setup of `setupSteps` with a caller of one's own (a test that calls tool by tool and follows
 * handles itself); the result of each call goes to the next as the driver gives it.
 */
export async function runSetup(
  step: (tool: string, args: Record<string, unknown>) => Promise<RigCallResult>,
  args: SetupStepArgs,
): Promise<RigCallResult[]> {
  const done: StepResult[] = [];
  for (const planned of setupSteps(args)) {
    const given = typeof planned.args === 'function' ? planned.args(done) : planned.args;
    const last = await step(planned.tool, given);
    done.push({ step: planned, calls: [last], last });
  }
  return done.map((result) => result.last);
}

/** The operations the journeys of run 1 walk through, named the way the golden texts name the steps. */
const SUMMARIES: Readonly<Record<string, string>> = {
  login: 'logowanie',
  search_products: 'wyszukanie',
  add_cart_item: 'koszyk',
  checkout: 'zamówienie',
  list_categories: 'kategorie',
  get_product: 'produkt',
  list_orders: 'zamówienia',
  get_order_status: 'odpytywanie o status',
};

/**
 * The API description of the `sklep` world as an OpenAPI document: the 42 operations of the world,
 * each in the area (tag) the world gives it, so the documentation the tool reads matches the world.
 * `extra` adds one GET operation (43 in all) and `commit` names the source revision it was made from.
 */
export function sklepOpenapi(
  options: { commit?: string; extra?: boolean; version?: string } = {},
): string {
  const scratch = createStore(createIdSource(1));
  seedSklep(scratch, { stage: 'project' });
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of scratch.collection<SklepEndpoint>(SKLEP_COLLECTIONS.endpoints).list()) {
    (paths[endpoint.path] ??= {})[endpoint.method.toLowerCase()] = {
      operationId: endpoint.operation_id,
      summary: SUMMARIES[endpoint.operation_id ?? ''] ?? endpoint.summary,
      tags: endpoint.tags,
    };
  }
  // A later revision of the description: one more GET operation, a status page.
  if (options.extra === true) paths['/status'] = { get: { operationId: 'get_status_page' } };
  return JSON.stringify({
    openapi: '3.0.3',
    info: {
      title: 'Sklep API',
      version: options.version ?? '2.14.0',
      'x-loadcraft-source': { commit: options.commit ?? '5e8b7d1' },
    },
    paths,
  });
}

/**
 * The flows of the `sklep` world other than `zakupy`: what the generator saves for the journeys
 * `przeglądanie` and `konto`, with the identifiers the world's scenarios are keyed on.
 */
export function worldFlows(): FlowDetail[] {
  const scratch = createStore(createIdSource(1));
  seedSklep(scratch, { stage: 'flows' });
  return scratch.collection<FlowDetail>(SKLEP_COLLECTIONS.flows).list();
}

/** A self-check run of the world: its request rows as (name, passed, failed, mean ms). */
export type RunRows = readonly (readonly [name: string, ok: number, ko: number, ms: number])[];

/**
 * The self-check runs of the three scenarios with their steps named as the golden texts name them.
 * The runs are stored before the scenarios are generated, and the generation keeps what is stored.
 */
export function nameSteps(fake: Fake, overrides: Readonly<Record<string, RunRows>> = {}): void {
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
    storeRun(fake, scratch, runId, overrides[runId] ?? rows);
  }
  for (const [runId, rows] of Object.entries(overrides)) {
    if (!runs.some(([known]) => known === runId)) storeRun(fake, scratch, runId, rows);
  }
}

function storeRun(fake: Fake, scratch: Store, runId: string, rows: RunRows): void {
  // A run the world does not keep (the checks of `zakupy`) is a copy of the one it keeps for `konto`.
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

/** What the checks of `zakupy` and `konto` do over time once their data is in: two passes. */
export function planChecks(checks: SelfCheckFake): void {
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

/** The files of the synthetic customer repository that the plugin may read. */
export function fixtureFiles(openapi: string | null = sklepOpenapi()): Record<string, string> {
  const read = (relative: string): string => readFileSync(join(FIXTURE, relative), 'utf8');
  return {
    ...(openapi === null ? {} : { 'loadcraft/openapi.json': openapi }),
    '.env.perf': read('.env.perf'),
    '.env.qa': read('.env.qa'),
  };
}

type Handler = (req: FakeRequest, store: Store, jobs: Jobs) => FakeResponse | Promise<FakeResponse>;

const EXECUTION = '/api/v1/projects/{project_id}/gatling/executions/{execution_id}';

/**
 * Runs `register` with the two run routes caught instead of registered. The fake itself stays the
 * same object (registrars remember it to stay idempotent), only its `route` is swapped for a while.
 */
export function catching(fake: Fake, caught: Map<string, Handler>, register: () => void): void {
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

const MOCKUP_REQUESTS = ['POST /checkout', 'POST /cart/items', 'GET /products', 'GET /categories'];

/** What the driver tells the run routes: the started test is over, its record is the world's. */
interface RunRoutes {
  endRun(): void;
}

/**
 * The fake keeps two designs apart: a started run follows a script on the clock (`scriptRuns`),
 * a finished run is a stored record of the world (`registerResultRoutes`), and both own the same
 * two routes. Here one route answers each: from the script for a run this fake started, until the
 * driver ends the run; from the stored records of the world otherwise (the self-check runs) and
 * after that (the report and the diagnosis read the record of the finished test).
 */
function registerRunRoutes(
  fake: Fake,
  clock: ScriptClock,
  script: RunScript,
  finish: ScriptOptions['finish'],
): RunRoutes {
  const scripted = new Map<string, Handler>();
  const stored = new Map<string, Handler>();
  catching(fake, scripted, () => {
    registerExecutionRoutes(fake);
    scriptRuns(fake, clock, script);
  });
  catching(fake, stored, () => {
    registerResultRoutes(fake);
  });

  const scratch = createStore(createIdSource(1));
  seedSklep(scratch, { stage: 'executed' });
  let ended = false;
  const endRun = (): void => {
    ended = true;
    const executions = fake.store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
    const results = fake.store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results);
    const analyses = fake.store.collection<SklepExecutionAnalysis>(SKLEP_COLLECTIONS.analyses);
    for (const run of startedRuns(fake)) {
      if (executions.get(run.id) !== undefined) continue;
      if (finish !== undefined) {
        finish(fake, run);
        continue;
      }
      executions.insert(
        scratch.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).require(run.id),
      );
      // The golden text lists the four requests of the mock-up, the world keeps six.
      const world = scratch
        .collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results)
        .require(run.id);
      results.insert({
        ...world,
        endpoints: world.endpoints.filter((row) => MOCKUP_REQUESTS.includes(row.name)),
      });
      // The fake runs an analysis by copying the one of the world, so that one is stored; the
      // diagnosis step asks for a new analysis (`force`), as the tests of `results_analyze_run` do.
      for (const analysis of scratch
        .collection<SklepExecutionAnalysis>(SKLEP_COLLECTIONS.analyses)
        .list((item) => item.execution_id === run.id)) {
        analyses.insert(analysis);
      }
    }
  };

  for (const suffix of ['', '/result']) {
    const key = `GET ${EXECUTION}${suffix}`;
    const live = scripted.get(key);
    const done = stored.get(key);
    if (live === undefined || done === undefined) throw new Error(`no handler caught for ${key}`);
    const register = fake.route.bind(fake) as (...args: unknown[]) => void;
    register('GET', `${EXECUTION}${suffix}`, (req: FakeRequest, store: Store, jobs: Jobs) => {
      const id = req.params.execution_id;
      const started = startedRuns(fake).some((run) => run.id === id);
      return started && !ended ? live(req, store, jobs) : done(req, store, jobs);
    });
  }
  return { endRun };
}

/**
 * The fake makes the identifiers of what the tools create (the project, the flows); the golden
 * texts carry the identifiers of the `sklep` world. Each created record is mapped to its world
 * counterpart by name, and the text of the result is read with the world's identifiers.
 */
function inWorldIds(text: string, fake: Fake): string {
  const pairs: [string, string][] = [];
  const [project] = fake.store.collection<{ id: string }>(SKLEP_COLLECTIONS.projects).list();
  if (project !== undefined) pairs.push([project.id, SKLEP_IDS.project]);
  const flowIds: Record<string, string> = {
    zakupy: SKLEP_WORLD_IDS.flowZakupy,
    przeglądanie: SKLEP_WORLD_IDS.flowPrzegladanie,
    konto: SKLEP_WORLD_IDS.flowKonto,
  };
  for (const flow of fake.store
    .collection<{ id: string; name: string }>(SKLEP_COLLECTIONS.flows)
    .list()) {
    const world = flowIds[flow.name];
    if (world !== undefined) pairs.push([flow.id, world]);
  }
  return pairs
    .reduce((all, [made, world]) => all.replaceAll(made, world), text)
    .replace(SETUP_HANDLE, `setup_analysis:${SKLEP_IDS.setupAnalysis}`);
}

/** The handle of a project analysis: the run id the fake made, replaced by the world's. */
const SETUP_HANDLE =
  /setup_analysis:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;

/**
 * A second server process on the workspace and the backend of `rig`: what a restart of the MCP
 * server leaves is the state file, nothing in memory. Its results carry the outcome of the tool the
 * way those of the rig do, and what it returned and logged is checked for the sentinels too.
 */
async function restartedCaller(rig: ToolRig): Promise<ToolRig['call']> {
  const lines: string[] = [];
  const results: CallResult[] = [];
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
  const config = loadConfig(
    {
      LOADCRAFT_API_URL: `${rig.fake.url}/api/v1`,
      LOADCRAFT_API_TOKEN: rig.fake.token,
      LOADCRAFT_LOCALE: rig.config.locale,
    },
    rig.workspace,
  );
  log.registerSecret(config.token.reveal());
  const seen = new AsyncLocalStorage<{ outcome?: SeenOutcome }>();
  const tools = ALL_TOOLS.map((tool): Tool => ({
    ...tool,
    async invoke(ctx, args) {
      const result = await tool.invoke(ctx, args);
      const slot = seen.getStore();
      if (slot !== undefined) {
        const { outcome } = result;
        slot.outcome = {
          status: outcome.status,
          data: outcome.data,
          ...(outcome.status === 'done' ? {} : { operation: outcome.operation }),
        };
      }
      return result;
    },
  }));
  const session = await connect(() => createServer({ config, log, tools, clock: rig.clock }));
  onTestFinished(async () => {
    await session.close();
    assertNoCanary(results, lines);
  });
  return async (name, args, opts) => {
    const slot: { outcome?: SeenOutcome } = {};
    const result = await seen.run(slot, () => session.call(name, args, opts));
    results.push(result);
    return { ...result, outcome: slot.outcome };
  };
}

const MAX_CONTINUATIONS = 20;
const FAST = { stepMs: 10_000, limitMs: 3_600_000 } as const;

/**
 * Starts the fake in the `empty` world and calls `steps` in order on one state. Every step is
 * checked as soon as it ends, so the first difference is the one reported.
 */
export async function runScript(
  steps: readonly Step[],
  options: ScriptOptions,
): Promise<ScriptRun> {
  const clock = createTestClock(START);
  let runRoutes: RunRoutes | undefined;
  const rig = await toolRig({
    tools: ALL_TOOLS,
    world: (fake) => {
      registerLookupRoutes(fake);
      registerProjectRoutes(fake);
      registerSetupRoutes(fake);
      registerOpenapiReadRoute(fake);
      registerApiMapRoute(fake);
      registerConformanceRoute(fake);
      registerTelemetryRoutes(fake);
      registerStatusRoutes(fake);
      registerSuggestionRoutes(fake, options.suggestions ?? SKLEP_SUGGESTIONS);
      registerBatchGenerateRoute(fake, options.batch, clock);
      registerFlowRoutes(fake);
      registerScenarioBuilderRoutes(fake);
      scriptBuilderModel(fake, options.split);
      (options.checks ?? planChecks)(registerSelfCheckRoutes(fake));
      registerScenarioRoutes(fake);
      registerTestTypeRoutes(fake);
      registerCompositionRoutes(fake);
      registerDataRoutes(fake);
      registerProvisionRoutes(fake);
      runRoutes = registerRunRoutes(fake, clock, options.runScript, options.finish);
      registerErrorGroupsRoute(fake);
      registerAnalysisStartRoute(fake);
      registerAnalysisReadRoute(fake);
      seedSklep(fake.store, { stage: 'empty' });
      seedAutoDatasets(fake.store);
      nameSteps(fake, options.checkRuns);
      planExecutionIds(fake, options.executionIds);
      options.before?.(fake, clock);
    },
    fake: {
      meta: {
        capabilities: [
          'meta',
          'provision_environment',
          'provision_register_operation',
          'provision_protected_confirmation',
          ...(options.capabilities ?? []),
        ],
      },
    },
    ...(options.processServices === true ? { processServices: true } : {}),
    clock,
    env: { LOADCRAFT_LOCALE: options.locale ?? 'pl' },
    files: options.files ?? fixtureFiles(options.openapi),
  });

  const results: StepResult[] = [];
  let call: ToolRig['call'] = (name, args, opts) => rig.call(name, args, opts);
  for (const step of steps) {
    if (step.advance !== undefined) await rig.clock.advance(step.advance);
    if (step.restart === true) call = await restartedCaller(rig);
    const calls: RigCallResult[] = [];
    const pace = { ...FAST, stepMs: step.stepMs ?? FAST.stepMs };
    const args = typeof step.args === 'function' ? step.args(results) : step.args;
    let last = await settleClock(rig, call(step.tool, args), pace);
    calls.push(last);
    for (let again = 0; again < MAX_CONTINUATIONS; again += 1) {
      if (step.once === true) break;
      if (last.isError || last.outcome?.status === 'done' || last.outcome === undefined) break;
      const handle = handleFromText(last.text);
      if (handle === undefined) {
        throw new Error(
          `step ${step.expect}: an unfinished result without a handle:\n${last.text}`,
        );
      }
      last = await settleClock(rig, call('process_wait', { operation: handle }), pace);
      calls.push(last);
    }
    // A test that asks for consent starts nothing: only a started run is over after its call.
    if (step.tool === 'run_start' && !last.isError && startedRuns(rig.fake).length > 0) {
      runRoutes?.endRun();
    }
    if (!last.isError) step.after?.(rig.fake);
    const result: StepResult = { step, calls, last };
    results.push(result);
    if (step.error !== undefined) {
      expect(last.isError, `${step.expect}: ${last.text}`).toBe(true);
      expect(last.text, step.expect).toContain(step.error);
      continue;
    }
    expect(last.isError, `${step.expect}: ${last.text}`).toBe(false);
    if (step.contains !== undefined) {
      expect(last.text, step.expect).toContain(step.contains);
      continue;
    }
    const world = inWorldIds(last.text, rig.fake);
    const seen =
      step.unlinked === true
        ? world
            .split('\n')
            .filter((line) => !line.startsWith('↗ '))
            .join('\n')
        : world;
    expect(`${seen}\n`, step.expect).toBe(goldenText(options.run, step.expect));
  }
  return { rig, results };
}

export { SKLEP_IDS };
