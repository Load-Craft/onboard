// `scenario_ask_copilot` (module scenario): Ask the scenario copilot what to fix, or run its
// readiness review. Proposes actions, applies none.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "Ask the scenario copilot about {name}", result "{actions} actions proposed": the data
// of the result carries the fields.
// Consent: level 2, costly, on a card (docs/consent-card.md): one or two LLM calls per turn. The first
// call reads the scenario and makes the card (the name, the question or the review, the load profile
// that goes with it, the cost); a repeat with the same arguments asks the person; only their yes asks
// the copilot. The copilot proposes actions and applies none; the exchange is saved in the scenario's
// copilot history. Exactly one of `message` and `review`. The load profile is the argument, else the
// one the workspace chose (`choices.run.profile`); it goes to the backend as the `workload`. The reply
// and the proposals are model text: masked, one line, cut. The call may wait for the model
// (`callBackendFor`).
// Arguments (the catalog's): scenario_id (default: the only one), message, review, profile.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  cardViewAskCopilot,
  renderAskCopilot,
  type ActionKind,
  type AskCopilotData,
  type AskCopilotFacts,
  type ProposedAction,
} from '../../render/scenario/askCopilot.js';
import { createResolver } from '../../resolve/handles.js';
import {
  callBackendFor,
  projectIdOf,
  refuseRule,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { getScenario } from './get.js';
import { SCENARIO_ASK_COPILOT } from './meta.generated.js';
import { scenarioIdOf } from './scenarioId.js';

/** One or two model calls, the plan retried once: the call may wait this long. */
const ASK_TIMEOUT_MS = 180_000;

/** POST /projects/{project_id}/gatling/scenarios/{scenario_id}/copilot/messages (REST API v1) */
export function sendScenarioDetailMessage(
  ctx: CallContext,
  path: { readonly project_id: string; readonly scenario_id: string },
  body: BodyOf<'send_scenario_detail_message_api_v1_projects__project_id__gatling_scenarios__scenario_id__copilot_messages_post'>,
): Promise<
  OpOutput<'send_scenario_detail_message_api_v1_projects__project_id__gatling_scenarios__scenario_id__copilot_messages_post'>
> {
  return callBackendFor(
    ctx,
    ASK_TIMEOUT_MS,
    'send_scenario_detail_message_api_v1_projects__project_id__gatling_scenarios__scenario_id__copilot_messages_post',
    { path, body },
  );
}

/** POST /projects/{project_id}/gatling/scenarios/{scenario_id}/copilot/messages/review (REST API v1) */
export function reviewScenarioDetail(
  ctx: CallContext,
  path: { readonly project_id: string; readonly scenario_id: string },
  body?: BodyOf<'review_scenario_detail_api_v1_projects__project_id__gatling_scenarios__scenario_id__copilot_messages_review_post'>,
): Promise<
  OpOutput<'review_scenario_detail_api_v1_projects__project_id__gatling_scenarios__scenario_id__copilot_messages_review_post'>
> {
  return callBackendFor(
    ctx,
    ASK_TIMEOUT_MS,
    'review_scenario_detail_api_v1_projects__project_id__gatling_scenarios__scenario_id__copilot_messages_review_post',
    { path, ...(body === undefined ? {} : { body }) },
  );
}

const NAME_LIMIT = 120;
const MESSAGE_SHOWN = 300;
const PROFILE_LIMIT = 200;
const REPLY_LIMIT = 1500;
const ACTIONS_SHOWN = 10;
const SUMMARY_LIMIT = 200;

type Answer =
  OpOutput<'send_scenario_detail_message_api_v1_projects__project_id__gatling_scenarios__scenario_id__copilot_messages_post'>;

type StateOf = Parameters<typeof scenarioIdOf>[0];

/** The load profile of the call: the argument, else the one the workspace chose; null for none. */
function workloadOf(
  ctx: StateOf,
  given: Readonly<Record<string, unknown>> | undefined,
): { readonly value: Record<string, unknown>; readonly source: 'argument' | 'state' } | null {
  if (given !== undefined)
    return Object.keys(given).length === 0 ? null : { value: { ...given }, source: 'argument' };
  const kept = ctx.state.process()?.choices.run.profile;
  return kept === undefined ? null : { value: { ...kept }, source: 'state' };
}

function actionOf(
  ctx: CallContext,
  action: Answer['actions'] extends (infer A)[] | undefined ? A : never,
): ProposedAction {
  const kind: ActionKind =
    action.kind === 'adjust_and_regenerate' ||
    action.kind === 'generate_slot_feeder' ||
    action.kind === 'rewrite_validator'
      ? action.kind
      : 'other';
  const text = (value: string, max: number): string => thirdParty(ctx, value, max);
  if (action.kind === 'generate_slot_feeder') {
    return { kind, about: text(action.slot, 80), summary: `${String(action.row_count)} rows` };
  }
  if (action.kind === 'rewrite_validator') {
    return {
      kind,
      about: text(action.validator_name, 80),
      summary: text(action.summary, SUMMARY_LIMIT),
    };
  }
  return { kind, about: null, summary: text(action.summary, SUMMARY_LIMIT) };
}

export const scenarioAskCopilot = moduleTool(SCENARIO_ASK_COPILOT, {
  title: 'Ask the scenario copilot what to fix',
  input: {
    scenario_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The scenario (id or name); default: the only one of this workspace.'),
    message: z
      .string()
      .min(1)
      .max(4000)
      .optional()
      .describe('The question for the scenario copilot.'),
    review: z
      .boolean()
      .optional()
      .describe('true: the standard readiness review instead of a question (not with message).'),
    profile: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('The load profile to discuss; default: the chosen one.'),
  },
  async card(ctx, args) {
    const review = args.review === true;
    if (review === (args.message !== undefined)) refuseRule('copilot_ask_one_of');
    const projectId = projectIdOf(ctx, undefined);
    const found = await createResolver(ctx).scenario(
      projectId,
      scenarioIdOf(ctx, args.scenario_id),
    );
    const scenario = await getScenario(ctx, { project_id: projectId, scenario_id: found.id });
    const workload = workloadOf(ctx, args.profile);
    const facts: AskCopilotFacts = {
      scenario_id: found.id,
      name: thirdParty(ctx, scenario.name, NAME_LIMIT),
      mode: review ? 'review' : 'message',
      message: args.message === undefined ? null : thirdParty(ctx, args.message, MESSAGE_SHOWN),
      profile:
        workload === null ? null : thirdParty(ctx, JSON.stringify(workload.value), PROFILE_LIMIT),
      profile_source: workload?.source ?? null,
    };
    return { facts };
  },
  cardView: cardViewAskCopilot,
  async run(ctx, args, facts) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId, scenario_id: facts.scenario_id };
    const workload = workloadOf(ctx, args.profile);
    const answer =
      facts.mode === 'review'
        ? await reviewScenarioDetail(
            ctx,
            path,
            workload === null ? undefined : { workload: workload.value },
          )
        : await sendScenarioDetailMessage(ctx, path, {
            message: args.message ?? '',
            ...(workload === null ? {} : { workload: workload.value }),
          });
    const actions = answer.actions ?? [];
    const reply = thirdParty(ctx, answer.reply, REPLY_LIMIT + 1);
    const data: AskCopilotData = {
      scenario_id: facts.scenario_id,
      name: facts.name,
      mode: facts.mode,
      reply: reply.slice(0, REPLY_LIMIT),
      reply_cut: reply.length > REPLY_LIMIT,
      proposals: actions.slice(0, ACTIONS_SHOWN).map((action) => actionOf(ctx, action)),
      actions: actions.length,
    };
    return {
      status: 'done',
      data,
      update: { log: { values: { actions: data.actions } } },
    };
  },
  render: renderAskCopilot,
});
