// `results_get_request` (module results): Get one request's metrics and latency percentiles in a
// run.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "{run_id} {request}", result "{request}: p95 {p95} ms": the request comes from the
// data, the handle and p95 in whole ms from `log.values` (the data keeps the backend's numbers).

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { isRunNotFound, LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import {
  renderGetRequest,
  type RequestData,
  type SeriesPoint,
  type StatusCount,
} from '../../render/results/getRequest.js';
import {
  LIMITS,
  callBackend,
  includes,
  projectIdOf,
  runIdArgument,
  runOf,
  thirdParty,
  thirdPartyOrNull,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { RESULTS_GET_REQUEST } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/executions/{execution_id}/endpoints/{name} (REST API v1) */
export function getExecutionEndpointDetail(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string; readonly name: string },
): Promise<
  OpOutput<'get_execution_endpoint_detail_api_v1_projects__project_id__gatling_executions__execution_id__endpoints__name__get'>
> {
  return callBackend(
    ctx,
    'get_execution_endpoint_detail_api_v1_projects__project_id__gatling_executions__execution_id__endpoints__name__get',
    { path },
  );
}

type Detail =
  OpOutput<'get_execution_endpoint_detail_api_v1_projects__project_id__gatling_executions__execution_id__endpoints__name__get'>;

/** The longest request name and the statuses the data carries. */
const REQUEST_LIMIT = 300;
const STATUSES_SHOWN = 12;
/** The most points of the course over time; a longer one is thinned by a fixed stride. */
const SERIES_POINTS = 120;
/** The step assumed when the answer has fewer than two points to measure it from, in seconds. */
const SERIES_STEP_FALLBACK_S = 5;

/** The step between the points of the answer, in seconds: the most common gap between two of them. */
function stepOf(points: Detail['time_series']): number {
  const gaps = new Map<number, number>();
  for (let i = 1; i < points.length; i += 1) {
    const gap = Math.round(
      (Date.parse(points[i]?.timestamp ?? '') - Date.parse(points[i - 1]?.timestamp ?? '')) / 1000,
    );
    if (Number.isFinite(gap) && gap > 0) gaps.set(gap, (gaps.get(gap) ?? 0) + 1);
  }
  let best: [number, number] | undefined;
  for (const entry of gaps) if (best === undefined || entry[1] > best[1]) best = entry;
  return best?.[0] ?? SERIES_STEP_FALLBACK_S;
}

const STATUS_KEY = /^(?:\d{3}|unknown|no_response|unmet_check|non_http_transport)$/u;

/** The statuses by count (a key the contract does not list is counted under `other`). */
export function statusesOf(counts: Readonly<Record<string, number>>): StatusCount[] {
  const merged = new Map<string, number>();
  for (const [key, count] of Object.entries(counts)) {
    const name = STATUS_KEY.test(key) ? key : 'other';
    merged.set(name, (merged.get(name) ?? 0) + count);
  }
  return [...merged.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, STATUSES_SHOWN);
}

function pointOf(point: Detail['time_series'][number]): SeriesPoint {
  return {
    t: point.timestamp,
    rps: point.rps,
    okPerS: point.ok_per_second,
    koPerS: point.ko_per_second,
    meanMs: point.mean_response_time,
    p95: point.p95_histogram,
    p99: point.p99_histogram,
  };
}

/** Every `stride`-th point from the first, so that at most SERIES_POINTS remain. */
function thinned(points: Detail['time_series']): { rows: SeriesPoint[]; stepS: number } {
  const stride = Math.max(1, Math.ceil(points.length / SERIES_POINTS));
  return {
    rows: points.filter((_, index) => index % stride === 0).map(pointOf),
    stepS: stepOf(points) * stride,
  };
}

async function readDetail(
  ctx: CallContext & Pick<ToolContext, 't'>,
  path: { project_id: string; execution_id: string; name: string },
): Promise<Detail> {
  try {
    return await getExecutionEndpointDetail(ctx, path);
  } catch (error) {
    if (isRunNotFound(error, path.execution_id)) throw error;
    if (error instanceof LoadcraftApiError && error.status === 404) {
      throw new ToolError('not_found', {
        params: { available: ctx.t('results_get_request.not_found') },
      });
    }
    throw error;
  }
}

export const resultsGetRequest = moduleTool(RESULTS_GET_REQUEST, {
  title: 'Get one request of a run',
  input: {
    run_id: runIdArgument(),
    request: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe(
        'The request as the run names it (POST /checkout), as results_get_report lists it.',
      ),
    include: z
      .array(z.enum(['series']))
      .max(1)
      .optional()
      .describe(
        '"series": the request over time, at the step of the run; without it, totals only.',
      ),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const { id, run } = await runOf(ctx, projectId, args.run_id);
    const detail = await readDetail(ctx, {
      project_id: projectId,
      execution_id: id,
      name: args.request,
    });
    const series = includes(args.include).has('series') ? thinned(detail.time_series) : null;
    const data: RequestData = {
      run,
      run_id: id,
      request: thirdParty(ctx, detail.name, REQUEST_LIMIT),
      group: thirdPartyOrNull(ctx, detail.group, LIMITS.name),
      count: detail.count,
      ok: detail.ok_count,
      ko: detail.ko_count,
      errorRate: detail.error_rate,
      rps: detail.rps,
      meanMs: detail.mean_response_time,
      p50: detail.p50_histogram,
      p75: detail.p75_histogram,
      p90: detail.p90_histogram,
      p95: detail.p95_histogram,
      p99: detail.p99_histogram,
      minBoundMs:
        detail.min_source === 'not-measured' || detail.min_response_time === null
          ? null
          : detail.min_response_time,
      maxBoundMs:
        detail.max_source === 'not-measured' || detail.max_response_time === null
          ? null
          : detail.max_response_time,
      statuses: statusesOf(detail.http_status_counts),
      ...(series === null ? {} : { series: series.rows, seriesStepS: series.stepS }),
    };
    // the numbers of the data are the backend's; the entry shows p95 in whole ms, as the view does
    return {
      status: 'done',
      data,
      update: { log: { values: { run_id: run, p95: Math.round(detail.p95_histogram) } } },
    };
  },
  render: renderGetRequest,
});
