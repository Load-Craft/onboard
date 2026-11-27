// `scenario_list_compositions` (module scenario): List the project's compositions: name, status,
// member count.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The names are what a person or the generator wrote, so they pass `content`; the members'
// artifacts, contracts and load profiles are never read, only how many members there are, how many
// are enabled and whether one drifted.
// Log: args "", result "{count} compositions": the data of the result carries the field.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderCompositionList,
  type CompositionItem,
  type CompositionListData,
} from '../../render/scenario/listCompositions.js';
import { callBackend, content, type CallContext, type QueryOf } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { SCENARIO_LIST_COMPOSITIONS } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/compositions (REST API v1) */
export function listCompositions(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'list_compositions_api_v1_projects__project_id__gatling_compositions_get'>,
): Promise<OpOutput<'list_compositions_api_v1_projects__project_id__gatling_compositions_get'>> {
  return callBackend(
    ctx,
    'list_compositions_api_v1_projects__project_id__gatling_compositions_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

type Summary =
  OpOutput<'list_compositions_api_v1_projects__project_id__gatling_compositions_get'>['compositions'][number];

function itemOf(ctx: CallContext, composition: Summary): CompositionItem {
  return {
    id: composition.id,
    name: content(ctx, composition.name, 120),
    status: composition.status,
    members: composition.scenarios.length,
    enabled_members: composition.scenarios.filter((member) => member.enabled).length,
    has_drift: composition.scenarios.some((member) => member.has_drift),
    valid: composition.validation === undefined ? null : composition.validation.is_valid,
    updated_at: composition.updated_at,
  };
}

export const scenarioListCompositions = moduleTool(SCENARIO_LIST_COMPOSITIONS, {
  title: "List the project's compositions",
  input: {
    status: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe('List only compositions with this status.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe('How many compositions to return (1-200).'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const answer = await listCompositions(
      ctx,
      { project_id: projectId },
      { limit: args.limit, ...(args.status === undefined ? {} : { status: args.status }) },
    );
    const compositions = answer.compositions.map((composition) => itemOf(ctx, composition));
    const data: CompositionListData = {
      project_id: projectId,
      status: args.status === undefined ? null : content(ctx, args.status, 40),
      count: answer.total,
      shown: compositions.length,
      compositions,
    };
    return { status: 'done', data };
  },
  render: renderCompositionList,
});
