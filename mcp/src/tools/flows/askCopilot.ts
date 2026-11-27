// `flows_ask_copilot` (module flows): Ask the flow copilot for changes to a flow; without a message
// it runs its standard review. Returns a proposal, changes nothing.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Consent: level 2, costly (the catalog names the cost: 1-2 LLM calls per turn;
// docs/consent-card.md). The first call reads the flow and makes the card; a repeat with the same
// arguments asks the person; only their yes sends the message (or the review) to the copilot.
// The flow is the argument, else the only one of the workspace. Nothing is saved by the call: the
// copilot proposes and the backend stores the proposal under `message_id`; no undo. The reply and
// the descriptions of the changes are model text over the user's flow: masked, one line; the blocks
// of a proposal are never copied (counts and block ids only).
// Log: args "Ask the flow copilot about {name}", result "{changes} changes proposed".
// Arguments (the catalog's): flow_id, message.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import {
  cardViewAskFlowCopilot,
  renderAskFlowCopilot,
  type AskFlowCopilotData,
  type AskFlowCopilotFacts,
} from '../../render/flows/askCopilot.js';
import { createResolver } from '../../resolve/handles.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { getFlow } from './get.js';
import { FLOWS_ASK_COPILOT } from './meta.generated.js';

/** POST /projects/{project_id}/flows/{flow_id}/copilot/messages (REST API v1) */
export function sendCopilotMessage(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string },
  body: BodyOf<'send_copilot_message_api_v1_projects__project_id__flows__flow_id__copilot_messages_post'>,
): Promise<
  OpOutput<'send_copilot_message_api_v1_projects__project_id__flows__flow_id__copilot_messages_post'>
> {
  return callBackend(
    ctx,
    'send_copilot_message_api_v1_projects__project_id__flows__flow_id__copilot_messages_post',
    { path, body },
  );
}

/** POST /projects/{project_id}/flows/{flow_id}/copilot/messages/review (REST API v1) */
export function reviewFlow(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string },
): Promise<
  OpOutput<'review_flow_api_v1_projects__project_id__flows__flow_id__copilot_messages_review_post'>
> {
  return callBackend(
    ctx,
    'review_flow_api_v1_projects__project_id__flows__flow_id__copilot_messages_review_post',
    { path },
  );
}

const REPLY_LIMIT = 1500;
const CHANGES_SHOWN = 20;

/** The flow the call means: the argument, else the only flow of the workspace, else `missing_argument`. */
function flowRefOf(ctx: ToolContext, given: string | undefined): string {
  if (given !== undefined) return given;
  const kept = ctx.state.process()?.ids.flow_ids ?? [];
  const [only] = kept;
  if (kept.length === 1 && only !== undefined) return only;
  throw new ToolError('missing_argument', { params: { name: 'flow_id' } });
}

export const flowsAskCopilot = moduleTool(FLOWS_ASK_COPILOT, {
  title: 'Ask the flow copilot for changes to a flow',
  input: {
    flow_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The flow (id or name); default: the only one of this workspace.'),
    message: z
      .string()
      .min(1)
      .max(4000)
      .optional()
      .describe('What to ask; without it the copilot runs its standard review.'),
  },
  async card(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const found = await createResolver(ctx).flow(projectId, flowRefOf(ctx, args.flow_id));
    const flow = await getFlow(ctx, { project_id: projectId, flow_id: found.id });
    const facts: AskFlowCopilotFacts = {
      name: thirdParty(ctx, flow.name, LIMITS.name),
      id: found.id,
      message: args.message === undefined ? null : thirdParty(ctx, args.message, LIMITS.sentence),
    };
    return { facts };
  },
  cardView: cardViewAskFlowCopilot,
  async run(ctx, args, facts) {
    const path = { project_id: projectIdOf(ctx, undefined), flow_id: facts.id };
    const answer =
      args.message === undefined
        ? await reviewFlow(ctx, path)
        : await sendCopilotMessage(ctx, path, { message: args.message });
    const changes = answer.changes ?? [];
    const data: AskFlowCopilotData = {
      flow: { id: facts.id },
      name: facts.name,
      review: args.message === undefined,
      message_id: answer.message_id,
      reply: thirdParty(ctx, answer.reply, REPLY_LIMIT),
      count: changes.length,
      proposed: changes.slice(0, CHANGES_SHOWN).map((change) => ({
        id: change.id,
        type: change.type,
        block: thirdParty(ctx, change.target_block_id, LIMITS.word),
        description: thirdParty(ctx, change.description, LIMITS.sentence),
        warnings: (change.warnings ?? []).length,
      })),
    };
    return {
      status: 'done',
      data,
      update: { log: { values: { name: facts.name, changes: changes.length } } },
    };
  },
  render: renderAskFlowCopilot,
});
