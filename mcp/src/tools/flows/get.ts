// `flows_get` (module flows): Get one flow as a numbered outline with variables, pauses and open
// questions.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the read and the
// view. The outline is built from the flow as LoadCraft stores it (flow/outline.ts); the names of
// steps, their paths, variables and the questions of the generator are text of the application under
// test, possibly from a recording, and pass the mask of a third party's text (`content`) before the
// view. The flow is named by its id or its name, or is the only flow of the workspace.
// Log: args "{flow_id}", result "{name} v{version}: {steps} steps; needs input: {needs_input}
// ({definite} definite)": the log values carry the fields. The warning `flows_need_input` of the
// state follows what was read about this flow (flow/needsInput.ts).

import * as z from 'zod';

import { needsInputUpdate } from '../../flow/needsInput.js';
import { maskOutline, maskQuestion } from '../../flow/maskOutline.js';
import { buildOutline, type FlowOutline } from '../../flow/outline.js';
import { flowQuestions, needsOfDetail, type FlowQuestion } from '../../flow/questions.js';
import type { OpOutput } from '../../http/operation.js';
import { renderFlowOutline } from '../../render/views/flowOutline.js';
import { createResolver } from '../../resolve/handles.js';
import { callBackend, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { FLOWS_GET } from './meta.generated.js';
import { flowRefOf } from './shared.js';

/** GET /projects/{project_id}/flows/{flow_id} (REST API v1) */
export function getFlow(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string },
): Promise<OpOutput<'get_flow_api_v1_projects__project_id__flows__flow_id__get'>> {
  return callBackend(ctx, 'get_flow_api_v1_projects__project_id__flows__flow_id__get', { path });
}

/**
 * What the call returns: the outline and the questions of one flow. The project is named by its id
 * only: a `name` under `project` would be read as the `{name}` of the log entry, which is the name
 * of the flow.
 */
interface FlowGetData {
  readonly project: { readonly id: string };
  readonly outline: FlowOutline;
  readonly questions: readonly FlowQuestion[];
}

export const flowsGet = moduleTool(FLOWS_GET, {
  title: 'Get one flow as a numbered outline with variables',
  input: {
    flow_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The flow: its id or name; default: the only flow of this workspace.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const found = await createResolver(ctx).flow(projectId, flowRefOf(ctx, args.flow_id));
    const flow = await getFlow(ctx, { project_id: projectId, flow_id: found.id });
    const outline = maskOutline(ctx, buildOutline(flow));
    const questions = flowQuestions(flow).map((item) => maskQuestion(ctx, item));
    const data: FlowGetData = {
      project: { id: projectId },
      outline,
      questions,
    };
    const needs = needsOfDetail(flow);
    const update = needsInputUpdate(ctx.state.process(), [needs], 'flows_get', 'some');
    return {
      status: 'done',
      data,
      links: [ctx.services.links.flow(projectId, found.id)],
      update: {
        ...(update ?? {}),
        log: {
          values: {
            flow_id: args.flow_id ?? '',
            name: outline.name,
            version: outline.version,
            steps: outline.stepCount,
            needs_input: needs.count,
            definite: needs.definite,
          },
        },
      },
    };
  },
  render(data, t) {
    return [
      renderFlowOutline(data.outline, t, { mode: 'full', questions: data.questions }),
      t('flow.get.version', { version: data.outline.version }),
    ].join('\n');
  },
});
