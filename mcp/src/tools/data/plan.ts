// The data plan as data: slot rows, the fixes before the test and the verdict "ready". Pure: the
// tool reads the backend, this file decides what the facts mean.

import {
  isPlainDataSlot,
  SECRET_NAME,
  type ColumnSpec,
  type Dataset,
  type ProposedAction,
  type ScenarioSlots,
  type SlotSpec,
  type SlotStatus,
  type SlotVerdictState,
} from '../../api/data.js';
import type {
  PlanColumn,
  PlanFix,
  PlanSlot,
  DataPlanView,
  SlotFault,
} from '../../render/views/data.js';

/**
 * Statuses with which the test cannot start. `short_rows` is not one of them: the number of rows
 * a run needs depends on its load, which `run_start` checks. This is the plugin's own rule, not
 * the backend's `all_clear`, which leaves `column_mismatch` and `stale_pin` out.
 */
export const BLOCKING: ReadonlySet<SlotStatus> = new Set<SlotStatus>([
  'missing',
  'column_mismatch',
  'stale_pin',
  'empty_column',
  'parse_error',
]);

const FAULTS: ReadonlySet<string> = new Set<SlotFault>([
  'column_mismatch',
  'stale_pin',
  'empty_column',
  'parse_error',
]);

const isFault = (status: SlotStatus): status is SlotFault => FAULTS.has(status);

const capitalized = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** `Visa, Mastercard` for a card column, `1–5` for a numeric range, nothing otherwise. */
export function qualifierOf(spec: ColumnSpec | undefined): string | null {
  if (spec === undefined) return null;
  if (spec.cardNetworks.length > 0) return spec.cardNetworks.map(capitalized).join(', ');
  if (spec.min !== null && spec.max !== null) return `${String(spec.min)}–${String(spec.max)}`;
  return null;
}

export interface PlanFacts {
  readonly target: DataPlanView['target'];
  readonly environment: string | null;
  readonly verdicts: readonly SlotVerdictState[];
  /** Slot specs of the target's scenarios, each with the scenarios that read it. */
  readonly specs: readonly (SlotSpec & { readonly usedBy: readonly string[] })[];
  readonly scenarioIds: readonly string[];
  /** The scenarios the target runs, in its order, each with its own slots. */
  readonly members: readonly Pick<ScenarioSlots, 'id' | 'slots'>[];
  readonly datasets: readonly Dataset[];
  readonly proposed: readonly ProposedAction[];
  /** The first sentence of the data hub's reply (why it proposes nothing); null when not asked. */
  readonly hubReply: string | null;
  /** Slots whose generation the backend refused (kept since that call), with its reason. */
  readonly refused?: ReadonlyMap<string, string>;
}

/** Why `data_create_dataset` cannot make the rows of a slot of plain data from its columns. */
export type NoGeneration = 'no_source' | 'secret_columns';

/** What fills a missing slot of plain data. */
export type DataSlotRemedy =
  /** `data_create_dataset` makes the rows from the columns of this member's slot. */
  | { readonly kind: 'slot_generates'; readonly scenarioId: string }
  /** A call the data hub's suggestion lists fills the slot (a dataset from rules, a pin). */
  | { readonly kind: 'suggested' }
  /** Only a file with the columns; no tool can make the slot's rows. */
  | {
      readonly kind: 'file_only';
      readonly reason: NoGeneration | 'refused';
      readonly columns: string[];
      /** What the backend said when it refused to generate the rows. */
      readonly detail?: string;
      /** The data hub's own reason, when it was asked and said one. */
      readonly hub?: string;
    };

export interface RemedyFacts {
  readonly verdicts: readonly SlotVerdictState[];
  readonly members: readonly Pick<ScenarioSlots, 'id' | 'slots'>[];
  /** The hub's proposals; empty when the hub was not asked (`suggested` is then never chosen). */
  readonly proposed: readonly ProposedAction[];
  readonly hubReply: string | null;
  readonly refused?: ReadonlyMap<string, string>;
}

/** Kinds of the hub's actions a call of the suggestion carries out for a slot. */
const APPLIED_KINDS: ReadonlySet<string> = new Set(['create_dataset', 'bind']);

/**
 * The one answer to "what fills this missing slot of plain data", used by every text that names a
 * way on (the plan's fix and its calls, the refusal of `data_create_dataset` and of
 * `data_create_accounts`): the generation from the slot's columns is named only when it can work.
 */
export function dataSlotRemedy(slot: string, facts: RemedyFacts): DataSlotRemedy {
  const required = facts.verdicts.find((item) => item.slot === slot)?.columns ?? [];
  const declared = [
    ...new Set(
      facts.members.flatMap((member) =>
        member.slots.filter((spec) => spec.slot === slot).flatMap((spec) => spec.columns),
      ),
    ),
  ];
  const fileOnly = (reason: NoGeneration | 'refused', detail?: string): DataSlotRemedy => ({
    kind: 'file_only',
    reason,
    columns: required.length > 0 ? [...required] : declared,
    ...(detail === undefined ? {} : { detail }),
    ...(facts.hubReply === null ? {} : { hub: facts.hubReply }),
  });
  const refused = facts.refused?.get(slot);
  if (refused !== undefined) return fileOnly('refused', refused);
  const source = generationSourceOf(slot, required, facts.members);
  if ('scenarioId' in source) return { kind: 'slot_generates', scenarioId: source.scenarioId };
  if (facts.proposed.some((action) => action.slot === slot && APPLIED_KINDS.has(action.kind))) {
    return { kind: 'suggested' };
  }
  return fileOnly(source.none);
}

/**
 * The scenario whose slot the rows of a slot of plain data are made from, or why there is none.
 * The backend generates from one scenario's slot, with that slot's columns: the first member, in
 * the order the target runs them, that declares the slot as plain data and has every column the
 * target requires (for a composition, the columns of all its members), so the dataset passes the
 * run's column check. A slot with a secret column is left to a file: the backend never invents one.
 */
export function generationSourceOf(
  slot: string,
  required: readonly string[],
  members: readonly Pick<ScenarioSlots, 'id' | 'slots'>[],
): { readonly scenarioId: string } | { readonly none: NoGeneration } {
  const declared = members.flatMap((member) =>
    member.slots
      .filter((spec) => spec.slot === slot && isPlainDataSlot(spec))
      .map((spec) => ({ id: member.id, columns: spec.columns })),
  );
  const covering = declared.find((candidate) =>
    required.every((column) => candidate.columns.includes(column)),
  );
  if (covering === undefined) return { none: 'no_source' };
  if (covering.columns.some((column) => SECRET_NAME.test(column))) {
    return { none: 'secret_columns' };
  }
  return { scenarioId: covering.id };
}

const sameColumns = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((name) => b.includes(name));

/** The dataset a slot reads: the one pinned to it, or the one the generation made for its columns. */
function datasetOf(
  verdict: SlotVerdictState,
  spec: SlotSpec | undefined,
  facts: PlanFacts,
): Dataset | undefined {
  if (verdict.datasetId !== null) {
    return facts.datasets.find((dataset) => dataset.id === verdict.datasetId);
  }
  if (verdict.status !== 'auto' || spec === undefined) return undefined;
  return facts.datasets.find(
    (dataset) =>
      dataset.autoLinkedScenarioId !== null &&
      facts.scenarioIds.includes(dataset.autoLinkedScenarioId) &&
      sameColumns(dataset.columns, spec.columns),
  );
}

function planSlot(verdict: SlotVerdictState, facts: PlanFacts): PlanSlot {
  const spec = facts.specs.find((candidate) => candidate.slot === verdict.slot);
  const dataset = datasetOf(verdict, spec, facts);
  const columns: PlanColumn[] = (spec?.columns ?? []).map((name) => ({
    name,
    qualifier: qualifierOf(spec?.specs.find((item) => item.name === name)),
  }));
  const described = new Set(columns.filter((c) => c.qualifier !== null).map((c) => c.name));
  const sources = (dataset?.generators ?? [])
    .filter((entry) => !described.has(entry.column))
    .map((entry) => entry.generator);
  return {
    slot: verdict.slot,
    label: spec?.label ?? verdict.label ?? verdict.slot,
    state: verdict.status,
    columns,
    sources: [...new Set(sources)],
    exclusive: spec?.strategy === 'queue' || dataset?.exclusive === true,
    usedBy: [...(spec?.usedBy ?? [])],
  };
}

/** Name of the dataset a proposal would fill the slot from; undefined when nothing names it. */
function proposedDataset(slot: string, facts: PlanFacts): string | undefined {
  for (const action of facts.proposed) {
    if (action.slot === slot && action.name !== null) return action.name;
    if (action.kind === 'provision_accounts' && action.dataset !== null) {
      const dataset = facts.datasets.find((item) => item.id === action.dataset);
      if (dataset !== undefined) return dataset.name;
    }
  }
  return undefined;
}

function fixOf(slot: PlanSlot, facts: PlanFacts): PlanFix | undefined {
  if (!BLOCKING.has(slot.state)) return undefined;
  const base = { slot: slot.slot, label: slot.label };
  if (isFault(slot.state)) return { kind: slot.state, ...base };
  const spec = facts.specs.find((candidate) => candidate.slot === slot.slot);
  if (spec?.identityKind === 'existing' && facts.environment !== null) {
    const dataset = proposedDataset(slot.slot, facts);
    return {
      kind: 'accounts_must_exist',
      ...base,
      ...(dataset === undefined ? {} : { dataset }),
      environment: facts.environment,
    };
  }
  // A slot the backend judged to be plain data: `data_create_dataset` makes its rows when a
  // scenario of the target can be their source (or the hub's suggestion fills it); otherwise it
  // comes from a file. The accounts of the other slots come from `data_create_accounts` or a file.
  if (spec !== undefined && isPlainDataSlot(spec)) return dataFix(slot, facts);
  return { kind: 'dataset_missing', ...base };
}

function dataFix(slot: PlanSlot, facts: PlanFacts): PlanFix {
  const base = { slot: slot.slot, label: slot.label };
  const remedy = dataSlotRemedy(slot.slot, facts);
  if (remedy.kind === 'slot_generates') return { kind: 'data_generate', ...base };
  if (remedy.kind === 'suggested') return { kind: 'data_missing', ...base };
  return {
    kind: 'data_from_file',
    ...base,
    reason: remedy.reason,
    columns: remedy.columns,
    ...(remedy.detail === undefined ? {} : { detail: remedy.detail }),
    ...(remedy.hub === undefined ? {} : { hub: remedy.hub }),
  };
}

export function composePlan(facts: PlanFacts): DataPlanView {
  const slots = facts.verdicts.map((verdict) => planSlot(verdict, facts));
  const fixes = slots.flatMap((slot) => fixOf(slot, facts) ?? []);
  return {
    target: facts.target,
    environment: facts.environment,
    slots,
    fixes,
    ready: slots.every((slot) => !BLOCKING.has(slot.state)),
    proposed: [...facts.proposed],
    steps: [],
  };
}
