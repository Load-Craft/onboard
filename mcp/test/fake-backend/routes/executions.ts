// Run starts of the fake backend: `POST …/gatling/compositions/{id}/execute` and
// `POST …/gatling/executions`. The fake starts exactly the load it is sent, without looking at the
// limits of the environment, so a test reads from `startedRuns` the load the plugin asked for. The workload is checked as `WorkloadBody` checks it (`extra='forbid'`,
// `api/routes/gatling.py:974-1082`); unknown keys at the top level are ignored, as the backend
// ignores them. Registration is idempotent per fake.

import type { Clock } from '../../../src/ops/clock.js';
import type { Fake } from '../server.js';
import { FakeHttpError } from '../server.js';
import { SKLEP_COLLECTIONS, type SklepComposition, type SklepScenario } from '../worlds/sklep.js';

/** Collection of the runs started through these routes (status stays `pending`). */
export const STARTED_RUNS = 'started_runs';

/** A started run as the fake keeps it: the body it was started with, untouched. */
export interface StartedRun {
  id: string;
  kind: 'composition' | 'scenario';
  target_id: string;
  environment_id: string | null;
  workload: Record<string, unknown> | null;
  /** The whole request body, top-level keys the backend ignores included. */
  body: Record<string, unknown>;
  status: 'pending';
  /** Clock time of the start, when the fake runs scripted runs (`scriptRuns`). */
  started_ms: number | null;
}

const registered = new WeakSet<Fake>();
const scripts = new WeakMap<Fake, { clock: ScriptClock; script: RunScript }>();
const plannedIds = new WeakMap<Fake, string[]>();

/** The next runs started on this fake get these ids, in order (then generated ones). */
export function planExecutionIds(fake: Fake, ids: readonly string[]): void {
  plannedIds.set(fake, [...(plannedIds.get(fake) ?? []), ...ids]);
}

/** Runs started on the fake, oldest first. */
export function startedRuns(fake: Fake): StartedRun[] {
  return fake.store.collection<StartedRun>(STARTED_RUNS).list();
}

const WORKLOAD_KEYS: ReadonlySet<string> = new Set([
  'type',
  'vusers',
  'ramp',
  'hold',
  'steps_digest',
  'think_time_digest',
  'production',
  'thresholds',
  'injector',
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 422 in FastAPI's validation shape for a workload `WorkloadBody` would refuse. */
function checkWorkload(workload: unknown): Record<string, unknown> | null {
  if (workload === undefined || workload === null) return null;
  const invalid = (loc: string[], msg: string): never => {
    throw new FakeHttpError(422, {
      detail: [{ loc: ['body', 'workload', ...loc], msg, type: 'value_error' }],
    });
  };
  if (!isObject(workload)) return invalid([], 'Input should be a valid dictionary');
  for (const key of Object.keys(workload)) {
    if (!WORKLOAD_KEYS.has(key)) invalid([key], 'Extra inputs are not permitted');
  }
  const { vusers } = workload;
  if (typeof vusers !== 'number' || !Number.isInteger(vusers) || vusers < 1 || vusers > 1_000_000) {
    invalid(['vusers'], 'Input should be an integer between 1 and 1000000');
  }
  return workload;
}

function requireProject(fake: Fake, id: string): void {
  fake.store.collection(SKLEP_COLLECTIONS.projects).require(id, `Project not found: ${id}`);
}

function start(fake: Fake, kind: StartedRun['kind'], targetId: string, raw: unknown): StartedRun {
  const body = isObject(raw) ? raw : {};
  const environmentId = typeof body.environment_id === 'string' ? body.environment_id : null;
  if (environmentId !== null) {
    fake.store
      .collection(SKLEP_COLLECTIONS.environments)
      .require(environmentId, `Environment not found: ${environmentId}`);
  }
  const workload = checkWorkload(body.workload);
  const queue = plannedIds.get(fake) ?? [];
  const id = queue.shift() ?? fake.store.newId();
  return fake.store.collection<StartedRun>(STARTED_RUNS).insert({
    id,
    kind,
    target_id: targetId,
    environment_id: environmentId,
    workload,
    body,
    status: 'pending',
    started_ms: scripts.get(fake)?.clock.now() ?? null,
  });
}

export function registerExecutionRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/execute',
    (req, store) => {
      requireProject(fake, req.params.project_id);
      store
        .collection<SklepComposition>(SKLEP_COLLECTIONS.compositions)
        .require(req.params.composition_id, 'Composition not found');
      const run = start(fake, 'composition', req.params.composition_id, req.body);
      return {
        status: 202,
        body: {
          execution_id: run.id,
          status: 'pending' as const,
          message: 'Composition execution started',
          ws_url: `/ws/gatling/executions/${run.id}`,
          warnings: [],
        },
      };
    },
  );

  fake.route('POST', '/api/v1/projects/{project_id}/gatling/executions', (req, store) => {
    requireProject(fake, req.params.project_id);
    const body = isObject(req.body) ? req.body : {};
    const scenarioId = typeof body.scenario_id === 'string' ? body.scenario_id : '';
    store
      .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
      .require(scenarioId, 'Scenario not found');
    const run = start(fake, 'scenario', scenarioId, body);
    return {
      status: 200,
      body: { id: run.id, status: 'pending' as const, message: 'Execution started' },
    };
  });
}

// ---- scripted runs ---------------------------------------------------------------------------
//
// `GET …/gatling/executions/{id}` and `GET …/{id}/result` for a run that follows a script on the
// test clock: building, then load, then an end. The row carries naive UTC times, as the backend's
// `isoformat()` does.

type ScriptClock = Pick<Clock, 'now'> & { sleep(ms: number, signal?: AbortSignal): Promise<void> };

export interface LiveSample {
  rps: number;
  p95: number;
  errorRate: number;
}

export interface RunScript {
  /** Seconds the run was created before the start call returned (the row's `created_at`). */
  createdBeforeS?: number;
  /** Seconds from the start to the start of the load (`started_at`). */
  startsAtS: number;
  /** Seconds of load. */
  loadS: number;
  /** Seconds of load of one run, instead of `loadS` (the stand-alone fake reads the started profile). */
  loadOf?: (run: StartedRun) => number;
  /** How the run ends. */
  end: 'completed' | 'failed' | 'cancelled';
  /** Seconds of load after which a `failed` or `cancelled` run ends. */
  endsAfterS?: number;
  errorMessage?: string;
  /** Numbers of the run in flight, by seconds of load. */
  live(elapsedS: number): LiveSample;
  /** Numbers of the finished run. */
  final: LiveSample;
  /** Requests per second over the run, as the result lists them (10 s apart). */
  series: readonly number[];
  /** Seconds the result of a run in flight takes to answer, or `fail` for a 503. */
  resultDelayS?: number;
  resultFails?: boolean;
  /** The run row disappears (a restarted backend) after this many seconds. */
  forgottenAfterS?: number;
}

const isoNaive = (ms: number): string => new Date(ms).toISOString().replace('Z', '');

interface Phase {
  status: 'building' | 'running' | 'completed' | 'failed' | 'cancelled';
  elapsedS: number;
}

function phaseOf(script: RunScript, sinceS: number, loadS = script.loadS): Phase {
  if (sinceS < script.startsAtS) return { status: 'building', elapsedS: 0 };
  const elapsedS = sinceS - script.startsAtS;
  const endsAt = script.end === 'completed' ? loadS : (script.endsAfterS ?? loadS);
  return elapsedS >= endsAt
    ? { status: script.end, elapsedS: endsAt }
    : { status: 'running', elapsedS };
}

/**
 * Makes every run started on this fake follow `script`. Registers the routes once; a second call
 * replaces the script.
 */
export function scriptRuns(fake: Fake, clock: ScriptClock, script: RunScript): void {
  const first = !scripts.has(fake);
  scripts.set(fake, { clock, script });
  if (!first) return;
  const current = () => {
    const entry = scripts.get(fake);
    if (entry === undefined) throw new Error('scriptRuns: no script');
    return entry;
  };
  const find = (id: string): StartedRun & { since: number } => {
    const run = startedRuns(fake).find((candidate) => candidate.id === id);
    if (run === undefined || run.started_ms === null) {
      throw new FakeHttpError(404, { detail: `Execution not found: ${id}` });
    }
    const { clock: now, script: s } = current();
    const since = (now.now() - run.started_ms) / 1000;
    if (s.forgottenAfterS !== undefined && since >= s.forgottenAfterS) {
      throw new FakeHttpError(404, { detail: `Execution not found: ${id}` });
    }
    return { ...run, since };
  };

  // Runs stopped by `…/cancel`: the seconds since the start at which that happened.
  const cancelledAt = new Map<string, number>();
  /** The script's phase, unless the run was cancelled while it was still going. */
  const phaseFor = (run: StartedRun & { since: number }): Phase => {
    const { script: s } = current();
    const phase = phaseOf(s, run.since, s.loadOf?.(run) ?? s.loadS);
    const stoppedAt = cancelledAt.get(run.id);
    const going = phase.status === 'building' || phase.status === 'running';
    if (stoppedAt === undefined || !going) return phase;
    return { status: 'cancelled', elapsedS: Math.max(0, stoppedAt - s.startsAtS) };
  };

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/cancel',
    (req) => {
      const run = find(req.params.execution_id);
      const phase = phaseFor(run);
      if (phase.status !== 'building' && phase.status !== 'running') {
        throw new FakeHttpError(409, {
          detail: `Execution is not running (status: ${phase.status})`,
        });
      }
      cancelledAt.set(run.id, run.since);
      return { status: 200, body: { message: 'Execution cancelled' } };
    },
  );

  fake.route('GET', '/api/v1/projects/{project_id}/gatling/executions/{execution_id}', (req) => {
    const run = find(req.params.execution_id);
    const { script: s } = current();
    const phase = phaseFor(run);
    const startMs = run.started_ms ?? 0;
    const terminal = phase.status !== 'building' && phase.status !== 'running';
    return {
      status: 200,
      body: {
        id: run.id,
        status: phase.status,
        scenario_id: run.kind === 'scenario' ? run.target_id : null,
        composite_id: run.kind === 'composition' ? run.target_id : null,
        configuration_id: null,
        created_at: isoNaive(startMs - (s.createdBeforeS ?? 0) * 1000),
        started_at: phase.status === 'building' ? null : isoNaive(startMs + s.startsAtS * 1000),
        completed_at: terminal ? isoNaive(startMs + (s.startsAtS + phase.elapsedS) * 1000) : null,
        duration_seconds: terminal ? phase.elapsedS : null,
        error_message: phase.status === 'failed' ? (s.errorMessage ?? null) : null,
        warnings: [],
        // What a run that has not been read back yet carries: no verdict, no result, no manifest.
        load_window_state: terminal ? ('measured' as const) : ('pending' as const),
        run_exit_code: null,
        sla_verdict: null,
        invariant_summary: null,
        result_has_errors: false,
        total_requests: null,
        ok_count: null,
        ko_count: null,
        logs: null,
        run_manifest_state: 'pending' as const,
        run_manifest: null,
      },
    };
  });

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/result',
    async (req) => {
      const run = find(req.params.execution_id);
      const { clock: now, script: s } = current();
      const phase = phaseFor(run);
      const terminal = phase.status !== 'building' && phase.status !== 'running';
      if (!terminal && s.resultDelayS !== undefined) await now.sleep(s.resultDelayS * 1000);
      if (!terminal && s.resultFails === true) {
        throw new FakeHttpError(503, { detail: 'Metrics backend unreachable' });
      }
      const sample = terminal ? s.final : s.live(phase.elapsedS);
      const rows = terminal
        ? s.series.map((rps, index) => ({ elapsed_seconds: index * 10, requests_per_second: rps }))
        : [{ elapsed_seconds: Math.floor(phase.elapsedS), requests_per_second: sample.rps }];
      return {
        status: 200,
        body: {
          aggregates_source: terminal ? ('persisted' as const) : ('prometheus' as const),
          series_source: 'prometheus' as const,
          series_retention: null,
          requests_per_second: sample.rps,
          p95_histogram: sample.p95,
          error_rate: sample.errorRate,
          // A run in flight has no stored peak.
          peak_active_users: null,
          time_series_data: rows,
          // The live read carries the series and the headline numbers only.
          duration_seconds: null,
          throughput: null,
          total_requests: 0,
          ok_requests: 0,
          ko_requests: 0,
          ok_count: 0,
          ko_count: 0,
          mean_response_time: null,
          min_response_time: null,
          max_response_time: null,
          min_source: 'not-measured' as const,
          max_source: 'not-measured' as const,
          percentile_source: 'not-measured' as const,
          p50: null,
          p75: null,
          p90: null,
          p95: null,
          p99: null,
          p50_histogram: null,
          p75_histogram: null,
          p90_histogram: null,
          p99_histogram: null,
          endpoints: [],
          errors: [],
          error_summary: null,
          error_traces: [],
          per_request: [],
        },
      };
    },
  );
}

// ---- runs started by somebody else ----------------------------------------------------------

export interface ForeignRun {
  id: string;
  status: 'pending' | 'building' | 'running' | 'queued' | 'completed';
  environment_id: string | null;
  supervised?: boolean;
  source?: string | null;
  /** ISO moment the row was created; the list is newest first (default: the epoch). */
  created_at?: string;
}

/**
 * A run somebody else started, as the project's run list (`lookup.ts`) shows it: the row of the
 * list with the manifest that names its environment (absent while the manifest is not written).
 */
export function seedForeignRun(fake: Fake, run: ForeignRun): void {
  fake.store.collection(SKLEP_COLLECTIONS.executions).insert(foreignRunRow(run));
}

/** The row of the project's run list for a run somebody else started. */
export function foreignRunRow(run: ForeignRun) {
  const manifest = run.environment_id === null ? null : foreignManifest(run.environment_id);
  return {
    id: run.id,
    status: run.status,
    supervised: run.supervised ?? true,
    source: run.source ?? null,
    created_at: run.created_at ?? new Date(0).toISOString(),
    // The rest of the row is what a run that has produced nothing yet carries.
    scenario_id: null,
    composite_id: null,
    configuration_id: null,
    started_at: null,
    completed_at: null,
    duration_seconds: null,
    error_message: null,
    has_result: false,
    invariant_summary: null,
    ko_count: null,
    ok_count: null,
    total_requests: null,
    logs: null,
    load_window_state: 'pending',
    result_has_errors: false,
    run_exit_code: null,
    run_manifest: manifest,
    run_manifest_state: manifest === null ? 'pending' : 'captured',
    saved_run_id: null,
    saved_run_name: null,
    sla_verdict: null,
    warnings: [],
  };
}

/** A manifest that names the environment and nothing else. */
function foreignManifest(environmentId: string) {
  return {
    workload: null,
    proportions: null,
    target_base_url: null,
    target_environment_id: environmentId,
    target_environment_name: null,
    members: null,
    feeders: null,
  };
}
