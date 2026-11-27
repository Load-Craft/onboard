// `run_get_usage` (module run): Get finished runs over a period and the compute time they used.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The history of finished runs is the answer; the compute time is a best-effort second read,
// so a store that cannot say it leaves the runs readable. Runs are named by their handles.
// Log: args "{period}", result "{runs} runs, {minutes} compute minutes": the data of the result
// carries the fields.
// Arguments (the catalog's): `days`, default 30.

import * as z from 'zod';

import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import {
  computeMinutes,
  renderGetUsage,
  type UsageData,
  type UsageRun,
} from '../../render/run/getUsage.js';
import {
  callBackend,
  projectIdOf,
  runHandle,
  settleAll,
  type CallContext,
  type QueryOf,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { RUN_GET_USAGE } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/ops/history (REST API v1) */
export function getExecutionHistory(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'get_execution_history_api_v1_projects__project_id__gatling_ops_history_get'>,
): Promise<OpOutput<'get_execution_history_api_v1_projects__project_id__gatling_ops_history_get'>> {
  return callBackend(
    ctx,
    'get_execution_history_api_v1_projects__project_id__gatling_ops_history_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

/** GET /projects/{project_id}/gatling/ops/resources (REST API v1) */
export function getResourceUsage(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'get_resource_usage_api_v1_projects__project_id__gatling_ops_resources_get'>> {
  return callBackend(
    ctx,
    'get_resource_usage_api_v1_projects__project_id__gatling_ops_resources_get',
    { path },
  );
}

/** The runs the data lists; the count says how many the period holds. */
const RUNS_SHOWN = 30;

export const runGetUsage = moduleTool(RUN_GET_USAGE, {
  title: 'Get finished runs over a period and the compute time they used',
  input: {
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe('How many past days of usage to return (1-365).'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    const [history, usage] = await settleAll([
      getExecutionHistory(ctx, path, { days: args.days }),
      getResourceUsage(ctx, path).catch((error: unknown) => {
        // an extra read: a store that fails to answer leaves the runs, not the whole result
        if (error instanceof LoadcraftApiError && error.status >= 500) return null;
        throw error;
      }),
    ]);
    const items: UsageRun[] = history.entries.slice(0, RUNS_SHOWN).map((entry) => ({
      run: runHandle(entry.execution_id),
      run_id: entry.execution_id,
      at: entry.created_at,
      status: entry.status,
      durationS: entry.duration,
      errorRate: entry.error_rate,
      backend: entry.backend_type,
    }));
    const data: UsageData = {
      project_id: projectId,
      days: args.days,
      count: history.total,
      shown: items.length,
      items,
      totalBurnSeconds: usage === null ? null : usage.total_burn_seconds,
      measuredRuns: usage === null ? null : usage.measured_execution_count,
    };
    return {
      status: 'done',
      data,
      update: {
        log: {
          values: {
            period: `${String(args.days)} days`,
            runs: history.total,
            minutes: usage === null ? 0 : computeMinutes(usage.total_burn_seconds),
          },
        },
      },
    };
  },
  render: renderGetUsage,
});
