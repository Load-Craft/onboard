// `data_suggest_actions`: the data hub's suggestion for a scenario or composition, as the calls of the
// data tools that apply it, in its order. The hub may call a model (up to 3 calls), so it is asked
// only when a slot is missing, and only after the user's yes to a consent card: the first call
// returns the card and the plan without the hub; the repeat with the card's token asks the hub.
// It applies nothing and never creates accounts (that is `data_create_accounts`).

import * as z from 'zod/v4';

import { suggestActions } from '../api/data.js';
import { cardGate } from '../consent/confirmCard.js';
import { defineTool } from '../registry.js';
import {
  renderSuggestCard,
  renderSuggestion,
  type SuggestCardView,
  type SuggestionView,
} from '../render/views/data.js';
import { planOf, readSlots, refusalsOf } from './data/readPlan.js';
import { generationSteps, suggestionCalls } from './data/suggestion.js';
import {
  environmentField,
  projectArgs,
  projectField,
  resolveTarget,
  scenarioField,
} from './data/target.js';

/** The card of this tool; every call shows its own (no yes covers another call yet). */
const SCOPE = 'data_suggest_actions';

const input = z.strictObject({
  scenario: scenarioField,
  environment: environmentField,
  project: projectField,
  confirm: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .optional()
    .describe(
      'Leave it out in the first call: when a slot is missing the answer is a consent card for ' +
        'the user. Only after the user said yes to that card, repeat the call with the same ' +
        'arguments and the token the card printed.',
    ),
});

type Data = SuggestionView | SuggestCardView;
const isCard = (data: Data): data is SuggestCardView => 'needsConfirmation' in data;

export const dataSuggestActions = defineTool<typeof input, Data>({
  name: 'data_suggest_actions',
  title: 'Suggest the test data of a scenario',
  description:
    'Suggest the test data a scenario or composition needs (data hub LLM): proposed actions and ' +
    'the tool for each. Applies nothing. Answers with the data plan and the exact calls that ' +
    'apply the suggestion, in their order (data_set_bindings, data_create_dataset); accounts are ' +
    'left to data_create_accounts or a file. When every slot is filled the hub is not asked. ' +
    'Otherwise the first call returns a consent card and asks nothing; after the user says yes, ' +
    'repeat the call with confirm set to the token of that card.',
  input,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  // names and texts of LoadCraft's answers in the data are shown masked (FIX-76)
  maskNames: true,
  async run(ctx, args) {
    const { projectId, target, environment } = await resolveTarget(ctx, args);
    const request = {
      projectId,
      target,
      ...(environment === undefined ? {} : { environment }),
      refused: refusalsOf(ctx, projectId, target.id),
    };
    const slots = await readSlots(ctx, request);
    const base = { scenario: args.scenario, ...projectArgs(args.project) };
    const asked = slots.verdicts.some((verdict) => verdict.status === 'missing');
    if (!asked) {
      const { view } = planOf(request, slots, { actions: [], reply: null });
      const data: SuggestionView = { ...view, steps: [], asked: false, skipped: [] };
      return { status: 'done', data, update: { checks: { data: { planned: { ok: true } } } } };
    }

    const gate = await cardGate(
      ctx,
      SCOPE,
      projectId,
      { target: target.id, environment: environment?.id ?? null },
      args.confirm,
    );
    if (!gate.write) {
      const { view } = planOf(request, slots, { actions: [], reply: null });
      const card: SuggestCardView = {
        needsConfirmation: true,
        confirm: gate.token,
        ...(gate.renewed === undefined ? {} : { renewed: gate.renewed }),
        target: { kind: target.kind, name: target.name },
        plan: { ...view, steps: generationSteps(base, view) },
      };
      return { status: 'done', inert: true, data: card };
    }

    const hub = await suggestActions(ctx, projectId, target);
    const { view } = planOf(request, slots, { actions: hub.actions, reply: hub.reply });
    const { steps, skipped } = await suggestionCalls(
      ctx,
      { projectId, target, base, extra: projectArgs(args.project) },
      slots,
      view,
      hub.applicable,
    );
    const data: SuggestionView = {
      ...view,
      steps,
      asked: true,
      skipped,
    };
    return { status: 'done', data, update: { checks: { data: { planned: { ok: true } } } } };
  },
  render: (data, t) => (isCard(data) ? renderSuggestCard(data, t) : renderSuggestion(data, t)),
});
