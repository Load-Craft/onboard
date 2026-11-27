// `data_set_bindings`: the slot-to-dataset picks of a scenario or a composition, the whole map at
// once (a slot left out loses its pick; `{}` clears them all). Datasets are named by name or id.
//
// A scenario's run reads the scenario's own picks. A composition's run reads the composition's own
// picks, but the self-check and the run button of each member scenario read the member's, so for a
// composition every slot of the map is pinned in each member that reads it and whose columns the
// dataset covers (a member with a column the dataset lacks would get `column_mismatch`); the other
// picks of a member are kept.

import { saveCompositionSlotBindings, saveSlotBindings, type Dataset } from '../../api/data.js';
import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import type { BoundSlot } from '../../render/views/data.js';
import type { RunTarget } from '../../resolve/handles.js';
import { content } from '../moduleCall.js';
import { readTarget, type TargetRead } from './readPlan.js';
import { datasetRef, ownPicks } from './steps.js';

/** How many names an error lists. */
const LISTED = 10;
const NAME_LIMIT = 120;

const sameMap = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([key, value]) => b[key] === value);

/** The dataset a call names: its id, or a name no other dataset of the project has. */
function datasetOf(ctx: ToolContext, datasets: readonly Dataset[], wanted: string): Dataset {
  const name = wanted.trim();
  const byId = datasets.find((item) => item.id === name);
  if (byId !== undefined) return byId;
  const byName = datasets.filter((item) => item.name === name);
  if (byName.length === 1 && byName[0] !== undefined) return byName[0];
  throw new ToolError(byName.length > 1 ? 'dataset_ambiguous' : 'dataset_unknown', {
    params: {
      // what the model typed and the names from the backend are shown masked (FIX-74)
      dataset: content(ctx, name, NAME_LIMIT),
      available: datasets
        .slice(0, LISTED)
        .map((item) => content(ctx, item.name, NAME_LIMIT))
        .join(', '),
    },
  });
}

export interface BindingsResult {
  readonly bound: BoundSlot[];
  /** Slots that had a pick and are left out of the map. */
  readonly cleared: string[];
  /** The map is the one the target had: nothing was sent. */
  readonly unchanged: boolean;
  /** The target's own picks before the call, as a call names them: the undo. */
  readonly previous: Record<string, string>;
}

export async function setBindings(
  ctx: ToolContext,
  projectId: string,
  target: RunTarget,
  wanted: Readonly<Record<string, string>>,
): Promise<BindingsResult> {
  const read = await readTarget(ctx, projectId, target);
  const slotKeys = [...new Set(read.scenarios.flatMap((s) => s.slots.map((slot) => slot.slot)))];
  const next: Record<string, string> = {};
  const picked = new Map<string, Dataset>();
  for (const [slot, name] of Object.entries(wanted)) {
    if (!slotKeys.includes(slot)) {
      throw new ToolError('slot_unknown', { params: { slot, available: slotKeys.join(', ') } });
    }
    const dataset = datasetOf(ctx, read.datasets, name);
    next[slot] = dataset.id;
    picked.set(slot, dataset);
  }
  const current = ownPicks(read);
  const previous = Object.fromEntries(
    Object.entries(current).map(([slot, id]) => [slot, datasetRef(read.datasets, id)]),
  );
  const cleared = Object.keys(current).filter((slot) => !(slot in next));
  const ownChanged = !sameMap(current, next);

  if (read.composition === null) {
    if (ownChanged) await saveSlotBindings(ctx, projectId, target.id, next);
    return {
      bound: [...picked].map(([slot, dataset]) => ({ slot, dataset: dataset.name })),
      cleared,
      unchanged: !ownChanged,
      previous,
    };
  }
  if (ownChanged) await saveCompositionSlotBindings(ctx, projectId, read.composition.id, next);
  const members = await pinMembers(ctx, projectId, read, picked);
  return {
    bound: [...picked].map(([slot, dataset]) => ({
      slot,
      dataset: dataset.name,
      scenarios: members.get(slot) ?? 0,
    })),
    cleared,
    unchanged: !ownChanged && members.sent === 0,
    previous,
  };
}

/**
 * Pins each slot of the map in the members of the composition that read it and whose columns the
 * dataset covers, a slot at a time, keeping the members' other picks. Returns, per slot, how many
 * members hold the pick afterwards, and how many saves were sent.
 */
async function pinMembers(
  ctx: ToolContext,
  projectId: string,
  read: TargetRead,
  picked: ReadonlyMap<string, Dataset>,
): Promise<Map<string, number> & { sent: number }> {
  const picks = new Map(read.scenarios.map((scenario) => [scenario.id, { ...scenario.bindings }]));
  const held = Object.assign(new Map<string, number>(), { sent: 0 });
  for (const [slot, dataset] of picked) {
    let count = 0;
    for (const scenario of read.scenarios) {
      const spec = scenario.slots.find((item) => item.slot === slot);
      if (spec === undefined || !spec.columns.every((name) => dataset.columns.includes(name))) {
        continue;
      }
      count += 1;
      const now = picks.get(scenario.id) ?? {};
      if (now[slot] === dataset.id) continue;
      const updated = { ...now, [slot]: dataset.id };
      await saveSlotBindings(ctx, projectId, scenario.id, updated);
      picks.set(scenario.id, updated);
      held.sent += 1;
    }
    held.set(slot, count);
  }
  return held;
}
