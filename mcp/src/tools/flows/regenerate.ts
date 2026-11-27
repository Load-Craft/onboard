// `flows_regenerate` (module flows): Regenerate a flow from its recorded sources; saved as a new version.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// card. Level 2, costly, `kind: process` on the block of a long operation (docs/long-operation.md).
// The first call reads the flow and makes the card (its name, the version the run would overwrite, the
// description, the cost); a repeat with the same arguments asks the person; only their yes starts the run.
// The run is the flow generation of `fromEndpoints.ts` in its regenerating mode (`saved.regenerate`):
// the backend re-derives the graph from every recorded source with the model and overwrites the flow in
// place as a new version; a run that fails leaves the flow as it was. LoadCraft keeps the state of the run,
// so progress and the result are read over REST (the same for the call and for `process_wait`). The run
// cannot be stopped: the backend takes a stop only over a WebSocket channel this plugin has no support for.
// Log: args "Regenerate flow {name}", result "flow {name} v{version}"; the undo is `flows_restore_version`
// with the version the flow had (`update.log.undo_args`, written when the run ends).
// Arguments (the catalog's): flow_id (default: the only flow), description (default: the one the flow
// was generated from), skip_validators.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import { cardViewRegenerateFlow, type RegenerateFlowFacts } from '../../render/flows/regenerate.js';
import { createResolver } from '../../resolve/handles.js';
import {
  callBackend,
  projectIdOf,
  refId,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { renderOperation, startOperation } from '../kit/operation.js';
import { moduleTool } from '../moduleTool.js';
import { flowGenerationOperation } from './fromEndpoints.js';
import { getFlow } from './get.js';
import { FLOWS_REGENERATE } from './meta.generated.js';

/** POST /projects/{project_id}/flows/{flow_id}/regenerate (REST API v1) */
export function regenerateFlow(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string },
  body: BodyOf<'regenerate_flow_api_v1_projects__project_id__flows__flow_id__regenerate_post'>,
): Promise<
  OpOutput<'regenerate_flow_api_v1_projects__project_id__flows__flow_id__regenerate_post'>
> {
  return callBackend(
    ctx,
    'regenerate_flow_api_v1_projects__project_id__flows__flow_id__regenerate_post',
    { path, body },
  );
}

const NAME_LIMIT = 120;
const DESCRIPTION_SHOWN = 300;

type Flow = OpOutput<'get_flow_api_v1_projects__project_id__flows__flow_id__get'>;

/** The description the run regenerates from: the argument, else the one the flow was generated from. */
function descriptionOf(flow: Flow, given: string | undefined): string {
  const text = given ?? flow.generation_description ?? flow.description ?? '';
  if (text.trim() === '') {
    throw new ToolError('missing_argument', { params: { name: 'description' } });
  }
  return text;
}

export const flowsRegenerate = moduleTool(FLOWS_REGENERATE, {
  title: 'Regenerate a flow from its recorded sources',
  input: {
    flow_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The flow (id or name); default: the only one of this workspace.'),
    description: z
      .string()
      .min(1)
      .max(4000)
      .optional()
      .describe('What the flow should do; default: the description it was generated from.'),
    skip_validators: z
      .boolean()
      .default(false)
      .describe('true: do not generate validators for the new version.'),
  },
  async card(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const found = await createResolver(ctx).flow(
      projectId,
      refId(ctx, 'flow_id', args.flow_id, 'ids.flow_ids'),
    );
    const flow = await getFlow(ctx, { project_id: projectId, flow_id: found.id });
    const name = thirdParty(ctx, flow.name, NAME_LIMIT);
    // the backend refuses a flow with no recorded source (400): said before any question
    if (!flow.can_regenerate)
      throw new ToolError('flows_regenerate_unavailable', { params: { name } });
    const facts: RegenerateFlowFacts = {
      flow_id: flow.id,
      name,
      version: flow.current_version,
      blocks: flow.blocks.length,
      description: thirdParty(ctx, descriptionOf(flow, args.description), DESCRIPTION_SHOWN),
      skip_validators: args.skip_validators,
    };
    return { facts };
  },
  cardView: cardViewRegenerateFlow,
  run: (ctx, args, facts) => {
    const projectId = projectIdOf(ctx, undefined);
    return startOperation(ctx, flowGenerationOperation, {
      // the same flow still being regenerated is joined: a second call must not pay for it twice
      matches: (run) => run.projectId === projectId && run.regenerate?.flowId === facts.flow_id,
      async start() {
        const flow = await getFlow(ctx, { project_id: projectId, flow_id: facts.flow_id });
        // the person said yes to this version: a flow that changed since is a new card
        if (flow.current_version !== facts.version) {
          throw new ToolError('flows_regenerate_changed', { params: { name: facts.name } });
        }
        const started = await regenerateFlow(
          ctx,
          { project_id: projectId, flow_id: facts.flow_id },
          {
            description: descriptionOf(flow, args.description),
            skip_validators: args.skip_validators,
          },
        );
        return {
          id: started.run_id,
          saved: {
            projectId,
            name: facts.name,
            regenerate: { flowId: facts.flow_id, previousVersion: facts.version },
          },
        };
      },
    });
  },
  render: renderOperation(flowGenerationOperation),
});
