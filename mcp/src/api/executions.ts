// Starting a test run: the environment the run targets (its protection and load limits, read
// strictly), and the two starts — a composition (`POST …/compositions/{id}/execute`) or a single
// scenario (`POST …/executions`). The load always travels inside `workload`, thresholds included:
// keys at the top level of either body are dropped by the backend without an error
// (`ExecuteCompositionBody`, `api/routes/gatling_compositions.py:400-420`; `StartExecutionBody`,
// `api/routes/gatling.py:1085-1101`; loadcraft commit d93e08d80).

import * as z from 'zod';

import { ToolError } from '../errors.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { callOperation } from '../http/operation.js';
import type { ToolContext } from '../context.js';
import type { ProfileType } from '../profiles/presets.js';
import { must, stopRequest, type ApiContext } from './context.js';
import { reads, type ResponseOf } from '../contract/reads.js';

/** Load limits of an environment; a limit the environment does not set is absent. */
export interface RunCaps {
  readonly maxVu?: number;
  readonly maxRps?: number;
}

export interface RunEnvironment {
  readonly id: string;
  readonly name: string;
  readonly protected: boolean;
  /** `null`: a limit is set but is not a number of at least one, so it cannot be applied. */
  readonly caps: RunCaps | null;
}

/** `SlaThreshold` variants the plugin sends (`domain/models/sla_threshold.py:55-103`). */
export type SlaThreshold =
  | { readonly type: 'responseTime'; readonly percentile: 95; readonly max_ms: number }
  | { readonly type: 'failedRequests'; readonly max_percent: number };

/** `WorkloadBody` as the plugin fills it (`api/routes/gatling.py:974-1082`, `extra='forbid'`). */
export interface RunWorkload {
  readonly type: ProfileType;
  readonly vusers: number;
  readonly ramp: number;
  readonly hold: number;
  readonly thresholds?: SlaThreshold[];
}

export interface RunRequest {
  readonly environmentId: string;
  readonly workload: RunWorkload;
}

const CAP_KEYS = ['max_vu', 'max_rps'] as const;

/**
 * Limits as the run admission sees them: a key that is present and not null counts as a limit
 * (`has_configured_caps`, `domain/services/gatling/run_admission.py:61-66`). A limit the plugin
 * cannot apply is reported as `null` rather than dropped, so it never reads as "no limit".
 */
function strictCaps(raw: unknown): RunCaps | null {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const values = raw as Record<string, unknown>;
  const caps: { maxVu?: number; maxRps?: number } = {};
  for (const key of CAP_KEYS) {
    const value = values[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return null;
    if (key === 'max_vu') caps.maxVu = value;
    else caps.maxRps = value;
  }
  return caps;
}

/** The environment a run will target, by id; `not_found` when the project has no such row. */
export async function getRunEnvironment(
  api: ApiContext & Pick<ToolContext, 'secrets'>,
  projectId: string,
  environmentId: string,
): Promise<RunEnvironment> {
  // The list holds the environments' own secrets (variables, headers, auth): they are registered
  // with the call before any later refusal of LoadCraft can quote them.
  const data = await callOperation(
    api.services.http,
    'list_project_environments_api_v1_projects__project_id__environments_get',
    { path: { project_id: projectId } },
    { signal: api.signal, secrets: api.secrets },
  );
  const item = data.items.find((candidate) => candidate.id === environmentId);
  if (item === undefined) throw new ToolError('not_found', { params: { available: '' } });
  return {
    id: item.id,
    name: item.name,
    protected: item.protected,
    caps: strictCaps(item.workload_caps),
  };
}

/** The body of `workload`; an empty list of thresholds is left out. */
function workloadBody(workload: RunWorkload): RunWorkload {
  const { type, vusers, ramp, hold, thresholds } = workload;
  return {
    type,
    vusers,
    ramp,
    hold,
    ...(thresholds === undefined || thresholds.length === 0 ? {} : { thresholds }),
  };
}

/**
 * A scenario without a modular build cannot run (409, the detail sentence starts with the code:
 * `_full_rebuild_required_detail`, `api/routes/gatling.py:10522`; the composition gate,
 * `api/routes/gatling_compositions.py:7652`).
 */
async function starting<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (
      error instanceof LoadcraftApiError &&
      error.status === 409 &&
      error.message.startsWith('full_rebuild_required')
    ) {
      throw new ToolError('run_needs_rebuild', { cause: error });
    }
    throw error;
  }
}

const compositionStarted = reads<
  ResponseOf<'/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/execute', 'post'>
>()(z.object({ execution_id: z.string().min(1) }));
const scenarioStarted = reads<
  ResponseOf<'/api/v1/projects/{project_id}/gatling/executions', 'post'>
>()(z.object({ id: z.string().min(1) }));

/** The id of the started run; an answer without one did not come from the run API. */
function startedId<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ToolError('bad_gateway');
  return parsed.data;
}

/** Starts a run of the composition with exactly this load; returns the execution id. */
export async function startCompositionRun(
  api: ApiContext,
  projectId: string,
  compositionId: string,
  request: RunRequest,
): Promise<string> {
  const data = await starting(
    must(
      api.services.http.POST(
        '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/execute',
        {
          params: { path: { project_id: projectId, composition_id: compositionId } },
          body: {
            environment_id: request.environmentId,
            workload: workloadBody(request.workload),
          },
          signal: api.signal,
        },
      ),
    ),
  );
  return startedId(compositionStarted, data).execution_id;
}

/** Starts a run of one scenario with exactly this load; returns the execution id. */
export async function startScenarioRun(
  api: ApiContext,
  projectId: string,
  scenarioId: string,
  request: RunRequest,
): Promise<string> {
  const data = await starting(
    must(
      api.services.http.POST('/api/v1/projects/{project_id}/gatling/executions', {
        params: { path: { project_id: projectId } },
        body: {
          scenario_id: scenarioId,
          environment_id: request.environmentId,
          workload: workloadBody(request.workload),
        },
        signal: api.signal,
      }),
    ),
  );
  return startedId(scenarioStarted, data).id;
}

// ---- following a run -----------------------------------------------------------------------------
//
// The state of a started run comes from `GET …/gatling/executions/{id}` (`get_execution`,
// `api/routes/gatling.py:13274`), the numbers of a run under way from `GET …/executions/{id}/result`
// (`get_execution_result`, `api/routes/gatling_results.py:613`): for a run in flight the backend
// answers from the metrics store, and while that has no series yet it waits up to 30 s.

export const RUN_STATUSES = [
  'pending',
  'building',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface RunRow {
  readonly status: RunStatus;
  /** Epoch ms; absent while the backend has not stamped the moment. */
  readonly createdAt: number | null;
  /** The container start, so it excludes the build. */
  readonly startedAt: number | null;
  /** Measured load window of a finished run, seconds. */
  readonly durationS: number | null;
  readonly errorMessage: string | null;
}

/** What a run under way, or a finished one, shows of its numbers. */
export interface RunNumbers {
  readonly rps: number | null;
  /** `histogram_quantile` over the run: an estimate, never Gatling's own percentile. */
  readonly p95Ms: number | null;
  /** A fraction, 0 to 1. */
  readonly errorRate: number | null;
  /** Requests per second over time, oldest first. */
  readonly series: readonly number[];
}

const nullableNumber = z
  .number()
  .finite()
  .nullish()
  .catch(null)
  .transform((value) => value ?? null);

/** The backend stamps naive UTC times (`isoformat()` without an offset); one without it is UTC. */
function parseTime(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const text = /(?:Z|[+-]\d{2}:?\d{2})$/u.test(value) ? value : `${value}Z`;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : at;
}

const rowSchema = reads<
  ResponseOf<'/api/v1/projects/{project_id}/gatling/executions/{execution_id}', 'get'>
>()(
  z.object({
    status: z.string(),
    created_at: z.unknown(),
    started_at: z.unknown(),
    duration_seconds: nullableNumber,
    error_message: z
      .string()
      .nullish()
      .catch(null)
      .transform((value) => value ?? null),
  }),
);

function isRunStatus(value: string): value is RunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value);
}

/** The run row; `bad_gateway` for an answer that is not a run row or names a status outside E.4. */
export async function readRun(
  api: ApiContext,
  projectId: string,
  executionId: string,
): Promise<RunRow> {
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/gatling/executions/{execution_id}', {
      params: { path: { project_id: projectId, execution_id: executionId } },
      signal: api.signal,
    }),
  );
  const parsed = rowSchema.safeParse(data);
  if (!parsed.success) throw new ToolError('bad_gateway');
  const row = parsed.data;
  const status = row.status;
  if (!isRunStatus(status)) throw new ToolError('bad_gateway');
  return {
    status,
    createdAt: parseTime(row.created_at),
    startedAt: parseTime(row.started_at),
    durationS: row.duration_seconds,
    errorMessage: row.error_message,
  };
}

/** Stops a run that is pending, building or running; `false` when it was not running. */
export function cancelRun(
  api: ApiContext,
  projectId: string,
  executionId: string,
): Promise<boolean> {
  return stopRequest(async () => {
    await must(
      api.services.http.POST(
        '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/cancel',
        {
          params: { path: { project_id: projectId, execution_id: executionId } },
          signal: api.signal,
        },
      ),
    );
    return true;
  });
}

const resultSchema = reads<
  ResponseOf<'/api/v1/projects/{project_id}/gatling/executions/{execution_id}/result', 'get'>
>()(
  z.object({
    requests_per_second: nullableNumber,
    p95_histogram: nullableNumber,
    error_rate: nullableNumber,
    time_series_data: z
      .array(z.object({ requests_per_second: nullableNumber }))
      .catch([])
      .default([]),
  }),
);

/** Longest the metrics store may take to answer; the backend itself waits up to 30 s for a series. */
export const RESULT_TIMEOUT_MS = 35_000;

/**
 * The numbers of a run: counters, throughput, the p95 estimate and the throughput series. An
 * answer that carries none of them is a run without numbers yet, not an error.
 */
export async function readRunNumbers(
  api: ApiContext,
  projectId: string,
  executionId: string,
): Promise<RunNumbers> {
  const data = await must(
    api.services.http.GET(
      '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/result',
      {
        params: { path: { project_id: projectId, execution_id: executionId } },
        signal: api.signal,
      },
    ),
  );
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) return { rps: null, p95Ms: null, errorRate: null, series: [] };
  const result = parsed.data;
  const series = result.time_series_data.flatMap((row) =>
    row.requests_per_second === null ? [] : [row.requests_per_second],
  );
  return {
    // The newest point is what the run does now; the mean over the whole run is the fallback.
    rps: series.at(-1) ?? result.requests_per_second,
    p95Ms: result.p95_histogram,
    errorRate: result.error_rate,
    series,
  };
}

/** Executions the project list returns at most (`list_executions`, newest first). */
const LIST_LIMIT = 100;

/** Statuses after which a run no longer loads anything (`ExecutionStatus`, `domain/models/enums.py:10-17`). */
const FINISHED_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

/**
 * How long after its creation a run can still be going. The load window by type of workload
 * (`_during_equivalent_seconds`, `domain/services/gatling/codegen/injection_builder.py:789-813`,
 * loadcraft 7d383e0ec), with `ramp` and `hold` at most 86400 s each (`WorkloadBody`,
 * `api/routes/gatling.py:1005-1006`):
 * - stress: `STRESS_LEVELS * max(ramp, STRESS_MIN_LEVEL_SECONDS)` (`injection_builder.py:810-811`,
 *   `:894`, `:899`), so 5 * 86400 s = 120 h: the longest of all;
 * - soak: `max(ramp, 1) + hold` (`:806-807`), at most 48 h;
 * - spike and ramp: `ramp + hold` (`:808-809`), at most 48 h;
 * - production plan: `MAX_PLAN_SECONDS` = 86400 s (`domain/models/production_traffic.py:525`).
 * The build before the load is given an hour. A run created longer ago than this is over.
 */
const RUN_MAX_AGE_MS = (5 * 86_400 + 3_600) * 1000;

/** Fields of a list answer that say there are rows the answer does not hold. */
const MORE_MARKERS = ['next', 'next_cursor', 'next_page', 'next_offset', 'cursor'] as const;
const MORE_FLAGS = ['has_more', 'truncated', 'partial'] as const;

/** A run of the project that is going on, and whether its manifest names the environment asked about. */
export interface ActiveRun {
  readonly id: string;
  /** False for a run whose manifest is not written yet: it is being built, its environment unknown. */
  readonly onEnvironment: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Does the answer admit, or by its size allow, that rows of the project are not in it? */
function saysMore(answer: Record<string, unknown>, rows: number): boolean {
  const total = answer['total'];
  if (total !== undefined && total !== null && (typeof total !== 'number' || total > rows)) {
    return true;
  }
  if (MORE_MARKERS.some((key) => answer[key] !== undefined && answer[key] !== null)) return true;
  return MORE_FLAGS.some((key) => answer[key] !== undefined && answer[key] !== false);
}

/** Occupancy that cannot be established; `reason` is a short code shown in the text. */
function unknownOccupancy(reason: string, cause?: unknown): ToolError {
  return new ToolError('run_occupancy_unknown', {
    params: { reason },
    ...(cause === undefined ? {} : { cause }),
  });
}

/**
 * A full page is all there is to know when its oldest row (the list is newest first) was created
 * longer ago than a run can last: nothing older can still be going. A row without a readable
 * `created_at` leaves it open.
 */
function pageReachesBack(rows: readonly unknown[], now: number): boolean {
  let oldest: number | null = null;
  for (const row of rows) {
    if (!isRecord(row)) return false;
    const at = parseTime(row['created_at']);
    if (at === null) return false;
    if (oldest === null || at < oldest) oldest = at;
  }
  return oldest !== null && now - oldest > RUN_MAX_AGE_MS;
}

/**
 * Runs of the project that are going on right now and may load this environment, whoever started
 * them. The list has no state filter and no way to ask for a next page, so the newest 100 rows are
 * read and cut here. A row counts unless it is finished (`completed`, `failed`, `cancelled`): a
 * status the plugin does not know counts as under way, so a new state of a run never reads as
 * free. A row a process of LoadCraft no longer drives (`supervised` false: a run lost in a restart)
 * and a self-check (one user, one pass) do not count. The manifest, which names the environment,
 * is written only after the build, so a row without it is counted as possibly on this environment
 * (`onEnvironment: false`); one whose manifest names another environment is not.
 *
 * Whether the environment is free is known only from a list that was read to the end. An answer
 * that is not a list, a row without an id or a status, and a list that is full or says it has more
 * rows leave the question open when no running test was found in it: that is `run_occupancy_unknown`,
 * never an empty result. A running test found in a list that is cut still settles it as busy. A
 * full page settles it as well when its oldest row is older than a run can last (`now`, epoch ms).
 */
export async function listActiveRuns(
  api: ApiContext,
  projectId: string,
  environmentId: string,
  now: number,
): Promise<ActiveRun[]> {
  const underWay = await readUnderWayRuns(api, projectId, now);
  return underWay.flatMap((run): ActiveRun[] => {
    if (run.environmentId === null) return [{ id: run.id, onEnvironment: false }];
    return run.environmentId === environmentId ? [{ id: run.id, onEnvironment: true }] : [];
  });
}

/** A row of the list of the project's runs that counts as going on. */
interface UnderWayRun {
  readonly id: string;
  /** The status as the backend sent it: one the plugin does not know counts as under way too. */
  readonly status: string;
  /** The environment the manifest names; null while no manifest is written. */
  readonly environmentId: string | null;
}

/**
 * The one reader of the project's list of runs, for the occupancy of an environment and for what
 * `process_cancel` can stop: the rows that are going on (see `listActiveRuns`), or `run_occupancy_unknown`
 * when the list cannot be read to the end and no such row was found in it.
 */
async function readUnderWayRuns(
  api: ApiContext,
  projectId: string,
  now: number,
): Promise<UnderWayRun[]> {
  let data: unknown;
  try {
    data = await must(
      api.services.http.GET('/api/v1/projects/{project_id}/gatling/executions', {
        params: { path: { project_id: projectId }, query: { limit: LIST_LIMIT } },
        signal: api.signal,
      }),
    );
  } catch (error) {
    // An answer that is not JSON at all (a proxy page, a body cut in the middle) is no list either.
    if (error instanceof SyntaxError) throw unknownOccupancy('not_json', error);
    // A server that fails to list its runs does not say that none is going on.
    if (error instanceof LoadcraftApiError && error.status >= 500) {
      throw unknownOccupancy(`http_${String(error.status)}`, error);
    }
    throw error;
  }
  if (!isRecord(data) || !Array.isArray(data['executions'])) {
    throw unknownOccupancy('not_a_list');
  }
  const rows: unknown[] = data['executions'];
  let reason = 'rows_unreadable';
  let unreadable = false;
  if (saysMore(data, rows.length)) {
    unreadable = true;
    reason = 'list_cut';
  } else if (rows.length >= LIST_LIMIT && !pageReachesBack(rows, now)) {
    unreadable = true;
    reason = 'page_too_recent';
  }
  const active: UnderWayRun[] = [];
  for (const row of rows) {
    if (!isRecord(row) || typeof row['id'] !== 'string' || row['id'] === '') {
      unreadable = true;
      continue;
    }
    const status = row['status'];
    if (typeof status !== 'string' || status === '') {
      unreadable = true;
      continue;
    }
    if (FINISHED_STATUSES.has(status) || row['supervised'] === false) continue;
    if (row['source'] === 'self_check') continue;
    const manifest = row['run_manifest'];
    const named = isRecord(manifest) ? manifest['target_environment_id'] : null;
    active.push({
      id: row['id'],
      status,
      environmentId: typeof named === 'string' && named !== '' ? named : null,
    });
  }
  if (active.length === 0 && unreadable) throw unknownOccupancy(reason);
  return active;
}

/** A test of the project that is under way: what `process_cancel` can stop. */
export interface RunningExecution {
  readonly id: string;
  readonly status: 'pending' | 'building' | 'running';
}

/**
 * Tests of the project that are under way right now, whoever started them and whatever
 * environment they load. The same rows, the same strict reading and the same cut as `listActiveRuns`
 * (newest 100, a process of LoadCraft still drives the run, not a self-check), without the environment;
 * a list that cannot be read to the end is `run_occupancy_unknown`, not "nothing is running".
 */
export async function listRunningExecutions(
  api: ApiContext,
  projectId: string,
  now: number,
): Promise<RunningExecution[]> {
  const underWay = await readUnderWayRuns(api, projectId, now);
  return underWay.flatMap((run): RunningExecution[] => {
    const status = run.status;
    // Only these three can be stopped; a state the plugin does not know is not offered.
    if (status !== 'pending' && status !== 'building' && status !== 'running') return [];
    return [{ id: run.id, status }];
  });
}
