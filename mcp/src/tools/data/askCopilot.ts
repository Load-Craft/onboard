// `data_ask_copilot` (module data): Ask the data hub copilot in free form; returns its reply and
// proposed actions. Applies nothing.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Consent: level 2, costly (the catalog names the cost: 1-3 LLM calls per turn;
// docs/consent-card.md). The first call reads the scenario or the composition and makes the card;
// a repeat with the same arguments asks the person; only their yes sends the message.
// The target is one of scenario_id and composition_id (both is a rule refusal); with neither, the
// composition of the workspace, else its only scenario, else `missing_argument`. The load profile
// is the argument, else the one chosen in the state (`choices.run.profile`), sent as the workload;
// without any, none is sent. The copilot proposes and the backend stores nothing the call applies:
// no undo. The reply, the issues and the chips are model text over the user's data: masked, one
// line; the actions are shown by kind and count only, never their bodies.
// Log: args "Ask the data hub copilot", result "{actions} actions proposed".
// Arguments (the catalog's): message, scenario_id, composition_id, profile.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import {
  cardViewAskDataCopilot,
  renderAskDataCopilot,
  type AskDataCopilotData,
  type AskDataCopilotFacts,
  type CopilotTargetKind,
} from '../../render/data/askCopilot.js';
import { createResolver } from '../../resolve/handles.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  refuseRule,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { getScenario } from '../scenario/get.js';
import { getComposition } from '../scenario/getComposition.js';
import { DATA_ASK_COPILOT } from './meta.generated.js';

/** POST /projects/{project_id}/data-hub/messages (REST API v1) */
export function sendDataHubMessage(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'send_data_hub_message_api_v1_projects__project_id__data_hub_messages_post'>,
): Promise<OpOutput<'send_data_hub_message_api_v1_projects__project_id__data_hub_messages_post'>> {
  return callBackend(
    ctx,
    'send_data_hub_message_api_v1_projects__project_id__data_hub_messages_post',
    { path, body },
  );
}

const REPLY_LIMIT = 1500;
const KINDS_SHOWN = 20;
const LIST_SHOWN = 10;

interface Target {
  readonly kind: CopilotTargetKind;
  readonly id: string;
  readonly name: string;
}

/** The scenario or the composition the call asks about, found and named. */
async function targetOf(
  ctx: ToolContext,
  args: { readonly scenario_id?: string | undefined; readonly composition_id?: string | undefined },
): Promise<Target> {
  if (args.scenario_id !== undefined && args.composition_id !== undefined) {
    refuseRule('data_copilot_one_of');
  }
  const projectId = projectIdOf(ctx, undefined);
  const process = ctx.state.process();
  const known = [...new Set(Object.values(process?.ids.scenario_ids ?? {}))];
  const [onlyScenario] = known;
  const asScenario =
    args.scenario_id !== undefined ||
    (args.composition_id === undefined &&
      process?.ids.composition_id === undefined &&
      known.length === 1);
  if (asScenario) {
    const ref = args.scenario_id ?? onlyScenario;
    if (ref === undefined) {
      throw new ToolError('missing_argument', { params: { name: 'scenario_id' } });
    }
    const found = await createResolver(ctx).scenario(projectId, ref);
    const scenario = await getScenario(ctx, { project_id: projectId, scenario_id: found.id });
    return { kind: 'scenario', id: found.id, name: thirdParty(ctx, scenario.name, LIMITS.name) };
  }
  const ref = args.composition_id ?? process?.ids.composition_id;
  if (ref === undefined) {
    throw new ToolError('missing_argument', { params: { name: 'scenario_id' } });
  }
  const found = await createResolver(ctx).composition(projectId, ref);
  const composition = await getComposition(ctx, {
    project_id: projectId,
    composition_id: found.id,
  });
  return {
    kind: 'composition',
    id: found.id,
    name: thirdParty(ctx, composition.name, LIMITS.name),
  };
}

/** The load profile of the call: the argument, else the one chosen in the state; null when none. */
function profileOf(
  ctx: ToolContext,
  given: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | null {
  if (given !== undefined) return { ...given };
  const chosen = ctx.state.process()?.choices.run.profile;
  return chosen === undefined ? null : { ...chosen };
}

/** The profile as the card shows it: its keys and values in order, masked. */
function profileText(ctx: ToolContext, profile: Record<string, unknown> | null): string | null {
  if (profile === null) return null;
  return thirdParty(
    ctx,
    Object.entries(profile)
      .map(([key, value]) => `${key} ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(', '),
    LIMITS.sentence,
  );
}

export const dataAskCopilot = moduleTool(DATA_ASK_COPILOT, {
  title: 'Ask the data hub copilot in free form',
  input: {
    message: z.string().min(1).max(4000).describe('The question for the data hub copilot.'),
    scenario_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The scenario (id or name) the question is about; give this or composition_id.'),
    composition_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The composition (id or name); give this or scenario_id.'),
    profile: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('The load profile to discuss; default: the chosen one.'),
  },
  async card(ctx, args) {
    const target = await targetOf(ctx, args);
    const facts: AskDataCopilotFacts = {
      kind: target.kind,
      name: target.name,
      id: target.id,
      message: thirdParty(ctx, args.message, LIMITS.sentence),
      profile: profileText(ctx, profileOf(ctx, args.profile)),
    };
    return { facts };
  },
  cardView: cardViewAskDataCopilot,
  async run(ctx, args, facts) {
    const workload = profileOf(ctx, args.profile);
    const answer = await sendDataHubMessage(
      ctx,
      { project_id: projectIdOf(ctx, undefined) },
      {
        message: args.message,
        ...(facts.kind === 'scenario' ? { scenario_id: facts.id } : { composition_id: facts.id }),
        ...(workload === null ? {} : { workload }),
      },
    );
    const actions = answer.actions ?? [];
    const kinds = new Map<string, number>();
    for (const action of actions) kinds.set(action.kind, (kinds.get(action.kind) ?? 0) + 1);
    const data: AskDataCopilotData = {
      target: { kind: facts.kind, id: facts.id },
      name: facts.name,
      reply: thirdParty(ctx, answer.reply, REPLY_LIMIT),
      count: actions.length,
      proposed: [...kinds].slice(0, KINDS_SHOWN).map(([kind, count]) => ({
        kind: thirdParty(ctx, kind, LIMITS.word),
        count,
      })),
      issues: (answer.issues ?? [])
        .slice(0, LIST_SHOWN)
        .map((issue) => thirdParty(ctx, issue, LIMITS.sentence)),
      chips: (answer.chips ?? [])
        .slice(0, LIST_SHOWN)
        .map((chip) => thirdParty(ctx, chip, LIMITS.label)),
    };
    return { status: 'done', data, update: { log: { values: { actions: actions.length } } } };
  },
  render: renderAskDataCopilot,
});
