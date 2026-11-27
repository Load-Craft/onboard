// The view of `data_regenerate_dataset` and of the lines of its consent card. The dataset name and
// the recipe's column and generator names are texts a person or a model wrote: they arrive masked
// and made one line. The cells of the dataset are never read.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

export type RegenerateMode = 'expand' | 'reroll';

/** What the card froze: the dataset as it is and what the call would do to it. */
export interface RegenerateDatasetFacts {
  readonly dataset_id: string;
  readonly name: string;
  readonly mode: RegenerateMode;
  /** Rows now, and rows after the call. */
  readonly rows_now: number;
  readonly rows_after: number;
  /** `column: generator`, at most 20, and how many columns the recipe has. */
  readonly recipe: readonly string[];
  readonly recipe_count: number;
}

export interface RegenerateDatasetData {
  readonly dataset_id: string;
  readonly name: string;
  readonly mode: RegenerateMode;
  /** Rows before and after, as the backend counts them. */
  readonly rows_before: number;
  readonly rows: number;
  readonly columns: readonly string[];
  readonly columnCount: number;
}

export function cardViewRegenerateDataset(facts: RegenerateDatasetFacts, t: Translator): CardView {
  const shown = facts.recipe.join('; ') + (facts.recipe_count > facts.recipe.length ? '; …' : '');
  return {
    title: t('data_regenerate_dataset.card.title', { name: facts.name }),
    lines: [
      t(`data_regenerate_dataset.card.mode.${facts.mode}`, {
        now: num(facts.rows_now, t.locale),
        after: num(facts.rows_after, t.locale),
      }),
      t('data_regenerate_dataset.card.recipe', { recipe: shown }),
    ],
    cost: t('data_regenerate_dataset.card.cost', { rows: num(facts.rows_after, t.locale) }),
    undo: t('data_regenerate_dataset.card.undo'),
  };
}

export function renderRegenerateDataset(data: RegenerateDatasetData, t: Translator): string {
  return [
    t(`data_regenerate_dataset.done.${data.mode}`, {
      name: data.name,
      before: num(data.rows_before, t.locale),
      rows: num(data.rows, t.locale),
      columns: num(data.columnCount, t.locale),
    }),
    t('data_regenerate_dataset.undo'),
  ].join('\n');
}
