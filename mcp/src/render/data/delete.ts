// The view of `data_delete` and of the lines of its consent card: the dataset that goes, how many
// rows it holds, who reads it, and what stays. The name and the names of the scenarios and
// compositions are texts a person or the generator wrote: they arrive masked and made one line. The
// rows of the dataset are never read.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

/** What the card froze. `names` is also the slot of the log entry. */
export interface DataDeleteFacts {
  readonly names: string;
  readonly id: string;
  /** The rows the dataset holds, as the backend counts them. */
  readonly rows: number;
  /** `force` of the call: the dataset goes although scenarios or compositions read it. */
  readonly force: boolean;
  /** Who reads it: names, at most 20, and how many (null: the list could not be read). */
  readonly users: readonly string[] | null;
  readonly users_count?: number;
}

export interface DataDeleteData {
  readonly id: string;
  readonly names: string;
  readonly count: number;
  readonly forced: boolean;
}

const list = (names: readonly string[], total: number): string =>
  names.join(', ') + (total > names.length ? ', …' : '');

export function cardViewDataDelete(facts: DataDeleteFacts, t: Translator): CardView {
  const lines: string[] = [
    t.plural('data_delete.card.item', facts.rows, {
      id: facts.id,
      rows: num(facts.rows, t.locale),
    }),
  ];
  const { users } = facts;
  if (users === null) {
    lines.push(t('data_delete.card.users_unknown'));
  } else if (users.length === 0) {
    lines.push(t('data_delete.card.users_none'));
  } else {
    lines.push(
      t.plural('data_delete.card.users', facts.users_count ?? users.length, {
        names: list(users, facts.users_count ?? users.length),
      }),
    );
  }
  if (facts.force) lines.push(t('data_delete.card.forced'));
  lines.push(t('data_delete.card.stays'));
  return {
    title: t('data_delete.card.title', { name: facts.names }),
    lines,
    undo: t('data_delete.card.undo'),
  };
}

export function renderDataDelete(data: DataDeleteData, t: Translator): string {
  return [
    t('data_delete.done', { name: data.names, count: num(data.count, t.locale) }),
    t('data_delete.stays'),
  ].join('\n');
}
