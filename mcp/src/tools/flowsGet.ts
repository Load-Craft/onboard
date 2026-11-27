// The data of one flow as `flows_get` (tools/flows/get.ts) and the data channel of `process_get_status`
// draw it: the outline of the flow with its version and the questions the generator left on it.

import type { ToolContext } from '../context.js';
import {
  flowQuestions,
  getFlow as readFlow,
  needsOfDetail,
  type FlowQuestion,
} from '../api/flows.js';
import type { FlowNeeds } from '../flow/needsInput.js';
import { buildOutline, type FlowOutline } from '../flow/outline.js';

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
