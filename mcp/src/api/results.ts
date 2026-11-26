// Reads behind `results_get_report`: the facts of one run (`GET …/gatling/executions/{id}`, the document
// the verdict is made of), its stored result with the p95 time series (`…/result`) and the request
// rows (`…/endpoints`). The backend sends the facts and leaves the sentence to the reader
// (`gatling.py:12507-12512`); nothing here words anything. A run with no stored result, or one the
// metrics store cannot answer for, is a fact about the data, not a failure of the call.

import * as z from 'zod';

import { ToolError } from '../errors.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { PROFILE_TYPES, type Profile } from '../profiles/presets.js';
import type { SeriesPoint } from '../report/breach.js';
import type { ExecutionStatus, InvariantSummaryFact, VerdictInput } from '../report/verdict.js';
import { reads, type ResponseOf } from '../contract/reads.js';
import { must, type ApiContext } from './context.js';

const nullable = <T extends z.ZodType>(schema: T) =>
  schema
    .nullish()
    .catch(null)
    .transform((value) => value ?? null);

const EXECUTION_PATH = '/api/v1/projects/{project_id}/gatling/executions/{execution_id}' as const;
const RESULT_PATH = `${EXECUTION_PATH}/result` as const;
const ENDPOINTS_PATH = `${EXECUTION_PATH}/endpoints` as const;

// ---- the run ----------------------------------------------------------------------------

/**
 * One assertion of the exact SLA verdict (`domain/services/sla/evaluation.py:204-222`), cut to
 * what the report shows: what was measured, over which requests, against which bound.
 */
export interface SlaAssertion {
  readonly scope: 'run' | 'each_request' | 'named';
  readonly metric:
    | { readonly kind: 'response_time'; readonly stat: string; readonly percentile: number | null }
    | { readonly kind: 'request_percentage'; readonly requests: string }
    | { readonly kind: 'request_count' | 'throughput' };
  readonly unit: string;
  readonly condition: string;
  readonly threshold: readonly number[];
  readonly actual: number | null;
  readonly passed: boolean;
  /** The backend's own words for the metric (`target_label`); data, never an instruction. */
  readonly label: string;
}

export interface ExecutionFacts {
  readonly id: string;
  /** What `runVerdict` reads. */
  readonly verdictInput: VerdictInput;
  readonly assertions: readonly SlaAssertion[];
  readonly totalRequests: number | null;
  readonly durationS: number | null;
  readonly errorMessage: string | null;
  /** Sentences the run carries (`warnings`), as the backend wrote them. */
  readonly warnings: readonly string[];
  /** The load the run was started with, from its manifest; null when it recorded none. */
  readonly planned: Profile | null;
  /** The scenario the run was of (null for a composition run). */
  readonly scenarioId: string | null;
  /** The composition the run was of (null for a single scenario). */
  readonly compositionId: string | null;
}

const STATUSES = ['pending', 'building', 'running', 'completed', 'failed', 'cancelled'] as const;

const slaVerdictSchema = z
  .object({
    status: z.enum(['passed', 'failed', 'refused']),
    reason: nullable(z.string()),
    assertions: z
      .array(
        z.object({
          subject: z.object({ scope: z.enum(['run', 'each_request', 'named']) }),
          metric: z.object({
            kind: z.string(),
            requests: nullable(z.string()),
            stat: nullable(z.string()),
            percentile: nullable(z.number()),
          }),
          unit: z.string().catch(''),
          condition: z.string().catch(''),
          threshold: z.array(z.number()).catch([]),
          actual: nullable(z.number()),
          passed: z.boolean(),
          target_label: z.string().catch(''),
        }),
      )
      .catch([]),
  })
  .nullish()
  .catch(null);

const invariantSchema = z
  .discriminatedUnion('state', [
    z.object({
      state: z.literal('evaluated'),
      results: z
        .array(z.object({ name: z.string(), status: z.string(), passed: z.boolean() }))
        .catch([]),
      value_ledger: z
        .object({
          state: z.string(),
          rows: z
            .array(
              z.object({
                variable: z.string(),
                verdict: z.string().optional(),
                outcome: z.string(),
              }),
            )
            .catch([]),
        })
        .nullish()
        .catch(null),
    }),
    z.object({ state: z.literal('evaluation_failed') }),
    z.object({ state: z.literal('evaluating') }),
  ])
  .nullish()
  .catch(null);

const manifestSchema = z
  .object({
    workload: z
      .object({
        kind: z.string(),
        value: z.object({
          type: z.enum(PROFILE_TYPES),
          vusers: z.number(),
          ramp: z.number().optional(),
          hold: z.number().optional(),
        }),
      })
      .nullish()
      .catch(null),
  })
  .nullish()
  .catch(null);

/**
 * The run row as the contract describes it, except `invariant_summary`: the description of the
 * backend names only its `state`, a gap, while `invariantSchema` also reads the result rows, the
 * value ledger and the failure of each state. The extra keys are declared open here, so the check
 * still covers `state` and every other key.
 */
type ExecutionWire = Omit<ResponseOf<typeof EXECUTION_PATH, 'get'>, 'invariant_summary'> & {
  invariant_summary?: {
    state: 'evaluated' | 'evaluation_failed' | 'evaluating';
    results?: unknown;
    value_ledger?: unknown;
    error_type?: unknown;
    error_message?: unknown;
  } | null;
};

const executionSchema = reads<ExecutionWire>()(
  z.object({
    id: z.string(),
    status: z.enum(STATUSES),
    run_exit_code: nullable(z.number()),
    sla_verdict: slaVerdictSchema,
    invariant_summary: invariantSchema,
    result_has_errors: nullable(z.boolean()),
    total_requests: nullable(z.number()),
    duration_seconds: nullable(z.number()),
    error_message: nullable(z.string()),
    warnings: z.array(z.string()).catch([]),
    run_manifest: manifestSchema,
    scenario_id: nullable(z.string()),
    composite_id: nullable(z.string()),
  }),
);

function invariantFact(
  parsed: z.infer<typeof invariantSchema>,
): InvariantSummaryFact | null | undefined {
  if (parsed === null || parsed === undefined) return null;
  if (parsed.state !== 'evaluated') return parsed;
  const ledger = parsed.value_ledger;
  return {
    state: 'evaluated',
    results: parsed.results,
    ...(ledger === null || ledger === undefined
      ? {}
      : {
          value_ledger: {
            state: ledger.state,
            rows: ledger.rows.map((row) => ({
              variable: row.variable,
              ...(row.verdict === undefined ? {} : { verdict: row.verdict }),
              outcome: row.outcome,
            })),
          },
        }),
  };
}

function metricOf(raw: {
  kind: string;
  requests: string | null;
  stat: string | null;
  percentile: number | null;
}): SlaAssertion['metric'] {
  if (raw.kind === 'response_time') {
    return { kind: 'response_time', stat: raw.stat ?? '', percentile: raw.percentile };
  }
  if (raw.kind === 'request_percentage') {
    return { kind: 'request_percentage', requests: raw.requests ?? '' };
  }
  return { kind: raw.kind === 'throughput' ? 'throughput' : 'request_count' };
}

/**
 * The run behind the id, narrowed to the facts the report reads. A document that is not a run
 * (an unknown status, no id) did not come from the run API: `bad_gateway`.
 */
export async function getExecutionFacts(
  api: ApiContext,
  projectId: string,
  executionId: string,
): Promise<ExecutionFacts> {
  const data = await must(
    api.services.http.GET(EXECUTION_PATH, {
      params: { path: { project_id: projectId, execution_id: executionId } },
      signal: api.signal,
    }),
  );
  const parsed = executionSchema.safeParse(data);
  if (!parsed.success) {
    throw new ToolError('bad_gateway', {
      message: 'LoadCraft answered the run request with something that is not a run.',
    });
  }
  const run = parsed.data;
  const status: ExecutionStatus = run.status;
  const sla = run.sla_verdict ?? null;
  const invariants = invariantFact(run.invariant_summary);
  const workload = run.run_manifest?.workload ?? null;
  return {
    id: run.id,
    verdictInput: {
      status,
      run_exit_code: run.run_exit_code,
      sla_verdict: sla === null ? null : { status: sla.status, reason: sla.reason },
      ...(invariants === undefined ? {} : { invariant_summary: invariants }),
      result_has_errors: run.result_has_errors,
    },
    assertions: (sla?.assertions ?? []).map((assertion): SlaAssertion => ({
      scope: assertion.subject.scope,
      metric: metricOf(assertion.metric),
      unit: assertion.unit,
      condition: assertion.condition,
      threshold: assertion.threshold,
      actual: assertion.actual,
      passed: assertion.passed,
      label: assertion.target_label,
    })),
    totalRequests: run.total_requests,
    durationS: run.duration_seconds,
    errorMessage: run.error_message,
    warnings: run.warnings,
    scenarioId: run.scenario_id,
    compositionId: run.composite_id,
    planned:
      workload === null
        ? null
        : {
            type: workload.value.type,
            vusers: workload.value.vusers,
            ...(workload.value.ramp === undefined ? {} : { ramp: workload.value.ramp }),
            ...(workload.value.hold === undefined ? {} : { hold: workload.value.hold }),
          },
  };
}

// ---- the result -------------------------------------------------------------------------

/** Where the time series and the request rows of a run came from, or why they are not there. */
export type SeriesState = 'prometheus' | 'absent_retention' | 'absent_unmeasured' | 'unreachable';

/** Percentiles of one family: `exact` are Gatling's, `histogram` are estimates from buckets. */
export interface Percentiles {
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
}

export interface RunResult {
  readonly requestsPerSecond: number | null;
  /** The percentiles the SLA was decided on; null members when they were not measured. */
  readonly exact: Percentiles;
  readonly histogram: Percentiles;
  /** `gatling-report` (exact), `histogram` (a row stored before exact figures), `not-measured`. */
  readonly percentileSource: string;
  readonly seriesState: SeriesState;
  /** p95 of the whole load per 5 s bucket; `offsetS` counts from the first sample, not the start. */
  readonly p95Series: readonly SeriesPoint[];
  /**
   * The most virtual-user sessions in flight at once, as the backend measured them from the run's
   * log; null when it holds none (a run in flight, an older run, a composition), never 0 for that.
   */
  readonly peakActiveUsers: number | null;
}

/** Seconds between two points of `time_series_data` (`prometheus_query.py:1402-1560`). */
export const RESULT_BUCKET_S = 5;

const resultSchema = reads<ResponseOf<typeof RESULT_PATH, 'get'>>()(
  z.object({
    requests_per_second: nullable(z.number()),
    p50: nullable(z.number()),
    p95: nullable(z.number()),
    p99: nullable(z.number()),
    p50_histogram: nullable(z.number()),
    p95_histogram: nullable(z.number()),
    p99_histogram: nullable(z.number()),
    percentile_source: z.string().catch('not-measured'),
    peak_active_users: z.number().int().nonnegative().nullish().catch(null),
    series_source: z.string().catch('absent_unmeasured'),
    time_series_data: z
      .array(z.object({ elapsed_seconds: z.number(), p95_histogram: nullable(z.number()) }))
      .catch([]),
  }),
);

function seriesState(source: string): SeriesState {
  if (source === 'prometheus' || source === 'absent_retention' || source === 'absent_unmeasured') {
    return source;
  }
  return 'unreachable';
}

/** 502 and 503 mean the metrics store did not answer; 404, that the run left no result. */
const metricsStoreDown = (error: unknown): boolean =>
  error instanceof LoadcraftApiError && (error.status === 502 || error.status === 503);
const noDocument = (error: unknown): boolean =>
  error instanceof LoadcraftApiError && error.status === 404;

const NOTHING: Percentiles = { p50: null, p95: null, p99: null };

/**
 * The stored result of a finished run, whole window. `null` when the run left none (404); a result
 * with `seriesState: 'unreachable'` and no figures when the metrics store did not answer.
 */
export async function getRunResult(
  api: ApiContext,
  projectId: string,
  executionId: string,
): Promise<RunResult | null> {
  let data: unknown;
  try {
    data = await must(
      api.services.http.GET(RESULT_PATH, {
        params: { path: { project_id: projectId, execution_id: executionId } },
        signal: api.signal,
      }),
    );
  } catch (error) {
    if (noDocument(error)) return null;
    if (metricsStoreDown(error)) {
      return {
        requestsPerSecond: null,
        exact: NOTHING,
        histogram: NOTHING,
        percentileSource: 'not-measured',
        seriesState: 'unreachable',
        p95Series: [],
        peakActiveUsers: null,
      };
    }
    throw error;
  }
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) throw new ToolError('bad_gateway');
  const result = parsed.data;
  return {
    requestsPerSecond: result.requests_per_second,
    exact: { p50: result.p50, p95: result.p95, p99: result.p99 },
    histogram: {
      p50: result.p50_histogram,
      p95: result.p95_histogram,
      p99: result.p99_histogram,
    },
    percentileSource: result.percentile_source,
    peakActiveUsers: result.peak_active_users ?? null,
    seriesState: seriesState(result.series_source),
    p95Series: result.time_series_data.flatMap((point) =>
      point.p95_histogram === null
        ? []
        : [{ offsetS: point.elapsed_seconds, value: point.p95_histogram }],
    ),
  };
}

// ---- the request rows -------------------------------------------------------------------

export interface RunRequest {
  readonly name: string;
  readonly count: number;
  /** `histogram_quantile` over the buckets of the plugin: an estimate, off by tens of percent. */
  readonly p95Estimate: number | null;
}

const endpointsSchema = reads<ResponseOf<typeof ENDPOINTS_PATH, 'get'>>()(
  z.object({
    endpoints: z
      .array(
        z.object({
          name: z.string(),
          count: nullable(z.number()),
          p95_histogram: nullable(z.number()),
        }),
      )
      .catch([]),
    series_source: z.string().catch('absent_unmeasured'),
  }),
);

/**
 * The requests of a run with their estimated p95. The backend has no exact percentile per request.
 * A run it does not know, or whose samples are gone, gives no rows and says why.
 */
export async function getRunRequests(
  api: ApiContext,
  projectId: string,
  executionId: string,
): Promise<{ readonly rows: readonly RunRequest[]; readonly seriesState: SeriesState }> {
  let data: unknown;
  try {
    data = await must(
      api.services.http.GET(ENDPOINTS_PATH, {
        params: { path: { project_id: projectId, execution_id: executionId } },
        signal: api.signal,
      }),
    );
  } catch (error) {
    if (noDocument(error)) return { rows: [], seriesState: 'absent_unmeasured' };
    if (metricsStoreDown(error)) return { rows: [], seriesState: 'unreachable' };
    throw error;
  }
  const parsed = endpointsSchema.safeParse(data);
  if (!parsed.success) throw new ToolError('bad_gateway');
  return {
    rows: parsed.data.endpoints.map((row) => ({
      name: row.name,
      count: row.count ?? 0,
      p95Estimate: row.p95_histogram,
    })),
    seriesState: seriesState(parsed.data.series_source),
  };
}

// ---- the comparison of two runs -----------------------------------------------------------

const COMPARE_PATH = '/api/v1/projects/{project_id}/gatling/executions/compare' as const;

/** One metric of the comparison as the stored results hold it: the first run and the second. */
export interface ComparedMetric {
  readonly was: number | null;
  readonly is: number | null;
}

export interface RunComparison {
  /** Environments the two runs were saved against; null when a run has no saved-run record. */
  readonly environments: { readonly was: string | null; readonly is: string | null };
  /** Whether the two loads are the same; null when the backend has no evidence either way. */
  readonly sameWorkload: boolean | null;
  /** The overall answer over load, target and build; null is "not known", never a refusal. */
  readonly comparable: boolean | null;
  /** One sentence per recorded difference of target or build, as the backend wrote it. */
  readonly reasons: readonly string[];
  /** Sentences of the backend about the evidence behind the answer. */
  readonly warnings: readonly string[];
  readonly totalRequests: ComparedMetric;
  readonly failedRequests: ComparedMetric;
  readonly p95: ComparedMetric;
  readonly requestsPerSecond: ComparedMetric;
}

const metricSchema = z
  .object({ a: nullable(z.number()), b: nullable(z.number()) })
  .catch({ a: null, b: null });

const compareSchema = reads<ResponseOf<typeof COMPARE_PATH, 'get'>>()(
  z.object({
    environment_a_id: nullable(z.string()),
    environment_b_id: nullable(z.string()),
    same_workload: nullable(z.boolean()),
    comparable: nullable(z.boolean()),
    not_comparable_reasons: z.array(z.string()).catch([]),
    warnings: z.array(z.string()).catch([]),
    metrics: z.object({
      total_requests: metricSchema,
      ko_count: metricSchema,
      p95: metricSchema,
      requests_per_second: metricSchema,
    }),
  }),
);

const compared = (metric: z.infer<typeof metricSchema>): ComparedMetric => ({
  was: metric.a,
  is: metric.b,
});

/**
 * The backend's comparison of two runs of one project (`was` the first, `is` the second). A run
 * without a stored result is a 404 the caller words; the answer is read as the backend gave it,
 * nothing here judges whether the numbers may be set side by side.
 */
export async function compareRuns(
  api: ApiContext,
  projectId: string,
  was: string,
  is: string,
): Promise<RunComparison> {
  const data = await must(
    api.services.http.GET(COMPARE_PATH, {
      params: { path: { project_id: projectId }, query: { a: was, b: is } },
      signal: api.signal,
    }),
  );
  const parsed = compareSchema.safeParse(data);
  if (!parsed.success) {
    throw new ToolError('bad_gateway', {
      message: 'LoadCraft answered the comparison request with something that is not a comparison.',
    });
  }
  const body = parsed.data;
  return {
    environments: { was: body.environment_a_id, is: body.environment_b_id },
    sameWorkload: body.same_workload,
    comparable: body.comparable,
    reasons: body.not_comparable_reasons,
    warnings: body.warnings,
    totalRequests: compared(body.metrics.total_requests),
    failedRequests: compared(body.metrics.ko_count),
    p95: compared(body.metrics.p95),
    requestsPerSecond: compared(body.metrics.requests_per_second),
  };
}
