// The dataset of a data slot: the name it gets, the file name it carries, and its pinning to every
// scenario of the target that reads the slot (and, for a composition, to the composition). The file
// name serves the accounts from a file (`data_create_dataset`); the name and the pin serve the
// accounts created through the register request (`data_create_accounts`).

import { saveCompositionSlotBindings, saveSlotBindings } from '../../api/data.js';
import type { ApiContext } from '../../api/context.js';
import type { PlanRead } from './readPlan.js';

export const fileNameOf = (slot: string): string =>
  `${slot.replace(/[^A-Za-z0-9_-]/gu, '_') || 'accounts'}.csv`;

/** What a pin needs to know about the target: its members' slots and picks, and the composition's own. */
type PinPlan = Pick<PlanRead, 'scenarios' | 'composition'>;

/**
 * Saves datasets as a slot's pick in every store a run of the target reads, keeping the picks made
 * so far. A scenario's run reads the scenario's own picks. A composition's run reads the
 * composition's own picks, but the self-check and the run button of each member scenario read the
 * member's, so for a composition the dataset is pinned in the composition AND in every member that
 * reads the slot and whose columns the dataset covers (a member with a column the dataset lacks
 * would get `column_mismatch`).
 */
export function slotPinner(api: ApiContext, projectId: string, plan: PinPlan) {
  const picks = new Map(plan.scenarios.map((scenario) => [scenario.id, { ...scenario.bindings }]));
  let own = plan.composition === null ? null : { ...plan.composition.bindings };
  return {
    reads: (slot: string): boolean =>
      plan.scenarios.some((scenario) => scenario.slots.some((item) => item.slot === slot)),
    /**
     * Pins `datasetId`, which has `columns`. Returns how many member scenarios of a composition
     * hold the pick afterwards; null when the target is a single scenario.
     */
    async pin(slot: string, datasetId: string, columns: readonly string[]): Promise<number | null> {
      if (plan.composition !== null && own !== null && own[slot] !== datasetId) {
        own = { ...own, [slot]: datasetId };
        await saveCompositionSlotBindings(api, projectId, plan.composition.id, own);
      }
      let held = 0;
      for (const scenario of plan.scenarios) {
        const spec = scenario.slots.find((item) => item.slot === slot);
        if (spec === undefined) continue;
        if (plan.composition !== null && !spec.columns.every((name) => columns.includes(name))) {
          continue;
        }
        const current = picks.get(scenario.id) ?? {};
        held += 1;
        if (current[slot] === datasetId) continue;
        const next = { ...current, [slot]: datasetId };
        await saveSlotBindings(api, projectId, scenario.id, next);
        picks.set(scenario.id, next);
      }
      return plan.composition === null ? null : held;
    },
  };
}

/**
 * Pins an accounts dataset to the slot (see `slotPinner`). The dataset carries the columns of the
 * slot as its first reader declares them. Returns the number of member scenarios that hold it for
 * a composition, null for a scenario.
 */
export async function pinSlot(
  api: ApiContext,
  projectId: string,
  plan: PinPlan,
  slot: string,
  datasetId: string,
): Promise<number | null> {
  const columns =
    plan.scenarios.flatMap((scenario) => scenario.slots).find((item) => item.slot === slot)
      ?.columns ?? [];
  return slotPinner(api, projectId, plan).pin(slot, datasetId, columns);
}

/** The name a slot's accounts dataset gets: the plan's proposal, else the slot's label. */
export function datasetNameFor(plan: PlanRead, slotName: string): string {
  const slot = plan.view.slots.find((item) => item.slot === slotName);
  const proposed = plan.view.proposed.find((item) => item.slot === slotName && item.name !== null);
  return proposed?.name ?? slot?.label ?? slotName;
}
