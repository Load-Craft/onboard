// `results_compare_runs` (module results): Compare two runs metric by metric; compare_to=baseline
// uses the pinned baseline.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "{run_id} vs {compare_to}", result "{better} better, {worse} worse": the data of the
// result carries the fields.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import { createResolver } from '../../resolve/handles.js';
import {
  renderCompareRuns,
  type CommonMessage,
  type CompareData,
  type CompareErrors,
  type Judgement,
  type MessageCount,
  type MetricKey,
  type MetricRow,
} from '../../render/results/compareRuns.js';
import {
  callBackend,
  includes,
  projectIdOf,
  runHandle,
  runIdArgument,
  runOf,
  settleAll,
  thirdParty,
  type CallContext,
  type QueryOf,
} from '../kit/transitional.js';
import { fromState } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { RESULTS_COMPARE_RUNS } from './meta.generated.js';
import { RunRef, tenth } from './run.js';

/** GET /projects/{project_id}/gatling/executions/compare (REST API v1) */
export function compareGatlingExecutions(
  ctx: CallContext,
  path: { readonly project_id: string },
  query: QueryOf<'compare_gatling_executions_api_v1_projects__project_id__gatling_executions_compare_get'>,
): Promise<
  OpOutput<'compare_gatling_executions_api_v1_projects__project_id__gatling_executions_compare_get'>
> {
  return callBackend(
    ctx,
    'compare_gatling_executions_api_v1_projects__project_id__gatling_executions_compare_get',
    { path, query },
  );
}

/** GET /projects/{project_id}/gatling/executions/{execution_id} (REST API v1) */
export function getExecution(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string },
): Promise<
  OpOutput<'get_execution_api_v1_projects__project_id__gatling_executions__execution_id__get'>
> {
  return callBackend(
    ctx,
    'get_execution_api_v1_projects__project_id__gatling_executions__execution_id__get',
    { path },
  );
}

/** GET /projects/{project_id}/gatling/executions/{execution_id}/baseline (REST API v1) */
export function getExecutionBaseline(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string },
): Promise<
  OpOutput<'get_execution_baseline_api_v1_projects__project_id__gatling_executions__execution_id__baseline_get'>
> {
  return callBackend(
    ctx,
    'get_execution_baseline_api_v1_projects__project_id__gatling_executions__execution_id__baseline_get',
    { path },
  );
}

type Comparison =
  OpOutput<'compare_gatling_executions_api_v1_projects__project_id__gatling_executions_compare_get'>;

/** The twelve metrics of the data, in this order. */
const METRICS: readonly MetricKey[] = [
  'p50',
  'p75',
  'p90',
  'p95',
  'p99',
  'mean_response_time',
  'max_response_time',
  'min_response_time',
  'ko_count',
  'ok_count',
  'total_requests',
  'requests_per_second',
];

/** A smaller figure is better; the others in `HIGHER_IS_BETTER`; the rest has no verdict. */
const LOWER_IS_BETTER: ReadonlySet<MetricKey> = new Set([
  'p50',
  'p75',
  'p90',
  'p95',
  'p99',
  'mean_response_time',
  'max_response_time',
  'ko_count',
]);
const HIGHER_IS_BETTER: ReadonlySet<MetricKey> = new Set(['requests_per_second']);

/** A change under this many percent counts as no change. */
const SAME_UNDER_PCT = 5;
/** Durations that differ by more than this (10%) are told, and throughput is not assessed. */
const DURATION_RELATIVE = 0.1;

/**
 * How long each run sent load, in seconds: its requests over its throughput, as the comparison carries
 * them (the backend names no duration in it); null when a side has no figure.
 */
function durationsOf(body: Comparison): { readonly other: number; readonly run: number } | null {
  const total = body.metrics['total_requests'] as
    { a: number | null; b: number | null } | undefined;
  const rps = body.metrics['requests_per_second'] as
    { a: number | null; b: number | null } | undefined;
  const of = (count: number | null | undefined, rate: number | null | undefined): number | null =>
    count === null || count === undefined || rate === null || rate === undefined || rate <= 0
      ? null
      : tenth(count / rate);
  const other = of(total?.a, rps?.a);
  const run = of(total?.b, rps?.b);
  return other === null || run === null ? null : { other, run };
}

const lastedDifferently = (durations: { readonly other: number; readonly run: number } | null) =>
  durations !== null &&
  Math.max(durations.other, durations.run) > 0 &&
  Math.abs(durations.run - durations.other) / Math.max(durations.other, durations.run) >
    DURATION_RELATIVE;

/** The run a 404 of the comparison names (`Execution {id} not found…`), or null. */
const MISSING_RUN = /^Execution ([0-9a-f-]{36}) not found/u;
const NO_RESULT_RUN = /^No results found for execution ([0-9a-f-]{36})/u;
const REASONS_SHOWN = 5;
const WARNINGS_SHOWN = 3;
const ERRORS_SHOWN = 5;
const TEXT_LIMIT = 200;

/** `baseline`, or a run by handle or UUID: the value of `compare_to` and of its place in the state. */
const COMPARE_TO = z.union([RunRef, z.literal('baseline')]);

function judgementOf(
  key: MetricKey,
  deltaPct: number | null,
  comparable: boolean | null,
): Judgement | null {
  if (comparable === false || deltaPct === null) return null;
  const lower = LOWER_IS_BETTER.has(key);
  if (!lower && !HIGHER_IS_BETTER.has(key)) return null;
  if (Math.abs(deltaPct) < SAME_UNDER_PCT) return 'same';
  const down = deltaPct < 0;
  return down === lower ? 'better' : 'worse';
}

function rowOf(body: Comparison, key: MetricKey): MetricRow {
  const metric = body.metrics[key] as
    { a: number | null; b: number | null; delta: number | null } | undefined;
  const other = metric?.a ?? null;
  const run = metric?.b ?? null;
  const delta = metric?.delta ?? null;
  const raw = delta === null || other === null || other === 0 ? null : (delta / other) * 100;
  return {
    key,
    other,
    run,
    delta,
    deltaPct: raw === null ? null : tenth(raw),
    judgement: judgementOf(key, raw, body.comparable ?? null),
  };
}

const byCountThenText =
  <T extends { readonly message: string }>(count: (row: T) => number): ((a: T, b: T) => number) =>
  (a, b) =>
    count(b) - count(a) || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0);

function errorsOf(ctx: CallContext, body: Comparison): CompareErrors {
  const summary = body.error_summary;
  const only = (rows: readonly { message: string; count: number }[]): MessageCount[] =>
    [...rows]
      .sort(byCountThenText((row) => row.count))
      .slice(0, ERRORS_SHOWN)
      .map((row) => ({ message: thirdParty(ctx, row.message, TEXT_LIMIT), count: row.count }));
  const common: CommonMessage[] = [...summary.common]
    .sort(byCountThenText((row) => row.count_a + row.count_b))
    .slice(0, ERRORS_SHOWN)
    .map((row) => ({
      message: thirdParty(ctx, row.message, TEXT_LIMIT),
      countOther: row.count_a,
      countRun: row.count_b,
    }));
  return {
    onlyRun: only(summary.only_in_b),
    onlyOther: only(summary.only_in_a),
    common,
    totals: {
      onlyRun: summary.only_in_b.length,
      onlyOther: summary.only_in_a.length,
      common: summary.common.length,
    },
  };
}

interface Other {
  readonly id: string;
  readonly baseline: boolean;
}

/** The run to compare with: the baseline of this run, or the one named by handle or UUID. */
async function otherOf(
  ctx: CallContext & Parameters<typeof createResolver>[0],
  projectId: string,
  run: { readonly id: string; readonly run: string },
  compareTo: string,
): Promise<Other> {
  const resolver = createResolver(ctx);
  if (compareTo !== 'baseline') {
    const { id } = await resolver.execution(projectId, compareTo);
    return { id, baseline: false };
  }
  let pinned: OpOutput<'get_execution_baseline_api_v1_projects__project_id__gatling_executions__execution_id__baseline_get'>;
  try {
    pinned = await getExecutionBaseline(ctx, { project_id: projectId, execution_id: run.id });
  } catch (error) {
    // a run with no scenario and load (composite, not started, no manifest) has no pair to pin
    if (error instanceof LoadcraftApiError && error.status === 409) {
      throw new ToolError('no_baseline', { params: { run: run.run } });
    }
    throw error;
  }
  const { baseline } = pinned;
  if (pinned.state === 'not_established' || baseline === null || baseline === undefined) {
    throw new ToolError('no_baseline', { params: { run: run.run } });
  }
  if (baseline.is_this_execution) {
    throw new ToolError('compare_same_run', { params: { execution: run.run } });
  }
  if (pinned.state === 'unmeasured') {
    throw new ToolError('compare_no_result', {
      params: { execution: runHandle(baseline.execution_id) },
    });
  }
  return { id: baseline.execution_id, baseline: true };
}

interface EnvironmentFacts {
  readonly sameEnvironment: boolean | null;
  readonly environments: { readonly other: string | null; readonly run: string | null } | null;
}

const ENVIRONMENT_NAME_LIMIT = 80;

/**
 * The environment of the two runs. The comparison names one only for a run saved with a
 * configuration; when it names both they decide (no other read). Otherwise each run's manifest
 * names it, the same source `run_list` and `run_get` use; a run that cannot be read, or a manifest
 * with no environment, leaves it unknown.
 */
async function environmentsOf(
  ctx: CallContext,
  projectId: string,
  body: Comparison,
  ids: { readonly other: string; readonly run: string },
): Promise<EnvironmentFacts> {
  const a = body.environment_a_id ?? null;
  const b = body.environment_b_id ?? null;
  if (a !== null && b !== null) return { sameEnvironment: a === b, environments: null };
  const manifestOf = async (id: string) => {
    try {
      const execution = await getExecution(ctx, { project_id: projectId, execution_id: id });
      return execution.run_manifest ?? null;
    } catch (error) {
      if (error instanceof LoadcraftApiError) return null;
      throw error;
    }
  };
  const [other, run] = await settleAll([manifestOf(ids.other), manifestOf(ids.run)]);
  const nameOf = (manifest: typeof other): string | null =>
    manifest?.target_environment_name === null || manifest?.target_environment_name === undefined
      ? null
      : thirdParty(ctx, manifest.target_environment_name, ENVIRONMENT_NAME_LIMIT);
  const environments = { other: nameOf(other), run: nameOf(run) };
  const otherId = other?.target_environment_id ?? null;
  const runId = run?.target_environment_id ?? null;
  const sameEnvironment =
    otherId !== null && runId !== null
      ? otherId === runId
      : environments.other !== null && environments.run !== null
        ? environments.other === environments.run
        : null;
  return {
    sameEnvironment,
    environments: environments.other === null && environments.run === null ? null : environments,
  };
}

export const resultsCompareRuns = moduleTool(RESULTS_COMPARE_RUNS, {
  title: 'Compare two runs',
  input: {
    run_id: runIdArgument(),
    compare_to: COMPARE_TO.optional().describe(
      'The run to compare with (handle or UUID), or "baseline" for the pinned baseline of this run; default: the choice of this workspace.',
    ),
    include: z
      .array(z.enum(['errors']))
      .max(1)
      .optional()
      .describe('"errors": the console errors only in one run and in both.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const run = await runOf(ctx, projectId, args.run_id);
    const kept = fromState(ctx, 'choices.run.compare_to');
    const keptValid = COMPARE_TO.safeParse(kept);
    const compareTo = args.compare_to ?? (keptValid.success ? keptValid.data : undefined);
    if (compareTo === undefined) {
      throw new ToolError('missing_argument', { params: { name: 'compare_to' } });
    }
    const other = await otherOf(ctx, projectId, run, compareTo);
    const otherHandle = runHandle(other.id);
    if (other.id === run.id) {
      throw new ToolError('compare_same_run', { params: { execution: run.run } });
    }
    let body: Comparison;
    try {
      body = await compareGatlingExecutions(
        ctx,
        { project_id: projectId },
        { a: other.id, b: run.id },
      );
    } catch (error) {
      if (error instanceof LoadcraftApiError && error.status === 404) {
        // the backend names the run it is missing: a run of another project or none, or a run
        // with no stored result; each is told by its own handle
        const missing = MISSING_RUN.exec(error.message)?.[1];
        if (missing !== undefined) {
          throw new ToolError('not_found', {
            params: {
              available: ctx.t('results_compare_runs.not_found', {
                run: runHandle(missing),
              }),
            },
          });
        }
        const empty = NO_RESULT_RUN.exec(error.message)?.[1];
        throw new ToolError('compare_no_result', {
          params: {
            execution: empty === undefined ? `${run.run}, ${otherHandle}` : runHandle(empty),
          },
        });
      }
      throw error;
    }
    const durationsS = durationsOf(body);
    const differently = lastedDifferently(durationsS);
    const metrics = METRICS.map((key) => {
      const row = rowOf(body, key);
      // a longer run of the same requests has a lower throughput without being worse
      return differently && key === 'requests_per_second' ? { ...row, judgement: null } : row;
    });
    const { sameEnvironment, environments } = await environmentsOf(ctx, projectId, body, {
      other: other.id,
      run: run.id,
    });
    const data: CompareData = {
      run: run.run,
      run_id: run.id,
      other: otherHandle,
      other_id: other.id,
      baseline: other.baseline,
      ...(other.baseline ? { baselineSource: 'reference_of_scenario_and_load' as const } : {}),
      durationsS,
      lastedDifferently: differently,
      comparable: body.comparable ?? null,
      reasons: body.not_comparable_reasons
        .slice(0, REASONS_SHOWN)
        .map((reason) => thirdParty(ctx, reason, TEXT_LIMIT)),
      warnings: body.warnings
        .slice(0, WARNINGS_SHOWN)
        .map((warning) => thirdParty(ctx, warning, TEXT_LIMIT)),
      workload:
        body.same_workload === true
          ? 'same'
          : body.same_workload === false
            ? 'different'
            : 'unknown',
      sameEnvironment,
      environments,
      metrics,
      better: metrics.filter((row) => row.judgement === 'better').length,
      worse: metrics.filter((row) => row.judgement === 'worse').length,
      ...(includes(args.include).has('errors') ? { errors: errorsOf(ctx, body) } : {}),
    };
    return {
      status: 'done',
      data,
      update: { log: { values: { run_id: run.run, compare_to: otherHandle } } },
    };
  },
  render: renderCompareRuns,
});
