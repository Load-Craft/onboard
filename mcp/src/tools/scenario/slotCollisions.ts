// Members of a composition that declare a data slot of the same name differently: another set of
// columns, another role, or another kind of identity (a sign-up creating new accounts against a
// login using existing ones). The run feeds one dataset to a slot key, so one dataset cannot fit
// both: the preflight counts rows for the wrong shape and the backend says the slot "self-generates
// 0". The comparison is of what each member DECLARES (its scenario's `feeder_slots`): names of slots,
// of members and of the kinds of difference, never a value. A member whose scenario cannot be read is
// left out (no guess); fewer than two readable members have no collision.

import type { SlotCollision, SlotDifference } from '../../render/scenario/slotCollisions.js';
import { LIMITS, settleAll, thirdParty, type CallContext } from '../kit/transitional.js';
import { getScenario } from './get.js';

const NAME_LIMIT = 100;
const MEMBERS_SHOWN = 5;
const SLOTS_SHOWN = 20;

interface Declared {
  readonly member: string;
  readonly columns: string;
  readonly role: string;
  readonly identity: string | null;
}

/** The collisions among `members`, in the order the slots first appear; empty when there are none. */
export async function slotCollisions(
  ctx: CallContext,
  projectId: string,
  members: readonly { readonly id: string; readonly name: string }[],
): Promise<SlotCollision[]> {
  if (members.length < 2) return [];
  const read = await settleAll(
    members.map(async (member) => {
      try {
        const scenario = await getScenario(ctx, { project_id: projectId, scenario_id: member.id });
        return { name: member.name, slots: scenario.feeder_slots };
      } catch {
        return null;
      }
    }),
  );
  const bySlot = new Map<string, Declared[]>();
  for (const one of read) {
    if (one === null) continue;
    for (const slot of one.slots) {
      if (slot.slot === undefined || slot.slot === '') continue;
      const list = bySlot.get(slot.slot) ?? [];
      list.push({
        member: one.name,
        columns: JSON.stringify([...(slot.columns ?? [])].sort()),
        role: slot.role ?? 'data',
        identity: slot.identity_kind ?? null,
      });
      bySlot.set(slot.slot, list);
    }
  }
  const found: SlotCollision[] = [];
  for (const [slot, declared] of bySlot) {
    if (new Set(declared.map((one) => one.member)).size < 2) continue;
    const differs: SlotDifference[] = [];
    if (new Set(declared.map((one) => one.columns)).size > 1) differs.push('columns');
    if (new Set(declared.map((one) => one.role)).size > 1) differs.push('role');
    const identities = new Set(declared.map((one) => one.identity).filter((kind) => kind !== null));
    if (identities.size > 1) differs.push('identity');
    if (differs.length === 0) continue;
    const names = [...new Set(declared.map((one) => one.member))];
    found.push({
      slot: thirdParty(ctx, slot, LIMITS.name),
      members: names.slice(0, MEMBERS_SHOWN).map((name) => thirdParty(ctx, name, NAME_LIMIT)),
      member_count: names.length,
      differs,
    });
  }
  return found.slice(0, SLOTS_SHOWN);
}
