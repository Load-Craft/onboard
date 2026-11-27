// The view of `scenario_delete` and of the lines of its consent card: exactly what disappears with
// the scenario or the composition, and what stays. The names are texts a person or the generator
// wrote: they arrive masked and made one line.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

export type DeleteKind = 'scenario' | 'composition';

/** What the card froze. `names` and `kind` are also the slots of the log entry. */
export interface ScenarioDeleteFacts {
  readonly kind: DeleteKind;
  readonly names: string;
  readonly id: string;
  /** A scenario: its saved versions (null when the list could not be read). */
  readonly versions?: number | null;
  /** A scenario: the compositions it leaves (null: unknown). Names, at most 20, and how many. */
  readonly compositions?: readonly string[] | null;
  readonly compositions_count?: number;
  /** A composition: its member scenarios (they stay): names, at most 20, and how many. */
  readonly members?: readonly string[];
  readonly members_count?: number;
}

export interface ScenarioDeleteData {
  readonly kind: DeleteKind;
  readonly id: string;
  readonly names: string;
  readonly count: number;
}

const list = (names: readonly string[], total: number): string =>
  names.join(', ') + (total > names.length ? ', …' : '');

export function cardViewScenarioDelete(facts: ScenarioDeleteFacts, t: Translator): CardView {
  const lines: string[] = [t(`scenario_delete.card.item.${facts.kind}`, { id: facts.id })];
  if (facts.kind === 'scenario') {
    lines.push(
      facts.versions === null || facts.versions === undefined
        ? t('scenario_delete.card.versions_unknown')
        : t.plural('scenario_delete.card.versions', facts.versions),
    );
    const { compositions } = facts;
    if (compositions === null || compositions === undefined) {
      lines.push(t('scenario_delete.card.compositions_unknown'));
    } else if (compositions.length === 0) {
      lines.push(t('scenario_delete.card.compositions_none'));
    } else {
      lines.push(
        t.plural(
          'scenario_delete.card.compositions',
          facts.compositions_count ?? compositions.length,
          {
            names: list(compositions, facts.compositions_count ?? compositions.length),
          },
        ),
      );
    }
  } else {
    const members = facts.members ?? [];
    lines.push(
      members.length === 0
        ? t('scenario_delete.card.members_none')
        : t.plural('scenario_delete.card.members', facts.members_count ?? members.length, {
            names: list(members, facts.members_count ?? members.length),
          }),
    );
  }
  lines.push(t(`scenario_delete.card.stays.${facts.kind}`));
  return {
    title: t(`scenario_delete.card.title.${facts.kind}`, { name: facts.names }),
    lines,
    undo: t('scenario_delete.card.undo'),
  };
}

export function renderScenarioDelete(data: ScenarioDeleteData, t: Translator): string {
  return [
    t(`scenario_delete.done.${data.kind}`, { name: data.names, count: num(data.count, t.locale) }),
    t(`scenario_delete.stays.${data.kind}`),
  ].join('\n');
}
