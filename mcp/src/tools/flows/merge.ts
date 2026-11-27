// `flows_merge` (module flows): Merge several flows into one new flow (the first kept whole, later
// ones lose their leading reads).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The flows are named by their ids or names, comma-separated, and looked up by the resolver;
// how many (2 to 20) is the only thing refused locally, everything else (a flow twice, a graph that
// cannot be merged) is the backend's. The merge creates a flow and changes no source: the undo is the
// deletion of the new flow (`flows_delete`, a level 3 tool the entry only names). The names and the
// warnings are the application's own text and pass `content`.
// Log: args "{flow_ids}", result "{name} created from {count} flows": the data carries `name` and
// `count`. State: the new flow is added to `ids.flow_ids`.
// Arguments: flow_ids (comma-separated), name.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import { renderMerge, type MergeData } from '../../render/flows/merge.js';
import { createResolver } from '../../resolve/handles.js';
import { callBackend, content, type BodyOf, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { FLOWS_MERGE } from './meta.generated.js';

/** POST /projects/{project_id}/flows/merge (REST API v1) */
export function mergeFlowsRoute(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'merge_flows_route_api_v1_projects__project_id__flows_merge_post'>,
): Promise<OpOutput<'merge_flows_route_api_v1_projects__project_id__flows_merge_post'>> {
  return callBackend(ctx, 'merge_flows_route_api_v1_projects__project_id__flows_merge_post', {
    path,
    body,
  });
}

const NAME_LIMIT = 100;
const WARNING_LIMIT = 200;
const WARNINGS_SHOWN = 10;
const MIN_FLOWS = 2;
const MAX_FLOWS = 20;

/** The references of a comma-separated text, trimmed; none of them empty. */
export function referencesOf(text: string): string[] {
  return text.split(',').map((item) => item.trim());
}

export const flowsMerge = moduleTool(FLOWS_MERGE, {
  title: 'Merge several flows into one new flow',
  input: {
    flow_ids: z
      .string()
      .min(1)
      .max(4000)
      .describe('The flows to merge, ids or names, comma-separated (2-20).'),
    name: z.string().min(1).max(200).optional().describe('The name of the merged flow.'),
  },
  async run(ctx, args) {
    const refs = referencesOf(args.flow_ids);
    if (refs.length < MIN_FLOWS || refs.length > MAX_FLOWS || refs.some((ref) => ref === '')) {
      throw new ToolError('invalid_arguments', {
        message: 'flow_ids must hold 2 to 20 flows, comma-separated',
        params: { rule: 'flows_merge_count' },
      });
    }
    const projectId = projectIdOf(ctx, undefined);
    const resolver = createResolver(ctx);
    const sources: string[] = [];
    for (const ref of refs) sources.push((await resolver.flow(projectId, ref)).id);
    const merged = await mergeFlowsRoute(
      ctx,
      { project_id: projectId },
      { flow_ids: sources, ...(args.name === undefined ? {} : { name: args.name }) },
    );
    const { flow } = merged;
    const data: MergeData = {
      project_id: projectId,
      flow: { id: flow.id },
      name: content(ctx, flow.name, NAME_LIMIT),
      count: sources.length,
      version: flow.current_version,
      sources,
      warnings: (merged.warnings ?? [])
        .slice(0, WARNINGS_SHOWN)
        .map((warning) => content(ctx, warning, WARNING_LIMIT)),
    };
    return {
      status: 'done',
      data,
      links: [ctx.services.links.flow(projectId, flow.id)],
      update: {
        add: { flow_ids: [flow.id] },
        log: { undo_args: { undo_tool: 'flows_delete', kind: 'flow', ids: [flow.id] } },
      },
    };
  },
  render: renderMerge,
});
