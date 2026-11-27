// `data_get_copilot_history` (module data): Get the project's data hub conversation.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. A conversation is text a person and a model wrote, so every message passes `content`. The
// backend returns the whole conversation; the tool keeps the latest `limit` messages and counts the
// rest. The bodies of the proposed actions (recipes, names, bindings) are never read: only their kind.
// Log: args "", result "{turns} turns": the data of the result carries the fields.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderDataHubHistory,
  type DataHubHistoryData,
  type DataHubMessage,
} from '../../render/data/getCopilotHistory.js';
import { callBackend, content, type CallContext, type QueryOf } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { DATA_GET_COPILOT_HISTORY } from './meta.generated.js';

/** GET /projects/{project_id}/data-hub/history (REST API v1) */
export function getDataHubHistory(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'get_data_hub_history_api_v1_projects__project_id__data_hub_history_get'>,
): Promise<OpOutput<'get_data_hub_history_api_v1_projects__project_id__data_hub_history_get'>> {
  return callBackend(
    ctx,
    'get_data_hub_history_api_v1_projects__project_id__data_hub_history_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

const MESSAGE_LIMIT = 600;
const KINDS_SHOWN = 5;

export const dataGetCopilotHistory = moduleTool(DATA_GET_COPILOT_HISTORY, {
  title: "Get the project's data hub conversation",
  input: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('How many of the latest messages to return (1-100).'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const answer = await getDataHubHistory(ctx, { project_id: projectId });
    const all: readonly DataHubMessage[] = (answer.messages ?? []).map((message) => ({
      role: content(ctx, message.role, 30),
      content: content(ctx, message.content, MESSAGE_LIMIT),
      actions: (message.actions ?? []).slice(0, KINDS_SHOWN).map((action) => action.kind),
      chips: (message.chips ?? []).length,
    }));
    const shown = all.slice(-args.limit);
    const data: DataHubHistoryData = {
      project_id: projectId,
      count: all.length,
      shown: shown.length,
      turns: all.filter((message) => message.role === 'user').length,
      messages: shown,
    };
    return { status: 'done', data };
  },
  render: renderDataHubHistory,
});
