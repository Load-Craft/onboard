// The view of `scenario_save_composition` and of the lines of its consent card. The names of the
// composition and of its scenarios and the load profile are texts a person or a model wrote: they
// arrive masked and made one line (the profile as a recorded body). A share is a percent.

import type { Translator } from '../../context.js';
import type { SlotCollision } from './slotCollisions.js';
import { collisionLines } from './slotCollisions.js';
import type { CardView } from '../consentCard.js';
import { decimal, num } from '../primitives.js';

/** One member in the card: its share now (null: not a member) and after the save (null: removed). */
export interface MemberFact {
  readonly scenario_id: string;
  readonly name: string;
  readonly was: number | null;
  readonly now: number | null;
}

/** A load profile as the card shows it: masked JSON, cut; `none` when the composition has none. */
export interface ProfileFact {
  readonly was: string | null;
  readonly now: string | null;
}

/** What the card froze: the composition as it is and what the call would do to it. */
export interface SaveCompositionFacts {
  /** Null for a new composition. */
  readonly composition_id: string | null;
  /** The name after the call (the `{name}` of the log entry). */
  readonly name: string;
  /** The name before, when the call renames; null otherwise. */
  readonly name_was: string | null;
  readonly create: boolean;
  /** At most 20 members, and how many there are; empty when the call leaves the members alone. */
  readonly members: readonly MemberFact[];
  readonly member_count: number;
  readonly profile: ProfileFact | null;
  /** Slots the members of the composition after the call declare differently. */
  readonly slot_collisions: readonly SlotCollision[];
}

export type SavedPart = 'name' | 'members' | 'profile';

export interface SaveCompositionData {
  readonly composition_id: string;
  /** The name after the call. */
  readonly name: string;
  readonly created: boolean;
  readonly changed: readonly SavedPart[];
  readonly members: number;
  /** The shares sum to this many percent, as the backend counts them. */
  readonly total_percent: number | null;
  /** The backend's verdict after the save; `unknown` when it could not be asked. */
  readonly valid: boolean | 'unknown';
  readonly authoring_valid: boolean | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  /** Slots the members declare differently (names only): one dataset cannot fit them. */
  readonly slot_collisions: readonly SlotCollision[];
  /** How the log entry can be undone: the previous values, the deletion of a new one, or not at all. */
  readonly undo: 'previous' | 'delete' | 'withheld' | 'none';
}

/** A share: whole, or with the decimals it has (two at most). */
const percent = (value: number, t: Translator): string =>
  Number.isInteger(value) ? num(value, t.locale) : decimal(value, 2, t.locale).replace(/0+$/u, '');

function memberLine(member: MemberFact, t: Translator): string {
  if (member.now === null) {
    return t('scenario_save_composition.card.member.removed', {
      name: member.name,
      was: percent(member.was ?? 0, t),
    });
  }
  if (member.was === null) {
    return t('scenario_save_composition.card.member.added', {
      name: member.name,
      now: percent(member.now, t),
    });
  }
  return member.was === member.now
    ? t('scenario_save_composition.card.member.same', {
        name: member.name,
        now: percent(member.now, t),
      })
    : t('scenario_save_composition.card.member.changed', {
        name: member.name,
        was: percent(member.was, t),
        now: percent(member.now, t),
      });
}

export function cardViewSaveComposition(facts: SaveCompositionFacts, t: Translator): CardView {
  const lines: string[] = [];
  if (facts.create) {
    lines.push(t('scenario_save_composition.card.create', { name: facts.name }));
  } else if (facts.name_was !== null) {
    lines.push(
      t('scenario_save_composition.card.rename', { was: facts.name_was, now: facts.name }),
    );
  }
  for (const member of facts.members) lines.push(memberLine(member, t));
  if (facts.member_count > facts.members.length) {
    lines.push(
      t('scenario_save_composition.card.more', {
        count: num(facts.member_count - facts.members.length, t.locale),
      }),
    );
  }
  if (facts.profile !== null) {
    lines.push(
      t('scenario_save_composition.card.profile', {
        was: facts.profile.was ?? t('scenario_save_composition.profile.none'),
        now: facts.profile.now ?? t('scenario_save_composition.profile.none'),
      }),
    );
  }
  lines.push(...collisionLines(facts.slot_collisions, t));
  return {
    title: t('scenario_save_composition.card.title', { name: facts.name }),
    lines,
    undo: t(
      facts.create
        ? 'scenario_save_composition.card.undo.create'
        : 'scenario_save_composition.card.undo.update',
    ),
  };
}

export function renderSaveComposition(data: SaveCompositionData, t: Translator): string {
  const lines = [
    t(
      data.created
        ? 'scenario_save_composition.done.created'
        : data.changed.length === 0
          ? 'scenario_save_composition.done.unchanged'
          : 'scenario_save_composition.done.updated',
      {
        name: data.name,
        members: num(data.members, t.locale),
        parts: data.changed.map((part) => t(`scenario_save_composition.part.${part}`)).join(', '),
      },
    ),
  ];
  if (!data.created && data.changed.length === 0) return lines.join('\n');
  if (data.total_percent !== null) {
    lines.push(t('scenario_save_composition.total', { total: percent(data.total_percent, t) }));
  }
  lines.push(
    data.valid === 'unknown'
      ? t('scenario_save_composition.valid.unknown')
      : t(
          data.valid ? 'scenario_save_composition.valid.yes' : 'scenario_save_composition.valid.no',
        ),
  );
  for (const message of data.errors) {
    lines.push(t('scenario_save_composition.error', { text: message }));
  }
  for (const message of data.warnings) {
    lines.push(t('scenario_save_composition.warning', { text: message }));
  }
  lines.push(...collisionLines(data.slot_collisions, t));
  if (data.undo !== 'none') lines.push(t(`scenario_save_composition.undo.${data.undo}`));
  return lines.join('\n');
}
