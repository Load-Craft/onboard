// `flows_get`: the outline of one flow, as the LoadCraft Outline screen shows it, with its version,
// the questions the generator left on it (`needs_input` of the flow) and a link to the flow. The
// warning `flows_need_input` of the state follows what it read about this flow.

import * as z from 'zod/v4';

import type { ToolContext } from '../context.js';
import { getCompat } from '../api/status.js';
import {
  flowQuestions,
  getFlow as readFlow,
  needsOfDetail,
  type FlowQuestion,
} from '../api/flows.js';
import { needsInputUpdate, type FlowNeeds } from '../flow/needsInput.js';
import { buildOutline, type FlowOutline } from '../flow/outline.js';
import { defineTool } from '../registry.js';
import { renderFlowOutline } from '../render/views/flowOutline.js';
import { createResolver } from '../resolve/handles.js';
import { readProjectBinding } from '../workspace/binding.js';

const input = z.object({
  flow: z.string().describe('Name of the flow, or its UUID.'),
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
});

export interface GetFlowData {
  readonly project: { readonly id: string; readonly name: string };
  readonly outline: FlowOutline;
  readonly questions: readonly FlowQuestion[];
}

/** Steps the outline data of the data channel carries; the rest is counted in `stepCount`. */
export const MAX_DATA_STEPS = 150;

/** The outline cut to `MAX_DATA_STEPS` steps, marked `truncated`; a shorter one comes back as it is. */
export function capOutline(outline: FlowOutline): FlowOutline {
  if (outline.steps.length <= MAX_DATA_STEPS) return outline;
  return { ...outline, steps: outline.steps.slice(0, MAX_DATA_STEPS), truncated: true };
}

/** One flow read: what `flows_get` draws and the open items of the flow. */
async function readFlowData(
  ctx: ToolContext,
  project: { readonly id: string; readonly name: string },
  flowId: string,
): Promise<{ readonly data: GetFlowData; readonly needs: FlowNeeds }> {
  const flow = await readFlow(ctx, project.id, flowId);
  return {
    data: { project, outline: buildOutline(flow), questions: flowQuestions(flow) },
    needs: needsOfDetail(flow),
  };
}

/** The data of one flow: what `flows_get` draws. Shared with the data channel of `process_get_status`. */
export async function flowData(
  ctx: ToolContext,
  project: { readonly id: string; readonly name: string },
  flowId: string,
): Promise<GetFlowData> {
  return (await readFlowData(ctx, project, flowId)).data;
}

export const flowsGet = defineTool({
  name: 'flows_get',
  title: 'Flow outline',
  description:
    'Show one flow as a numbered outline: requests with the variables they use and create, ' +
    'pauses with their length and source, expected statuses, plus the flow version and the ' +
    'questions the generator left open. Read-only.',
  input,
  annotations: { readOnlyHint: true },
  async run(ctx, args) {
    await getCompat(ctx);
    const resolver = createResolver(ctx);
    const project = await resolver.project(args.project);
    const found = await resolver.flow(project.id, args.flow);
    const { data, needs } = await readFlowData(ctx, project, found.id);
    // the warning names the flows of the bound project only
    const bound = readProjectBinding(ctx)?.project.id === project.id;
    const update = bound
      ? needsInputUpdate(ctx.state.process(), [needs], 'flows_get', 'some')
      : undefined;
    return {
      status: 'done',
      data,
      links: [ctx.services.links.flow(project.id, found.id)],
      ...(update === undefined ? {} : { update }),
    };
  },
  render(data, t) {
    return [
      renderFlowOutline(data.outline, t, { mode: 'full', questions: data.questions }),
      t('flow.get.version', { version: data.outline.version }),
    ].join('\n');
  },
});
