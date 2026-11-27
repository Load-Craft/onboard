// `flows_duplicate` (module flows): Duplicate flows, or copy one flow onto another docs version
// (docs_id).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// The flows are named by their ids or names, comma-separated, and looked up by the resolver; the
// count and the pairing of the arguments are refused locally, everything else is the backend's. The
// copies are new flows and the sources are not changed: the undo is the deletion of the copies
// (`flows_delete`, a level 3 tool the entry only names). Names and docs versions pass `content`.
// Log: args "{flow_ids}", result "{count} copies": the data carries `count`. State: the copies are
// added to `ids.flow_ids`.
// Arguments: flow_ids (comma-separated), docs_id, name.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import {
  renderDuplicate,
  type DuplicateCopy,
  type DuplicateData,
} from '../../render/flows/duplicate.js';
import { createResolver } from '../../resolve/handles.js';
import { callBackend, content, type BodyOf, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { referencesOf } from './merge.js';
import { FLOWS_DUPLICATE } from './meta.generated.js';

/** POST /projects/{project_id}/flows/batch-duplicate (REST API v1) */
export function batchDuplicateFlows(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'batch_duplicate_flows_api_v1_projects__project_id__flows_batch_duplicate_post'>,
): Promise<
  OpOutput<'batch_duplicate_flows_api_v1_projects__project_id__flows_batch_duplicate_post'>
> {
  return callBackend(
    ctx,
    'batch_duplicate_flows_api_v1_projects__project_id__flows_batch_duplicate_post',
    { path, body },
  );
}

/** POST /projects/{project_id}/flows/{flow_id}/duplicate-for-spec (REST API v1) */
export function duplicateFlowForSpec(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string },
  body: BodyOf<'duplicate_flow_for_spec_api_v1_projects__project_id__flows__flow_id__duplicate_for_spec_post'>,
): Promise<
  OpOutput<'duplicate_flow_for_spec_api_v1_projects__project_id__flows__flow_id__duplicate_for_spec_post'>
> {
  return callBackend(
    ctx,
    'duplicate_flow_for_spec_api_v1_projects__project_id__flows__flow_id__duplicate_for_spec_post',
    { path, body },
  );
}

const NAME_LIMIT = 100;
const COPIES_SHOWN = 50;
const MIN_FLOWS = 1;
const MAX_FLOWS = 20;

const refuse = (rule: string, message: string): ToolError =>
  new ToolError('invalid_arguments', { message, params: { rule } });

export const flowsDuplicate = moduleTool(FLOWS_DUPLICATE, {
  title: 'Duplicate flows, or copy one flow onto another docs version',
  input: {
    flow_ids: z
      .string()
      .min(1)
      .max(4000)
      .describe(
        'The flows to copy, ids or names, comma-separated (1-20; exactly one with docs_id).',
      ),
    docs_id: uuidArgument().optional().describe('Copy the flow onto this documentation version.'),
    name: z.string().min(1).max(200).optional().describe('The name of the copy (with docs_id).'),
  },
  async run(ctx, args) {
    const refs = referencesOf(args.flow_ids);
    if (refs.length < MIN_FLOWS || refs.length > MAX_FLOWS || refs.some((ref) => ref === '')) {
      throw refuse('flows_duplicate_count', 'flow_ids must hold 1 to 20 flows, comma-separated');
    }
    if (args.docs_id !== undefined && refs.length !== 1) {
      throw refuse('flows_duplicate_docs_one', 'docs_id copies one flow: pass exactly one flow');
    }
    if (args.name !== undefined && args.docs_id === undefined) {
      throw refuse('flows_duplicate_name_needs_docs', 'name is for the copy onto a docs version');
    }
    const projectId = projectIdOf(ctx, undefined);
    const resolver = createResolver(ctx);
    const sources: string[] = [];
    for (const ref of refs) sources.push((await resolver.flow(projectId, ref)).id);
    const path = { project_id: projectId };
    let created: { id: string; name: string; current_version: number }[];
    let failed: readonly string[] = [];
    let report: DuplicateData['report'] = null;
    const [only] = sources;
    if (args.docs_id !== undefined && only !== undefined) {
      const answer = await duplicateFlowForSpec(
        ctx,
        { ...path, flow_id: only },
        {
          target_spec_id: args.docs_id.toLowerCase(),
          ...(args.name === undefined ? {} : { new_name: args.name }),
        },
      );
      created = [answer.flow];
      const found = answer.migration_report;
      report = {
        source_version: content(ctx, found.source_spec_version, 40),
        target_version: content(ctx, found.target_spec_version, 40),
        steps: found.total_request_blocks,
        matched: found.matched_count,
        changed: found.changed_count,
        unmatched: found.unmatched_count,
      };
    } else {
      const answer = await batchDuplicateFlows(ctx, path, { flow_ids: sources });
      created = answer.created_flows;
      failed = answer.failed_ids ?? [];
    }
    const copies: DuplicateCopy[] = created.slice(0, COPIES_SHOWN).map((flow) => ({
      id: flow.id,
      name: content(ctx, flow.name, NAME_LIMIT),
      version: flow.current_version,
    }));
    const data: DuplicateData = {
      project_id: projectId,
      count: created.length,
      copies,
      failed,
      report,
    };
    const ids = created.map((flow) => flow.id);
    return {
      status: 'done',
      data,
      ...(ids.length === 0 ? { inert: true as const } : {}),
      update: {
        ...(ids.length === 0 ? {} : { add: { flow_ids: ids } }),
        log:
          ids.length === 0 ? {} : { undo_args: { undo_tool: 'flows_delete', kind: 'flow', ids } },
      },
    };
  },
  render: renderDuplicate,
});
