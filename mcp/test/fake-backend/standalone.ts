// The stand-alone fake backend (`npm run fake`, `scripts/fake-backend.mjs`) as one function, so the
// process and the tests that check it set up the same fake: every route set and the `sklep` world
// at the given stage, plus what a fake nobody steers needs to carry a whole session by itself:
//
// - a run started on it follows a script on the fake's clock (building, then load as long as the
//   started profile, then completed) and, once completed, becomes a stored record made from the
//   scenarios it ran (`worlds/document.ts`), so the report and the diagnosis read a finished test;
//   its verdict follows the thresholds sent with run_start (`run: 'none'`, the default, where the
//   numbers are the world's own and the slowest request usually breaks them), is always SLA PASSED
//   (`run: 'pass'`) or always SLA FAILED (`run: 'fail'`);
// - a scenario of a flow the world has no scenario for is built from the flow (a scenario that
//   logs in reads accounts and waits for them);
// - a self-check without a plan waits for the accounts a scenario still lacks, and passes once they
//   are bound, with a run of the scenario's own requests.
//
// For a document that is not the `sklep` world's, the proposals of the journeys come from the
// document as well (`routes/suggestions.ts`), so a whole session works on the customer's own
// documentation.

import type { components } from '../../src/http/generated/api.js';
import type { Clock } from '../../src/ops/clock.js';
import {
  registerExecutionRoutes,
  scriptRuns,
  startedRuns,
  type RunScript,
  type StartedRun,
} from './routes/executions.js';
import { unboundStatus } from './routes/data.js';
import { registerAllRoutes } from './routes/index.js';
import { registerResultRoutes } from './routes/results.js';
import { defaultEnvironment, deriveScenariosFromFlows } from './routes/scenarios.js';
import {
  selfCheckDocument,
  selfCheckOutcomes,
  type SelfCheckDocument,
} from './routes/selfCheck.js';
import type { Fake, FakeRequest, FakeResponse, Jobs, Store } from './server.js';
import {
  loadRun,
  passedCheck,
  requestsOf,
  selfCheckRun,
  waitingCheck,
  withCheck,
} from './worlds/document.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  type SklepComposition,
  type SklepExecution,
  type SklepExecutionAnalysis,
  type SklepExecutionResult,
  type SklepScenario,
  type SklepSelfCheck,
  type SklepStage,
  type SklepTelemetrySource,
} from './worlds/sklep.js';

type FlowDetail = components['schemas']['FlowDetail'];
type EnvironmentResponse = components['schemas']['EnvironmentResponse'];
type Handler = (req: FakeRequest, store: Store, jobs: Jobs) => FakeResponse | Promise<FakeResponse>;
type StandaloneClock = Pick<Clock, 'now'> & {
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
};

/** How a run started on the fake ends: by the thresholds (`none`), always passed, always failed. */
export const RUN_MODES = ['none', 'pass', 'fail'] as const;
export type RunMode = (typeof RUN_MODES)[number];

export interface StandaloneOptions {
  readonly stage: SklepStage;
  /** Verdict of the runs started on the fake; `none` when absent. */
  readonly run?: RunMode;
}

const EXECUTION = '/api/v1/projects/{project_id}/gatling/executions/{execution_id}';

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Shortest load of a run, in seconds, whatever the profile says. */
const MIN_LOAD_S = 60;

/** A run of the stand-alone fake: built in 15 s, loaded for the ramp and hold of its profile. */
export const STANDALONE_RUN: RunScript = {
  createdBeforeS: 2,
  startsAtS: 15,
  loadS: 600,
  loadOf: (run) =>
    Math.max(MIN_LOAD_S, numberOr(run.workload?.['ramp'], 0) + numberOr(run.workload?.['hold'], 0)),
  end: 'completed',
  live: (elapsed) => ({
    rps: Math.round(Math.min(elapsed, 600) * 40) / 100,
    p95: 250 + Math.round(elapsed / 4),
    errorRate: 0.002,
  }),
  final: { rps: 240, p95: 380, errorRate: 0.004 },
  series: Array.from({ length: 60 }, (_, index) => Math.round(index * 4)),
};

/** Registers `register` with the two run reads caught in `caught` instead of registered. */
function catchRunReads(fake: Fake, caught: Map<string, Handler>, register: () => void): void {
  const original = fake.route.bind(fake) as (...args: unknown[]) => void;
  const holder = fake as { route: unknown };
  holder.route = (method: string, path: string, handler: Handler, ...rest: unknown[]): void => {
    const key = `${method} ${path}`;
    if (key === `GET ${EXECUTION}` || key === `GET ${EXECUTION}/result`) {
      caught.set(key, handler);
      return;
    }
    original(method, path, handler, ...rest);
  };
  try {
    register();
  } finally {
    holder.route = original;
  }
}

const parseNaive = (value: unknown, fallback: number): number =>
  typeof value === 'string' ? Date.parse(value.endsWith('Z') ? value : `${value}Z`) : fallback;

/** The members of a started run with their shares and the requests of their flows. */
function membersOf(store: Store, run: StartedRun) {
  const scenarios = store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
  const flows = store.collection<FlowDetail>(SKLEP_COLLECTIONS.flows);
  const links =
    run.kind === 'composition'
      ? (store
          .collection<SklepComposition>(SKLEP_COLLECTIONS.compositions)
          .get(run.target_id)
          ?.scenarios.filter((link) => link.enabled)
          .map((link) => ({ scenarioId: link.scenario_id, share: link.proportion })) ?? [])
      : [{ scenarioId: run.target_id, share: 1 }];
  return links.flatMap(({ scenarioId, share }) => {
    const scenario = scenarios.get(scenarioId);
    if (scenario === undefined) return [];
    const flow = flows.get(scenario.source_flow_id);
    return [{ scenario, share, requests: flow === undefined ? [] : requestsOf(flow) }];
  });
}

/**
 * The two run reads: a started run follows the script; once it is completed it is stored as a
 * finished test of its scenarios and answered from the stored records from then on.
 */
function registerRunRoutes(fake: Fake, clock: StandaloneClock, mode: RunMode): void {
  const scripted = new Map<string, Handler>();
  const stored = new Map<string, Handler>();
  catchRunReads(fake, scripted, () => {
    registerExecutionRoutes(fake);
    scriptRuns(fake, clock, STANDALONE_RUN);
  });
  catchRunReads(fake, stored, () => {
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
  const finished = new Set<string>();

  const finish = (run: StartedRun, projectId: string, row: Record<string, unknown>): void => {
    const store = fake.store;
    const startMs = parseNaive(row['started_at'], clock.now());
    const environment =
      run.environment_id === null
        ? undefined
        : store
            .collection<EnvironmentResponse>(SKLEP_COLLECTIONS.environments)
            .get(run.environment_id);
    const telemetry = store
      .collection<SklepTelemetrySource>(SKLEP_COLLECTIONS.telemetry)
      .get(projectId);
    const made = loadRun({
      id: run.id,
      kind: run.kind,
      targetId: run.target_id,
      members: membersOf(store, run),
      environment,
      workload: run.workload,
      startMs,
      endMs: parseNaive(row['completed_at'], startMs),
      createdMs: parseNaive(row['created_at'], startMs),
      rps: Math.max(1, numberOr(run.workload?.['vusers'], 1) * 0.5),
      ...(mode === 'none' ? {} : { verdict: mode }),
      telemetry:
        telemetry === undefined
          ? null
          : { kind: telemetry.kind, label: telemetry.label, url: telemetry.url },
    });
    store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).insert(made.execution);
    store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results).insert(made.result);
    store.collection<SklepExecutionAnalysis>(SKLEP_COLLECTIONS.analyses).insert(made.analysis);
    finished.add(run.id);
  };

  /** The run, still followed by the script (undefined once stored or for a run not started here). */
  const following = async (
    req: FakeRequest,
    store: Store,
    jobs: Jobs,
  ): Promise<{ run: StartedRun; live: FakeResponse } | undefined> => {
    const run = startedRuns(fake).find((candidate) => candidate.id === req.params['execution_id']);
    if (run === undefined || finished.has(run.id)) return undefined;
    const live = await liveRow(req, store, jobs);
    const body = live.body as Record<string, unknown>;
    if (body['status'] !== 'completed') return { run, live };
    finish(run, req.params['project_id'] ?? '', body);
    return undefined;
  };

  const route = fake.route.bind(fake) as (...args: unknown[]) => void;
  route('GET', EXECUTION, async (req: FakeRequest, store: Store, jobs: Jobs) => {
    const going = await following(req, store, jobs);
    return going === undefined ? doneRow(req, store, jobs) : going.live;
  });
  route('GET', `${EXECUTION}/result`, async (req: FakeRequest, store: Store, jobs: Jobs) => {
    const going = await following(req, store, jobs);
    return going === undefined ? doneResult(req, store, jobs) : liveResult(req, store, jobs);
  });
}

const asDocument = (check: SklepSelfCheck): SelfCheckDocument =>
  selfCheckDocument({
    status: check.status,
    scenario_version: check.scenario_version,
    execution_ids: [...check.execution_ids],
    missing_slots: [...check.missing_slots],
    started_at: check.started_at,
    finished_at: check.finished_at,
  });

/**
 * What a self-check of `scenario` ends with: it waits for the accounts the scenario has no dataset
 * for; with every one bound it passes, with a new run of the requests of its flow. A scenario whose
 * stored check already passed keeps it. The scenario's stored document is updated as well.
 */
function checkOutcome(
  fake: Fake,
  clock: StandaloneClock,
  scenario: SklepScenario,
): SelfCheckDocument | undefined {
  const store = fake.store;
  const flow = store.collection<FlowDetail>(SKLEP_COLLECTIONS.flows).get(scenario.source_flow_id);
  if (flow === undefined) return undefined;
  const missing = scenario.feeder_slots
    // The scenario's own picks decide, as in the backend's self-check (it runs a member alone and
    // never reads the picks of a composition): a slot of accounts or of plain data without rows
    // that has no pick waits for data.
    .filter(
      (slot) =>
        unboundStatus(slot) === 'missing' && scenario.slot_bindings[slot.slot] === undefined,
    )
    .map((slot) => slot.slot);
  if (missing.length === 0 && scenario.self_check?.status === 'passed') return undefined;
  let check: SklepSelfCheck;
  if (missing.length > 0) {
    check = waitingCheck(scenario.current_version, missing);
  } else {
    const made = selfCheckRun({
      id: store.newId(),
      scenario,
      requests: requestsOf(flow),
      environment: defaultEnvironment(store, flow.project_id),
      startMs: clock.now(),
    });
    store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).insert(made.execution);
    store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results).insert(made.result);
    check = passedCheck(scenario.current_version, made.execution.id, made.window);
  }
  store
    .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
    .update(scenario.id, withCheck(scenario, check));
  return asDocument(check);
}

/** Fills a started fake the way `npm run fake` does. */
export function setupStandalone(
  fake: Fake,
  clock: StandaloneClock,
  options: StandaloneOptions,
): void {
  registerRunRoutes(fake, clock, options.run ?? 'none');
  registerAllRoutes(fake);
  deriveScenariosFromFlows(fake);
  selfCheckOutcomes.set(fake, (scenario) => checkOutcome(fake, clock, scenario));
  seedSklep(fake.store, { stage: options.stage });
}
