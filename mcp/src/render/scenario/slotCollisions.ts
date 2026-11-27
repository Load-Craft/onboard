// The sentence for a slot that members of a composition declare differently: its name, the members
// and what differs (columns, role, kind of identity), never a value. Shared by the card and the
// result of `scenario_save_composition` and by `scenario_check_composition`.

import type { Translator } from '../../context.js';

/** What differs between the members that declare the slot. */
export type SlotDifference = 'columns' | 'role' | 'identity';

export interface SlotCollision {
  /** The slot key the members share. */
  readonly slot: string;
  /** The members that declare it (names, masked; at most 5) and how many there are. */
  readonly members: readonly string[];
  readonly member_count: number;
  readonly differs: readonly SlotDifference[];
}

export function collisionLines(collisions: readonly SlotCollision[], t: Translator): string[] {
  return collisions.map((collision) =>
    t('scenario.slot_collision', {
      slot: collision.slot,
      members:
        collision.members.join(', ') +
        (collision.member_count > collision.members.length ? ', …' : ''),
      differs: collision.differs.map((kind) => t(`scenario.slot_collision.${kind}`)).join(', '),
    }),
  );
}
