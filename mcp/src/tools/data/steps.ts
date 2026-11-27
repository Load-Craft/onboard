// The calls a data result names as the way on, with their exact arguments: a model copies them as
// they are. A pin is always the whole map of the target's own picks (`data_set_bindings` replaces
// it), so it keeps every pick made so far and adds the new one.

import type { Dataset } from '../../api/data.js';
import type { PlanStep } from '../../render/views/data.js';
import type { SlotsRead } from './readPlan.js';

/** What every call of one target carries: the target and, when the call named one, the project. */
export type StepBase = Readonly<Record<string, string>>;

/** How a call names a dataset: by its name when no other dataset of the project has it, else by id. */
export function datasetRef(datasets: readonly Dataset[], id: string): string {
  const dataset = datasets.find((item) => item.id === id);
  if (dataset === undefined) return id;
  const sameName = datasets.filter((item) => item.name === dataset.name);
  return sameName.length === 1 ? dataset.name : id;
}

/** The picks a run of the target reads from its own store: the composition's, or the scenario's. */
export function ownPicks(
  slots: Pick<SlotsRead, 'composition' | 'scenarios'>,
): Record<string, string> {
  if (slots.composition !== null) return { ...slots.composition.bindings };
  return { ...(slots.scenarios[0]?.bindings ?? {}) };
}

/** The own picks of the target as a call names them (datasets by name). */
export function namedPicks(
  slots: Pick<SlotsRead, 'composition' | 'scenarios' | 'datasets'>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ownPicks(slots)).map(([slot, id]) => [slot, datasetRef(slots.datasets, id)]),
  );
}

/** The call that pins `dataset` to `slot` and keeps the target's other picks. */
export function pinStep(
  base: StepBase,
  picks: Readonly<Record<string, string>>,
  slot: string,
  dataset: string,
): PlanStep {
  return { tool: 'data_set_bindings', args: { ...base, bindings: { ...picks, [slot]: dataset } } };
}

/** Whether a scenario the target runs reads the slot. */
export const readsSlot = (slots: Pick<SlotsRead, 'scenarios'>, slot: string): boolean =>
  slots.scenarios.some((scenario) => scenario.slots.some((item) => item.slot === slot));
