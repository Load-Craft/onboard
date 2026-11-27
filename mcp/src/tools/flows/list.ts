// `flows_list` (module flows): List the project's flows: name, type, version, step count.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the read and the
// view. The names of flows are text of the application under test and pass the mask of a third
// party's text (`content`); descriptions are not read. The backend lists the most recently updated
// first, at most 100, and has no filter by name: `query` filters what came back.
// Log: args "", result "{count} flows": the data carries `count`. The warning `flows_need_input`
// of the state follows the open items of the flows it read (flow/needsInput.ts).

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import { needsInputUpdate, type FlowNeeds } from '../../flow/needsInput.js';
import { renderFlowsList, type FlowRow, type FlowsListData } from '../../render/flows/list.js';
import { callBackend, content, type CallContext, type QueryOf } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { FLOWS_LIST } from './meta.generated.js';

/** GET /projects/{project_id}/flows (REST API v1) */
export function listFlows(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'list_flows_api_v1_projects__project_id__flows_get'>,
): Promise<OpOutput<'list_flows_api_v1_projects__project_id__flows_get'>> {
  return callBackend(ctx, 'list_flows_api_v1_projects__project_id__flows_get', {
    path,
    ...(query === undefined ? {} : { query }),
  });
}

/** The most the backend returns in one answer. */
const BACKEND_MAX = 100;
const NAME_LIMIT = 100;

const INPUT = {
  query: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe('Only flows whose name contains this text (any case).'),
  limit: z.number().int().min(1).max(200).default(50).describe('How many flows to return (1-200).'),
};

export const flowsList = moduleTool(FLOWS_LIST, {
  title: "List the project's flows",
  input: INPUT,
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const asked = args.query === undefined ? Math.min(args.limit, BACKEND_MAX) : BACKEND_MAX;
    const answer = await listFlows(ctx, { project_id: projectId }, { limit: asked });
    const needle = args.query?.toLowerCase();
    const matching = answer.flows.filter(
      (flow) => needle === undefined || flow.name.toLowerCase().includes(needle),
    );
    const rows: FlowRow[] = matching.slice(0, args.limit).map((flow) => ({
      id: flow.id,
      name: content(ctx, flow.name, NAME_LIMIT),
      flow_type: flow.flow_type,
      version: flow.current_version,
      steps: flow.step_count,
      needs_input: flow.needs_input_count,
      needs_input_definite: flow.needs_input_definite_count,
      is_active: flow.is_active,
      spec_status: flow.spec_status ?? null,
      updated_at: flow.updated_at,
    }));
    const data: FlowsListData = {
      project_id: projectId,
      total: answer.total,
      fetched: answer.flows.length,
      count: matching.length,
      shown: rows.length,
      query: args.query ?? null,
      flows: rows,
    };
    const needs: FlowNeeds[] = answer.flows.map((flow) => ({
      id: flow.id,
      count: flow.needs_input_count,
      definite: flow.needs_input_definite_count,
    }));
    const scope = answer.flows.length >= answer.total ? 'all' : 'some';
    const update = needsInputUpdate(ctx.state.process(), needs, 'flows_list', scope);
    return { status: 'done', data, ...(update === undefined ? {} : { update }) };
  },
  render: renderFlowsList,
});
