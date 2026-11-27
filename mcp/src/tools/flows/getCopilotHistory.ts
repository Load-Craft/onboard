// `flows_get_copilot_history` (module flows): Get a flow's copilot conversation, or its improvement
// suggestions.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The conversation holds the user's words and the model's; both, the descriptions of the
// proposed changes and the texts of the suggestions pass the mask of a third party's text
// (`content`). The bodies of the proposed blocks and the values before and after a change are not
// read. The flow is named by its id or its name, or is the only flow of the workspace.
// Log: args "{flow_id}", result "{turns} turns": the log values carry `turns` (the turns shown, 0 for
// the suggestions).

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetCopilotHistory,
  type ChangeRow,
  type CopilotData,
  type TurnRow,
} from '../../render/flows/getCopilotHistory.js';
import { createResolver } from '../../resolve/handles.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { FLOWS_GET_COPILOT_HISTORY } from './meta.generated.js';
import { flowRefOf, mask, TEXT_LIMIT } from './shared.js';

/** GET /projects/{project_id}/flows/{flow_id}/copilot/history (REST API v1) */
export function getCopilotHistory(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string },
): Promise<
  OpOutput<'get_copilot_history_api_v1_projects__project_id__flows__flow_id__copilot_history_get'>
> {
  return callBackend(
    ctx,
    'get_copilot_history_api_v1_projects__project_id__flows__flow_id__copilot_history_get',
    { path },
  );
}

/** GET /projects/{project_id}/flows/{flow_id}/copilot/suggestions (REST API v1) */
export function getCopilotSuggestions(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string },
): Promise<
  OpOutput<'get_copilot_suggestions_api_v1_projects__project_id__flows__flow_id__copilot_suggestions_get'>
> {
  return callBackend(
    ctx,
    'get_copilot_suggestions_api_v1_projects__project_id__flows__flow_id__copilot_suggestions_get',
    { path },
  );
}

const CHANGES_SHOWN = 10;
const SUGGESTIONS_SHOWN = 10;

type Turn = NonNullable<
  OpOutput<'get_copilot_history_api_v1_projects__project_id__flows__flow_id__copilot_history_get'>['messages']
>[number];

function turnOf(ctx: CallContext, turn: Turn): TurnRow {
  const changes: ChangeRow[] = (turn.changes ?? []).slice(0, CHANGES_SHOWN).map((change) => ({
    type: content(ctx, change.type, 20),
    description: mask(ctx, change.description, 200),
    status:
      change.status === null || change.status === undefined
        ? null
        : content(ctx, change.status, 40),
    target_block_id:
      change.target_block_id === '' ? null : content(ctx, change.target_block_id, 60),
  }));
  return {
    role: content(ctx, turn.role, 20),
    kind: turn.kind === null || turn.kind === undefined ? null : content(ctx, turn.kind, 40),
    content: mask(ctx, turn.content, TEXT_LIMIT),
    changes,
  };
}

export const flowsGetCopilotHistory = moduleTool(FLOWS_GET_COPILOT_HISTORY, {
  title: "Get a flow's copilot conversation",
  input: {
    flow_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The flow: its id or name; default: the only flow of this workspace.'),
    suggestions: z
      .boolean()
      .default(false)
      .describe("true: the copilot's open suggestions instead of the conversation."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe('How many of the latest turns to return (1-50).'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const found = await createResolver(ctx).flow(projectId, flowRefOf(ctx, args.flow_id));
    const flow = { id: found.id, name: mask(ctx, found.name) };
    const path = { project_id: projectId, flow_id: found.id };
    const flowValue = args.flow_id ?? '';
    if (args.suggestions) {
      const answer = await getCopilotSuggestions(ctx, path);
      const items = answer.suggestions ?? [];
      const data: CopilotData = {
        mode: 'suggestions',
        project_id: projectId,
        flow,
        count: items.length,
        shown: Math.min(items.length, SUGGESTIONS_SHOWN),
        messages: [],
        suggestions: items.slice(0, SUGGESTIONS_SHOWN).map((item) => ({
          target_block_id: content(ctx, item.target_block_id, 60),
          text: mask(ctx, item.text, TEXT_LIMIT),
        })),
      };
      return {
        status: 'done',
        data,
        update: { log: { values: { flow_id: flowValue, turns: 0 } } },
      };
    }
    const history = await getCopilotHistory(ctx, path);
    const all = history.messages ?? [];
    const messages = all.slice(-args.limit).map((turn) => turnOf(ctx, turn));
    const data: CopilotData = {
      mode: 'history',
      project_id: projectId,
      flow,
      count: all.length,
      shown: messages.length,
      messages,
      suggestions: [],
    };
    return {
      status: 'done',
      data,
      update: { log: { values: { flow_id: flowValue, turns: messages.length } } },
    };
  },
  render: renderGetCopilotHistory,
});
