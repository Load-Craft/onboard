// The data hub's suggestion as calls of the data tools. `data_suggest_actions` asks the hub once and
// turns its actions into the calls that apply them, in its order: a `bind` is a pin
// (`data_set_bindings`), a `create_dataset` with column rules is `data_create_dataset` with the
// suggestion's handle (the rules stay in the cache, the model does not copy them), and every slot of
// plain data still missing gets its rows from its own columns (`data_create_dataset` with the slot).
// Accounts are never part of it: `data_create_accounts` and datasets with password columns need a
// call of their own, with the user's yes.
//
// The suggestion is kept in the cache section `drafts`, one per project; a new one replaces it.

import { createHash } from 'node:crypto';

import * as z from 'zod';

import { isSecretColumn, type PlanAction, type RecipeColumn } from '../../api/data.js';
import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import type { DataPlanView, PlanStep, SkippedAction } from '../../render/views/data.js';
import type { RunTarget } from '../../resolve/handles.js';
import type { SlotsRead } from './readPlan.js';
import { datasetRef, namedPicks, pinStep, readsSlot, type StepBase } from './steps.js';

/** The most actions of one answer of the hub that become calls; the rest is left out, and said so. */
export const SUGGESTED_ACTIONS_MAX = 40;

/** The prefix of the handle of a rule set of a suggestion: `data_suggestion:<id>/<n>`. */
export const SUGGESTION_KIND = 'data_suggestion';

type RulesAction = Extract<PlanAction, { columns: unknown }>;

const isRulesAction = (action: PlanAction): action is RulesAction =>
  action.kind === 'create_dataset' && 'columns' in action;

const suggestionKey = (projectId: string): string => `${SUGGESTION_KIND}:${projectId}`;

const recipeColumn = z.custom<RecipeColumn>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { column_name?: unknown }).column_name === 'string',
);

const storedSchema = z.object({
  id: z.string(),
  target: z.object({
    kind: z.enum(['scenario', 'composition']),
    id: z.string(),
    name: z.string(),
  }),
  rules: z.array(
    z.object({
      n: z.number().int(),
      name: z.string(),
      slot: z.string().nullable(),
      rows: z.number().nullable(),
      columns: z.array(recipeColumn),
    }),
  ),
});

/** A rule set of a kept suggestion: the dataset the hub proposed to make, for its target. */
export interface SuggestedRules {
  readonly handle: string;
  readonly target: RunTarget;
  readonly name: string;
  readonly slot: string | null;
  readonly rows: number | null;
  readonly columns: readonly RecipeColumn[];
}

/**
 * Keeps the rule sets of the hub's answer for the target; returns the suggestion's id, a digest of
 * the target, the time and the actions (another answer, or a later one, gets another id).
 */
async function keepSuggestion(
  ctx: Pick<ToolContext, 'state' | 'clock'>,
  projectId: string,
  target: RunTarget,
  actions: readonly PlanAction[],
): Promise<string> {
  const id = createHash('sha256')
    .update(JSON.stringify([projectId, target.id, ctx.clock.now(), actions]))
    .digest('hex')
    .slice(0, 8);
  const rules = actions.flatMap((action, index) =>
    isRulesAction(action)
      ? [
          {
            n: index + 1,
            name: action.name,
            slot: action.slot,
            rows: action.rows,
            columns: action.columns,
          },
        ]
      : [],
  );
  await ctx.state.set('drafts', suggestionKey(projectId), {
    id,
    target: { kind: target.kind, id: target.id, name: target.name },
    rules,
  });
  return id;
}

const HANDLE = /^data_suggestion:([0-9a-f]{8})\/(\d{1,3})$/u;

/** The rule set a handle names, from the project's kept suggestion. */
export function suggestedRules(
  ctx: Pick<ToolContext, 'state'>,
  projectId: string,
  handle: string,
): SuggestedRules {
  const wanted = handle.trim();
  const match = HANDLE.exec(wanted);
  const stored = storedSchema.safeParse(ctx.state.get('drafts', suggestionKey(projectId))?.value);
  const rules =
    match !== null && stored.success && stored.data.id === match[1]
      ? stored.data.rules.find((item) => item.n === Number(match[2]))
      : undefined;
  if (!stored.success || rules === undefined) {
    throw new ToolError('suggestion_unknown', { params: { handle: wanted } });
  }
  return {
    handle: wanted,
    target: stored.data.target,
    name: rules.name,
    slot: rules.slot,
    rows: rules.rows,
    columns: rules.columns,
  };
}

/** Why a rule set of the hub cannot be made into a dataset; undefined when it can. */
export function rulesProblem(
  rules: { readonly slot: string | null; readonly columns: readonly RecipeColumn[] },
  slots: Pick<SlotsRead, 'scenarios'>,
): 'no_rules' | 'secret_columns' | undefined {
  if (rules.columns.length === 0) return 'no_rules';
  // What a slot says about its columns counts too, so a secret under a neutral name is found.
  const slotKinds = new Map(
    slots.scenarios.flatMap((scenario) =>
      scenario.slots.flatMap((slot) =>
        slot.specs.map((item) => [`${slot.slot}\u0000${item.name}`, item.type] as const),
      ),
    ),
  );
  const secret = rules.columns.some(
    (column) =>
      isSecretColumn(column.column_name, column.generation_hint) ||
      isSecretColumn(column.column_name, column.semantics) ||
      (rules.slot !== null &&
        isSecretColumn(
          column.column_name,
          slotKinds.get(`${rules.slot}\u0000${column.column_name}`),
        )),
  );
  return secret ? 'secret_columns' : undefined;
}

/**
 * The calls that make the rows of every slot of plain data the plan says `data_create_dataset`
 * makes from the slot's columns, except slots an earlier call already fills.
 */
export function generationSteps(
  base: StepBase,
  plan: Pick<DataPlanView, 'fixes'>,
  filled: ReadonlySet<string> = new Set(),
): PlanStep[] {
  return plan.fixes
    .filter((fix) => fix.kind === 'data_generate' && !filled.has(fix.slot))
    .map((fix) => ({ tool: 'data_create_dataset', args: { ...base, slot: fix.slot } }));
}

export interface SuggestionRequest {
  readonly projectId: string;
  readonly target: RunTarget;
  /** What every call of the target carries: the target and the project, when the call named one. */
  readonly base: StepBase;
  /** What a call that names no target carries: the project, when the call named one. */
  readonly extra: StepBase;
}

/**
 * The hub's actions as calls, in its order, then the rows of the slots of plain data no action
 * fills. A pin carries the picks the calls before it make, so one replacing the map keeps them.
 */
export async function suggestionCalls(
  ctx: Pick<ToolContext, 'state' | 'clock'>,
  request: SuggestionRequest,
  slots: SlotsRead,
  plan: Pick<DataPlanView, 'fixes'>,
  actions: readonly PlanAction[],
): Promise<{ steps: PlanStep[]; skipped: SkippedAction[] }> {
  const cut = actions.length - SUGGESTED_ACTIONS_MAX;
  const taken = cut > 0 ? actions.slice(0, SUGGESTED_ACTIONS_MAX) : actions;
  const id = await keepSuggestion(ctx, request.projectId, request.target, taken);
  const picks = namedPicks(slots);
  const names = new Set(slots.datasets.map((dataset) => dataset.name));
  const known = new Set(slots.datasets.map((dataset) => dataset.id));
  const steps: PlanStep[] = [];
  const skipped: SkippedAction[] = [];
  const filled = new Set<string>();

  taken.forEach((action, index) => {
    const skip = (reason: SkippedAction['reason'], name: string | null, slot: string | null) =>
      skipped.push({ reason, kind: action.kind, name, slot });
    if (isRulesAction(action)) {
      const problem = rulesProblem(action, slots);
      if (problem !== undefined) skip(problem, action.name, action.slot);
      else if (names.has(action.name)) skip('exists', action.name, action.slot);
      else {
        steps.push({
          tool: 'data_create_dataset',
          args: { rules: `${SUGGESTION_KIND}:${id}/${String(index + 1)}`, ...request.extra },
        });
        names.add(action.name);
        if (action.slot !== null && readsSlot(slots, action.slot)) {
          picks[action.slot] = action.name;
          filled.add(action.slot);
        }
      }
    } else if (action.kind === 'bind' && 'slot' in action && action.slot !== null) {
      const datasetId = 'datasetId' in action ? action.datasetId : null;
      if (datasetId === null || !known.has(datasetId)) skip('dataset_gone', null, action.slot);
      else if (!readsSlot(slots, action.slot)) skip('slot_gone', null, action.slot);
      else {
        const dataset = datasetRef(slots.datasets, datasetId);
        steps.push(pinStep(request.base, picks, action.slot, dataset));
        picks[action.slot] = dataset;
        filled.add(action.slot);
      }
    } else if (action.kind === 'provision_accounts') skip('separate_call', null, null);
    else skip('not_applied', null, 'slot' in action ? action.slot : null);
  });
  if (cut > 0) {
    skipped.push({ reason: 'over_limit', kind: 'actions', name: null, slot: null, count: cut });
  }
  return { steps: [...steps, ...generationSteps(request.base, plan, filled)], skipped };
}
