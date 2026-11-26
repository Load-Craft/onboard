// Scenario generation of the fake backend: `POST …/gatling/scenarios/generate-async` and the
// project's test types, whose effective names key a `class_mix`. A generation is a job on the test
// clock: its frames go out on the `scenario` channel (which hands the last terminal frame to the
// first socket opened after the end, and nothing else), and its scenario is stored when the clock
// reaches the end, whether anybody listens or not. A failed run stores nothing. Shapes follow
// loadcraft @ d93e08d80 `api/routes/gatling.py:8762-8781` (start), `:8837-9024` (frames) and
// `api/websocket/gatling_scenario_ws.py:103-172`.
//
// A generated scenario is the world's scenario of that flow as the `scenario` stage has it (slots,
// self-check, its run), with the requested class mix and the time it ended. For a flow the world
// has no scenario for, it is built from the flow (`worlds/document.ts`) when the document is not the
// world's or the fake asked for it (`deriveScenariosFromFlows`, the stand-alone fake); otherwise it
// is a copy of the world's first scenario. Registration is idempotent per fake.

import type { components } from '../../../src/http/generated/api.js';
import { FakeHttpError, type Fake, type Job, type Store } from '../server.js';
import { createIdSource, createStore } from '../store.js';
import {
  SKLEP_COLLECTIONS,
  seedSklep,
  type SklepExecution,
  type SklepExecutionResult,
  type SklepScenario,
} from '../worlds/sklep.js';
import {
  documentScenario,
  passedCheck,
  requestsOf,
  selfCheckRun,
  simulationClassName,
  withCheck,
} from '../worlds/document.js';
import { registerDataRoutes, scenarioReadHooks } from './data.js';
import { documentIsForeign } from './suggestions.js';

type FlowDetail = components['schemas']['FlowDetail'];
type TestTypeResponse = components['schemas']['TestTypeResponse'];
type EnvironmentResponse = components['schemas']['EnvironmentResponse'];

/** How one generation run behaves; the defaults are a run of six seconds that stores the scenario. */
export interface GenerationScript {
  /** Progress frames, `afterMs` after the start. */
  readonly progress?: readonly {
    readonly afterMs: number;
    readonly progress: number;
    readonly step: string;
    readonly label: string;
  }[];
  /** The run ends this long after the start. */
  readonly endAfterMs?: number;
  /** How it ends: the scenario is stored (default), an `error` frame (nothing stored), cancelled. */
  readonly outcome?:
    | 'complete'
    | 'cancelled'
    | {
        readonly error: string;
        readonly recoverable?: boolean;
        readonly status_code?: number;
        /**
         * The fields of a refusal of the flow's data, as the backend adds them to a 422 frame
         * (`step`, `column`, `value`, `reason`, `suggestion`); a key the plugin does not read.
         */
        readonly refusal?: Readonly<Record<string, string | null>>;
      };
  /** No frame is sent at all; the scenario is stored all the same. */
  readonly silent?: boolean;
  /** The run ended before the POST answered: its terminal frame waits for the first socket. */
  readonly endedBeforeAnswer?: boolean;
}

/** One `POST …/generate-async` the fake answered. */
export interface GenerationRun {
  readonly runId: string;
  readonly flowId: string;
  readonly scenarioName: string | null;
  readonly classMix: Readonly<Record<string, number>> | null;
  readonly startedAt: number;
  readonly endsAt: number;
  /** Id of the stored scenario, once the run has ended and stored one. */
  readonly scenarioId: string | null;
}

export interface ScenarioGenerationFake {
  /** Scripts of the next runs for the flow, used in order; a run without one is the default. */
  script(flowId: string, ...runs: GenerationScript[]): void;
  /** The script of every run that has none queued for its flow (instead of the six-second default). */
  scriptAll(run: GenerationScript): void;
  /** Every run started so far, in order (the scenarios of the ended ones stored first). */
  runs(): readonly GenerationRun[];
}

const DEFAULT_PROGRESS: NonNullable<GenerationScript['progress']> = [
  { afterMs: 1_000, progress: 25, step: 'resolve_test_type', label: 'Resolving test type' },
  { afterMs: 2_000, progress: 62, step: 'generate_skeleton', label: 'Generating code' },
  { afterMs: 4_000, progress: 75, step: 'validate_compilation', label: 'Compiling' },
];
const DEFAULT_END_MS = 6_000;

/**
 * A generation as the real backend takes it: minutes per flow (the default run is six seconds). A
 * call that waits less than that returns the handle of the run, and the `process_wait` that follows ends
 * with "the scenario is ready, call scenario_generate again with the same arguments"; only that second
 * call composes (`buildScenario.generationDone`). On a clock that runs `speed` times faster, the wait
 * of a call is `endAfterMs / speed` of real time.
 */
export const MINUTES_PER_FLOW: GenerationScript = {
  endAfterMs: 150_000,
  progress: [
    { afterMs: 30_000, progress: 25, step: 'resolve_test_type', label: 'Resolving test type' },
    { afterMs: 70_000, progress: 62, step: 'generate_skeleton', label: 'Generating code' },
    { afterMs: 120_000, progress: 75, step: 'validate_compilation', label: 'Compiling' },
  ],
};
/** Errors of a run that cannot start (unknown flow, bad mix) come this soon (`gatling.py:8837`). */
const EARLY_ERROR_MS = 500;
const HAPPY_PATH = 'happy_path';

interface StartedRun {
  readonly job: Job;
  readonly projectId: string;
  readonly flowId: string;
  readonly scenarioName: string | null;
  readonly classMix: Record<string, number> | null;
  readonly endsAt: number;
  /** Id the scenario gets when the run stores it; null for a run that fails. */
  readonly plannedId: string | null;
  scenarioId: string | null;
}

const registered = new WeakMap<Fake, ScenarioGenerationFake>();
const derivingFakes = new WeakSet<Fake>();

/**
 * Scenarios of flows the world has no scenario for are built from the flow on this fake, whatever
 * the document (the stand-alone fake). Without it they are only for a foreign document; the rest
 * copy the world's first scenario.
 */
export function deriveScenariosFromFlows(fake: Fake): void {
  derivingFakes.add(fake);
}
const testTypesRegistered = new WeakSet<Fake>();

let templateStore: Store | undefined;

/** The world as the `scenario` stage has it: the source of every generated scenario. */
function templates(): Store {
  if (templateStore === undefined) {
    templateStore = createStore(createIdSource(1));
    seedSklep(templateStore, { stage: 'scenario' });
  }
  return templateStore;
}

function requireProject(store: Store, id: string): void {
  store.collection(SKLEP_COLLECTIONS.projects).require(id, `Project not found: ${id}`);
}

/** Weights normalised to 100, as `resolve_class_mix` stores them (`feeders/class_mix.py:122-190`). */
function resolvedMix(mix: Readonly<Record<string, number>> | null): Record<string, number> {
  if (mix === null || Object.keys(mix).every((key) => key === HAPPY_PATH)) {
    return { [HAPPY_PATH]: 100 };
  }
  const total = Object.values(mix).reduce((sum, weight) => sum + Math.max(0, weight), 0);
  return Object.fromEntries(
    Object.entries(mix).map(([key, weight]) => [key, (Math.max(0, weight) / total) * 100]),
  );
}

function enabledTypeNames(store: Store, projectId: string): Set<string> {
  return new Set(
    store
      .collection<TestTypeResponse & { project_id?: string }>(SKLEP_COLLECTIONS.testTypes)
      .list((type) => type.is_enabled && (type.project_id ?? projectId) === projectId)
      .map((type) => type.effective_name),
  );
}

/** Why the run cannot start, as the backend's error frame says it; undefined when it can. */
function refusal(
  store: Store,
  projectId: string,
  flowId: string,
  mix: Readonly<Record<string, number>> | null,
): { error: string; recoverable: boolean; status_code: number } | undefined {
  if (store.collection<FlowDetail>(SKLEP_COLLECTIONS.flows).get(flowId) === undefined) {
    return { error: `Flow not found: ${flowId}`, recoverable: false, status_code: 404 };
  }
  const known = enabledTypeNames(store, projectId);
  const unknown = Object.keys(mix ?? {}).find((key) => key !== HAPPY_PATH && !known.has(key));
  if (unknown === undefined) return undefined;
  return {
    error: `class_mix references '${unknown}', which is not an enabled test type of this project — configure and enable it as a project test type first`,
    recoverable: false,
    status_code: 400,
  };
}

function templateOf(flowId: string): SklepScenario | undefined {
  return templates()
    .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
    .list((scenario) => scenario.source_flow_id === flowId)[0];
}

/** The world's id of the flow's scenario while no record and no other run holds it; a new one else. */
function plannedId(store: Store, flowId: string, runs: readonly StartedRun[]): string {
  const own = templateOf(flowId)?.id;
  const free =
    own !== undefined &&
    store.collection(SKLEP_COLLECTIONS.scenarios).get(own) === undefined &&
    !runs.some((run) => run.plannedId === own);
  return free ? own : store.newId();
}

/** The scenario a successful run stores: the world's one for the flow, made for this run. */
function generatedScenario(store: Store, run: StartedRun, id: string): SklepScenario {
  const scenarios = store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
  const source = templates().collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
  const template = structuredClone(templateOf(run.flowId) ?? source.list()[0]);
  if (template === undefined) throw new Error('the sklep world has no scenario to copy');
  const flow = store.collection<FlowDetail>(SKLEP_COLLECTIONS.flows).require(run.flowId);
  const taken = new Set(scenarios.list().map((scenario) => scenario.simulation_class_name));
  let className = template.simulation_class_name;
  for (let suffix = 2; taken.has(className); suffix += 1) {
    className = `${template.simulation_class_name}${String(suffix)}`;
  }
  const at = new Date(run.endsAt).toISOString();
  const mix = resolvedMix(run.classMix);
  return {
    ...template,
    id,
    name: run.scenarioName ?? `${flow.name} Flow`,
    simulation_class_name: className,
    source_flow_id: flow.id,
    source_flow_version: flow.current_version,
    scenario_artifact: {
      ...template.scenario_artifact,
      generation_metadata: {
        ...template.scenario_artifact.generation_metadata,
        source_flow_id: flow.id,
        source_flow_version: flow.current_version,
        resolved_class_mix: mix,
      },
    },
    created_at: at,
    updated_at: at,
  };
}

/** A class name no stored scenario has: `base`, else `base2`, `base3`, … */
function freeClassName(store: Store, base: string): string {
  const taken = new Set(
    store
      .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
      .list()
      .map((scenario) => scenario.simulation_class_name),
  );
  let className = base;
  for (let suffix = 2; taken.has(className); suffix += 1) className = `${base}${String(suffix)}`;
  return className;
}

/**
 * The scenario a successful run stores for a flow the world has no scenario for: built from the
 * flow (`worlds/document.ts`). A scenario that logs in waits for accounts; any other one is checked
 * at once, and its check run is stored with it.
 */
function derivedScenario(
  store: Store,
  projectId: string,
  run: StartedRun,
  id: string,
): SklepScenario {
  const flow = store.collection<FlowDetail>(SKLEP_COLLECTIONS.flows).require(run.flowId);
  const name = run.scenarioName ?? `${flow.name} Flow`;
  const scenario = documentScenario({
    id,
    name,
    className: freeClassName(store, simulationClassName(name)),
    flow,
    mix: resolvedMix(run.classMix),
    at: new Date(run.endsAt).toISOString(),
  });
  if (scenario.feeder_slots.length > 0) return scenario;
  const made = selfCheckRun({
    id: store.newId(),
    scenario,
    requests: requestsOf(flow),
    environment: defaultEnvironment(store, projectId),
    startMs: run.endsAt,
  });
  store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).insert(made.execution);
  store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results).insert(made.result);
  return withCheck(scenario, passedCheck(scenario.current_version, made.execution.id, made.window));
}

/** The project's default environment, else its first one. */
export function defaultEnvironment(
  store: Store,
  projectId: string,
): EnvironmentResponse | undefined {
  const environments = store
    .collection<EnvironmentResponse>(SKLEP_COLLECTIONS.environments)
    .list((environment) => environment.project_id === projectId);
  return environments.find((environment) => environment.is_default) ?? environments[0];
}

/** The run of the template's self-check, so the chain of the stored scenario can be read. */
function copySelfCheckRuns(store: Store, scenario: SklepScenario): void {
  const executions = store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
  const results = store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results);
  const source = templates();
  for (const runId of scenario.self_check?.execution_ids ?? []) {
    const execution = source.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).get(runId);
    const result = source.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results).get(runId);
    if (execution !== undefined && executions.get(runId) === undefined) {
      executions.insert({ ...structuredClone(execution), scenario_id: scenario.id });
    }
    if (result !== undefined && results.get(runId) === undefined) {
      results.insert(structuredClone(result));
    }
  }
}

/**
 * `GET …/test-types[?is_enabled=]` (`api/routes/project_test_types.py`), from the world's
 * collection. Registration is idempotent per fake.
 */
export function registerTestTypeRoutes(fake: Fake): void {
  if (testTypesRegistered.has(fake)) return;
  testTypesRegistered.add(fake);
  fake.route('GET', '/api/v1/projects/{project_id}/test-types', (req, store) => {
    requireProject(store, req.params.project_id);
    const enabled = req.query['is_enabled'];
    const items = store
      .collection<TestTypeResponse>(SKLEP_COLLECTIONS.testTypes)
      .list(
        (type) =>
          type.project_id === req.params.project_id &&
          (enabled === undefined || String(type.is_enabled) === enabled),
      );
    return { status: 200, body: { items, total: items.length } };
  });
}

/**
 * What a world changes in a scenario a generation stores, before it is stored (the gate's world adds
 * a slot of plain data whose rows the generation did not make); one hook per fake.
 */
export const generatedScenarioHooks = new WeakMap<
  Fake,
  (scenario: SklepScenario) => SklepScenario
>();

/** Registers the generation route (once per fake) and returns the handle a test scripts runs with. */
export function registerScenarioRoutes(fake: Fake): ScenarioGenerationFake {
  const known = registered.get(fake);
  if (known !== undefined) return known;

  registerDataRoutes(fake);
  registerTestTypeRoutes(fake);

  const scripts = new Map<string, GenerationScript[]>();
  const started: StartedRun[] = [];
  let fallback: GenerationScript = {};

  /** Stores the scenario of every run that has ended by now, as the background task does. */
  const settle = (): void => {
    const scenarios = fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
    for (const run of started) {
      if (run.plannedId === null || run.scenarioId !== null) continue;
      const job = fake.jobs.find(run.job.id);
      if (job === undefined || !job.finished) continue;
      const derive =
        templateOf(run.flowId) === undefined &&
        (derivingFakes.has(fake) || documentIsForeign(fake.store));
      const made = derive
        ? derivedScenario(fake.store, run.projectId, run, run.plannedId)
        : generatedScenario(fake.store, run, run.plannedId);
      const scenario = generatedScenarioHooks.get(fake)?.(made) ?? made;
      scenarios.insert(scenario);
      if (!derive) copySelfCheckRuns(fake.store, scenario);
      run.scenarioId = scenario.id;
    }
  };
  scenarioReadHooks.set(fake, settle);

  const control: ScenarioGenerationFake = {
    script(flowId, ...runs) {
      scripts.set(flowId, [...(scripts.get(flowId) ?? []), ...runs]);
    },
    scriptAll(run) {
      fallback = run;
    },
    runs() {
      settle();
      return started.map((run) => ({
        runId: run.job.id,
        flowId: run.flowId,
        scenarioName: run.scenarioName,
        classMix: run.classMix,
        startedAt: run.job.startedAt,
        endsAt: run.endsAt,
        scenarioId: run.scenarioId,
      }));
    },
  };
  registered.set(fake, control);

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/scenarios/generate-async/{run_id}/cancel',
    (req, store, jobs) => {
      requireProject(store, req.params.project_id);
      const runId = req.params.run_id;
      const job = jobs.find(runId);
      if (job === undefined || job.finished) {
        throw new FakeHttpError(404, { detail: `No running generation for run: ${runId}` });
      }
      fake.channel('scenario', { run_id: runId }).emit({
        type: 'gatling-scenario:cancelled',
        payload: { run_id: runId, status: 'cancelled' },
      });
      return { status: 200, body: { run_id: runId, status: 'cancelling' } };
    },
  );

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/scenarios/generate-async',
    (req, store, jobs) => {
      settle();
      const projectId = req.params.project_id;
      requireProject(store, projectId);
      const body = (req.body ?? {}) as {
        flow_id?: string;
        scenario_name?: string;
        class_mix?: Record<string, number> | null;
      };
      const flowId = body.flow_id ?? '';
      const classMix = body.class_mix ?? null;
      const scenarioName =
        body.scenario_name === undefined || body.scenario_name === 'Generated Scenario'
          ? null
          : body.scenario_name;
      const queued = scripts.get(flowId) ?? [];
      const script = queued.shift() ?? fallback;
      const refused = refusal(store, projectId, flowId, classMix);
      const outcome = refused ?? script.outcome ?? 'complete';
      const endMs =
        script.endedBeforeAnswer === true
          ? 0
          : refused === undefined
            ? (script.endAfterMs ?? DEFAULT_END_MS)
            : EARLY_ERROR_MS;
      const final =
        outcome === 'complete' ? 'done' : outcome === 'cancelled' ? 'cancelled' : 'failed';
      const job = jobs.start('scenario_generation', {
        steps:
          endMs === 0
            ? [{ afterMs: 0, state: final }]
            : [
                { afterMs: 0, state: 'running' },
                { afterMs: endMs, state: final },
              ],
      });
      const run: StartedRun = {
        job,
        projectId,
        flowId,
        scenarioName,
        classMix,
        endsAt: job.startedAt + endMs,
        plannedId: outcome === 'complete' ? plannedId(store, flowId, started) : null,
        scenarioId: null,
      };
      started.push(run);

      const terminal =
        outcome === 'complete'
          ? null
          : outcome === 'cancelled'
            ? {
                type: 'gatling-scenario:cancelled',
                payload: { run_id: job.id, status: 'cancelled' },
              }
            : {
                type: 'gatling-scenario:error',
                payload: {
                  error: outcome.error,
                  recoverable: outcome.recoverable ?? true,
                  ...(outcome.status_code === undefined
                    ? {}
                    : { status_code: outcome.status_code }),
                  ...('refusal' in outcome && outcome.refusal !== undefined
                    ? { refusal: outcome.refusal }
                    : {}),
                },
              };
      const channel = fake.channel('scenario', { run_id: job.id });
      const last = terminal ?? {
        type: 'gatling-scenario:complete',
        payload: { run_id: job.id, scenario_id: run.plannedId ?? '', status: 'completed' },
      };
      if (script.silent !== true && endMs === 0) {
        settle();
        channel.emit(last);
      } else if (script.silent !== true) {
        const progress =
          refused === undefined
            ? (script.progress ?? DEFAULT_PROGRESS).filter((step) => step.afterMs < endMs)
            : [];
        channel.attach(job, [
          ...progress.map((step) => ({
            afterMs: step.afterMs,
            frame: {
              type: 'gatling-scenario:progress',
              payload: {
                status: 'in_progress',
                progress: step.progress,
                current_step: step.step,
                step_label: step.label,
              },
            },
          })),
          { afterMs: endMs, frame: last },
        ]);
      }
      return { status: 200, body: { run_id: job.id, status: 'started' } };
    },
  );

  return control;
}
