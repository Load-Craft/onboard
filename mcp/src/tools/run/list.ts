// `run_list` (module run): List the project's runs, newest first: status, target, environment;
// include=results adds headline results.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The runs are one request; the headline results (`include`) are a second, best-effort read of
// the project's stored results, joined to the runs by run id: a store that fails to answer leaves
// the runs readable and the view says the results are missing. A `target` (a name) is turned into
// the id the backend filters by. Names and messages pass the mask of a third party's text (`content`).
// Log: args "", result "{count} runs": the data of the result carries the fields.
// Arguments (the catalog's): `limit`, `target`, `include`.

import * as z from 'zod';

import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import {
  renderList,
  type RunHeadline,
  type RunListData,
  type RunRow,
} from '../../render/run/list.js';
import { createResolver } from '../../resolve/handles.js';
import {
  callBackend,
  isUuid,
  LIMITS,
  projectIdOf,
  runHandle,
  settleAll,
  thirdParty,
  type CallContext,
  type QueryOf,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { RUN_LIST } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/executions (REST API v1) */
export function listExecutions(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'list_executions_api_v1_projects__project_id__gatling_executions_get'>,
): Promise<OpOutput<'list_executions_api_v1_projects__project_id__gatling_executions_get'>> {
  return callBackend(ctx, 'list_executions_api_v1_projects__project_id__gatling_executions_get', {
    path,
    ...(query === undefined ? {} : { query }),
  });
}

/** GET /projects/{project_id}/gatling/results (REST API v1) */
export function listResults(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'list_results_api_v1_projects__project_id__gatling_results_get'>,
): Promise<OpOutput<'list_results_api_v1_projects__project_id__gatling_results_get'>> {
  return callBackend(ctx, 'list_results_api_v1_projects__project_id__gatling_results_get', {
    path,
    ...(query === undefined ? {} : { query }),
  });
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const RUNS_SHOWN = 50;
const ERROR_LIMIT = 160;

type Execution =
  OpOutput<'list_executions_api_v1_projects__project_id__gatling_executions_get'>['executions'][number];
type Result =
  OpOutput<'list_results_api_v1_projects__project_id__gatling_results_get'>['results'][number];

function headlineOf(result: Result | undefined): RunHeadline | null {
  if (result === undefined) return null;
  return {
    p95Ms: result.p95,
    meanMs: result.mean_response_time,
    rps: result.requests_per_second,
  };
}

function rowOf(
  ctx: CallContext,
  execution: Execution,
  results: ReadonlyMap<string, Result> | null,
): RunRow {
  const manifestEnvironment = execution.run_manifest?.target_environment_name;
  return {
    run: runHandle(execution.id),
    run_id: execution.id,
    status: execution.status,
    source: execution.source,
    createdAt: execution.created_at,
    durationS: execution.duration_seconds,
    targetKind:
      execution.scenario_id !== null
        ? 'scenario'
        : execution.composite_id !== null
          ? 'composition'
          : null,
    targetId: execution.scenario_id ?? execution.composite_id,
    environment:
      manifestEnvironment === null || manifestEnvironment === undefined
        ? null
        : thirdParty(ctx, manifestEnvironment, LIMITS.name),
    savedRun:
      execution.saved_run_name === null
        ? null
        : thirdParty(ctx, execution.saved_run_name, LIMITS.name),
    requests: execution.total_requests,
    ko: execution.ko_count,
    sla: execution.sla_verdict?.status ?? null,
    errorMessage:
      execution.error_message === null
        ? null
        : thirdParty(ctx, execution.error_message, ERROR_LIMIT),
    ...(results === null ? {} : { headline: headlineOf(results.get(execution.id)) }),
  };
}

export const runList = moduleTool(RUN_LIST, {
  title: "List the project's runs, newest first",
  input: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .default(DEFAULT_LIMIT)
      .describe('How many runs to return (1-200).'),
    target: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe('Only runs of this scenario or composition (name or id).'),
    include: z
      .array(z.enum(['results']))
      .max(1)
      .optional()
      .describe('"results": the headline numbers of each run.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    const given = args.target?.trim();
    // an id names a scenario or a composition, which only the backend tells apart: a name is
    // resolved by the lists of the project, an id is tried as a scenario, then as a composition
    const byId = given !== undefined && isUuid(given);
    const target =
      given === undefined || byId
        ? null
        : await createResolver(ctx).runScenarioTarget(projectId, given);
    const wantsResults = args.include?.includes('results') === true;
    const filterOf = (): Record<string, string> =>
      target === null
        ? byId
          ? { scenario_id: given.toLowerCase() }
          : {}
        : target.kind === 'scenario'
          ? { scenario_id: target.id }
          : { composite_id: target.id };
    const [executions, results] = await settleAll([
      (async () => {
        const first = await listExecutions(ctx, path, { limit: args.limit, ...filterOf() });
        if (!byId || first.executions.length > 0) return first;
        return listExecutions(ctx, path, { limit: args.limit, composite_id: given.toLowerCase() });
      })(),
      wantsResults
        ? listResults(ctx, path, { limit: args.limit }).catch((error: unknown) => {
            // an extra read: a store that fails to answer leaves the runs, not the whole result
            if (error instanceof LoadcraftApiError && error.status >= 500) return null;
            throw error;
          })
        : Promise.resolve(undefined),
    ]);
    const byRun =
      results === undefined || results === null
        ? null
        : new Map(results.results.map((result) => [result.execution_id, result]));
    const items = executions.executions
      .slice(0, RUNS_SHOWN)
      .map((execution) => rowOf(ctx, execution, byRun));
    const data: RunListData = {
      project_id: projectId,
      count: executions.executions.length,
      shown: items.length,
      limit: args.limit,
      target:
        target !== null
          ? thirdParty(ctx, target.name, LIMITS.name)
          : byId
            ? given.toLowerCase()
            : null,
      items,
      resultsIncluded: wantsResults,
      resultsAvailable: !wantsResults || byRun !== null,
    };
    return { status: 'done', data };
  },
  render: renderList,
});
