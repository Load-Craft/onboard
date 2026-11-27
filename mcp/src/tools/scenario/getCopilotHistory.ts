// `scenario_get_copilot_history` (module scenario): Get a copilot conversation: the traffic-split
// planner or a scenario's copilot.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. A conversation is text a person and a model wrote, so every message passes `content`. One
// operation by target: the scenario's copilot or the traffic-split planner's draft (exactly one;
// without either, the draft of the workspace). The backend returns the whole conversation; the tool
// keeps the latest `limit` messages and counts the rest.
// Log: args "{scenario_id}", result "{turns} turns": the log values carry the target (the id of the
// scenario or of the draft) and the turns (messages of the user in the whole conversation).

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import {
  renderCopilotHistory,
  type CopilotHistoryData,
  type CopilotMessage,
} from '../../render/scenario/getCopilotHistory.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { fromState, projectIdOf } from '../moduleState.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { SCENARIO_GET_COPILOT_HISTORY } from './meta.generated.js';

/** GET /projects/{project_id}/scenario-builder/{draft_id}/history (REST API v1) */
export function getHistory(
  ctx: CallContext,
  path: { readonly project_id: string; readonly draft_id: string },
): Promise<
  OpOutput<'get_history_api_v1_projects__project_id__scenario_builder__draft_id__history_get'>
> {
  return callBackend(
    ctx,
    'get_history_api_v1_projects__project_id__scenario_builder__draft_id__history_get',
    { path },
  );
}

/** GET /projects/{project_id}/gatling/scenarios/{scenario_id}/copilot/history (REST API v1) */
export function getScenarioDetailHistory(
  ctx: CallContext,
  path: { readonly project_id: string; readonly scenario_id: string },
): Promise<
  OpOutput<'get_scenario_detail_history_api_v1_projects__project_id__gatling_scenarios__scenario_id__copilot_history_get'>
> {
  return callBackend(
    ctx,
    'get_scenario_detail_history_api_v1_projects__project_id__gatling_scenarios__scenario_id__copilot_history_get',
    { path },
  );
}

const MESSAGE_LIMIT = 600;
const KINDS_SHOWN = 5;

type PlannerMessage =
  OpOutput<'get_history_api_v1_projects__project_id__scenario_builder__draft_id__history_get'>['messages'] extends
    readonly (infer M)[] | undefined
    ? M
    : never;
type ScenarioMessage =
  OpOutput<'get_scenario_detail_history_api_v1_projects__project_id__gatling_scenarios__scenario_id__copilot_history_get'>['messages'] extends
    readonly (infer M)[] | undefined
    ? M
    : never;

function plannerOf(ctx: CallContext, message: PlannerMessage): CopilotMessage {
  return {
    role: content(ctx, message.role, 30),
    content: content(ctx, message.content, MESSAGE_LIMIT),
    kind:
      message.kind === null || message.kind === undefined ? null : content(ctx, message.kind, 30),
    actions: [],
    proposal_entries: message.proposal == null ? null : (message.proposal.entries ?? []).length,
    chips: (message.chips ?? []).length,
  };
}

function scenarioOf(ctx: CallContext, message: ScenarioMessage): CopilotMessage {
  return {
    role: content(ctx, message.role, 30),
    content: content(ctx, message.content, MESSAGE_LIMIT),
    kind: null,
    actions: (message.actions ?? []).slice(0, KINDS_SHOWN).map((action) => action.kind),
    proposal_entries: null,
    chips: 0,
  };
}

export const scenarioGetCopilotHistory = moduleTool(SCENARIO_GET_COPILOT_HISTORY, {
  title: 'Get a copilot conversation',
  input: {
    scenario_id: uuidArgument()
      .optional()
      .describe("A scenario's copilot conversation (not with draft_id)."),
    draft_id: uuidArgument()
      .optional()
      .describe('The traffic-split planner draft; default: the draft of this workspace.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('How many of the latest messages to return (1-100).'),
  },
  async run(ctx, args) {
    if (args.scenario_id !== undefined && args.draft_id !== undefined) {
      throw new ToolError('invalid', {
        params: { detail: 'pass scenario_id or draft_id, not both' },
      });
    }
    const projectId = projectIdOf(ctx, undefined);
    const stateDraft = fromState(ctx, 'ids.split_draft_id');
    const draftId =
      args.scenario_id !== undefined
        ? undefined
        : (args.draft_id ?? (typeof stateDraft === 'string' ? stateDraft : undefined));
    if (args.scenario_id === undefined && draftId === undefined) {
      throw new ToolError('missing_argument', { params: { name: 'scenario_id' } });
    }
    const source = args.scenario_id === undefined ? 'planner' : 'scenario';
    const targetId = args.scenario_id?.toLowerCase() ?? draftId ?? '';
    const all: readonly CopilotMessage[] =
      draftId === undefined
        ? (
            (await getScenarioDetailHistory(ctx, { project_id: projectId, scenario_id: targetId }))
              .messages ?? []
          ).map((message) => scenarioOf(ctx, message))
        : (
            (await getHistory(ctx, { project_id: projectId, draft_id: draftId })).messages ?? []
          ).map((message) => plannerOf(ctx, message));
    const shown = all.slice(-args.limit);
    const turns = all.filter((message) => message.role === 'user').length;
    const data: CopilotHistoryData = {
      source,
      project_id: projectId,
      target_id: targetId,
      count: all.length,
      shown: shown.length,
      turns,
      messages: shown,
    };
    return {
      status: 'done',
      data,
      update: { log: { values: { scenario_id: targetId, turns } } },
    };
  },
  render: renderCopilotHistory,
});
