// `functional_get_runs` (module functional): Get functional runs: list (filter by status or type),
// by run template, or one with its status.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. A run is named by its UUID (the state keeps no functional run): with `run_id` the tool reads
// that run, without it it lists, or with `view: "by_template"` lists the runs of one run template.
// `view: "one"` without a run and `by_template` without a template are refused locally. Template
// names, error messages and the names of runtime parameters are texts of a third party (`content`);
// the values of the runtime parameters are not read.
// Log: args "", result "{count} functional runs": the data carries the count.
// Arguments (the catalog's): `run_id`, `view`, `template`, `status`, `type`, `limit`, `offset`.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetRuns,
  type FunctionalRunDetail,
  type FunctionalRunRow,
  type FunctionalRunsData,
} from '../../render/functional/getRuns.js';
import { callBackend, type CallContext, type QueryOf } from '../moduleCall.js';
import {
  LIMITS,
  projectIdOf,
  refuseRule,
  thirdParty,
  thirdPartyOrNull,
} from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { FUNCTIONAL_GET_RUNS } from './meta.generated.js';

/** GET /projects/{project_id}/executions (REST API v1) */
export function listExecutions(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'list_executions_api_v1_projects__project_id__executions_get'>,
): Promise<OpOutput<'list_executions_api_v1_projects__project_id__executions_get'>> {
  return callBackend(ctx, 'list_executions_api_v1_projects__project_id__executions_get', {
    path,
    ...(query === undefined ? {} : { query }),
  });
}

/** GET /projects/{project_id}/executions/{execution_id} (REST API v1) */
export function getExecution(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string },
): Promise<OpOutput<'get_execution_api_v1_projects__project_id__executions__execution_id__get'>> {
  return callBackend(
    ctx,
    'get_execution_api_v1_projects__project_id__executions__execution_id__get',
    { path },
  );
}

/** GET /projects/{project_id}/executions/run-templates/{template_id}/executions (REST API v1) */
export function listTemplateExecutions(
  ctx: CallContext,
  path: { readonly project_id: string; readonly template_id: string },
  query?: QueryOf<'list_template_executions_api_v1_projects__project_id__executions_run_templates__template_id__executions_get'>,
): Promise<
  OpOutput<'list_template_executions_api_v1_projects__project_id__executions_run_templates__template_id__executions_get'>
> {
  return callBackend(
    ctx,
    'list_template_executions_api_v1_projects__project_id__executions_run_templates__template_id__executions_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

const ITEMS_SHOWN = 100;
const PARAMS_SHOWN = 20;

type Summary =
  OpOutput<'list_executions_api_v1_projects__project_id__executions_get'>['executions'][number];
type Detail = OpOutput<'get_execution_api_v1_projects__project_id__executions__execution_id__get'>;

function rowOf(ctx: CallContext, run: Summary): FunctionalRunRow {
  return {
    id: run.id,
    status: run.status,
    type: run.execution_type,
    templateId: run.template_id,
    templateName: thirdPartyOrNull(ctx, run.template_name, LIMITS.name),
    createdAt: run.created_at,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    durationMs: run.duration_ms,
    flows: {
      total: run.total_flows,
      passed: run.passed_flows,
      failed: run.failed_flows,
      completed: run.completed_flows,
    },
    validations: {
      total: run.total_validations,
      passed: run.passed_validations,
      failed: run.failed_validations,
    },
    environmentId: run.environment_id ?? null,
  };
}

function detailOf(ctx: CallContext, run: Detail): FunctionalRunDetail {
  return {
    ...rowOf(ctx, run),
    environmentName: thirdPartyOrNull(ctx, run.environment_name, LIMITS.name),
    errorMessage: thirdPartyOrNull(ctx, run.error_message, LIMITS.sentence),
    triggeredBy: thirdPartyOrNull(ctx, run.triggered_by, LIMITS.name),
    runtimeParams: Object.keys(run.runtime_params)
      .slice(0, PARAMS_SHOWN)
      .map((name) => thirdParty(ctx, name, LIMITS.name)),
    flowVersions: Object.keys(run.flow_versions).length,
  };
}

export const functionalGetRuns = moduleTool(FUNCTIONAL_GET_RUNS, {
  title: 'Get functional runs',
  input: {
    run_id: uuidArgument().optional().describe('One functional run; without it, the list.'),
    view: z
      .enum(['list', 'one', 'by_template'])
      .default('list')
      .describe('list (default), one run, or the runs of a template.'),
    template: uuidArgument().optional().describe('With view by_template: the template.'),
    status: z
      .enum(['pending', 'running', 'completed', 'failed', 'cancelled'])
      .optional()
      .describe('Only runs in this status.'),
    type: z.enum(['adhoc', 'template']).optional().describe('Only ad hoc or template runs.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('How many runs to return (1-100).'),
    offset: z.number().int().min(0).max(100000).default(0).describe('The first run of the list.'),
  },
  async run(ctx, args) {
    if (args.view === 'one' && args.run_id === undefined) {
      refuseRule('runs_one_without_run');
    }
    if (args.view === 'by_template' && args.template === undefined) {
      refuseRule('runs_by_template_without_template');
    }
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    const page = { limit: args.limit, offset: args.offset };
    if (args.run_id !== undefined) {
      const one = await getExecution(ctx, { ...path, execution_id: args.run_id.toLowerCase() });
      const data: FunctionalRunsData = {
        view: 'one',
        count: 1,
        shown: 0,
        limit: args.limit,
        offset: 0,
        items: [],
        run: detailOf(ctx, one),
      };
      return { status: 'done', data };
    }
    const status = args.status === undefined ? {} : { status: args.status };
    const answer =
      args.view === 'by_template' && args.template !== undefined
        ? await listTemplateExecutions(
            ctx,
            { ...path, template_id: args.template.toLowerCase() },
            { ...page, ...status },
          )
        : await listExecutions(ctx, path, {
            ...page,
            ...status,
            ...(args.type === undefined ? {} : { execution_type: args.type }),
          });
    const items = answer.executions.slice(0, ITEMS_SHOWN).map((run) => rowOf(ctx, run));
    const data: FunctionalRunsData = {
      view: args.view === 'by_template' ? 'by_template' : 'list',
      count: answer.total,
      shown: items.length,
      limit: args.limit,
      offset: args.offset,
      items,
      run: null,
    };
    return { status: 'done', data };
  },
  render: renderGetRuns,
});
