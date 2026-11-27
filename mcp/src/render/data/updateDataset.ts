// The view of `data_update_dataset` and of the lines of its consent card. The name, the description
// and the column names are texts a person or a model wrote: they arrive masked and made one line.
// The cells of the dataset and of the file are never shown, only the size, the hash and the count.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

/** The rows file of a call, as the card shows it (a hash, never a cell). */
export interface UpdateFileFacts {
  /** The path relative to the project directory. */
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly rows: number;
  /** At most 20 column names of the header, and how many there are. */
  readonly columns: readonly string[];
  readonly columnCount: number;
}

/** What the card froze: the dataset as it is and what the call would change. */
export interface UpdateDatasetFacts {
  readonly dataset_id: string;
  /** The name now. */
  readonly name: string;
  readonly to_name?: string;
  /** The new description; an empty text clears it. */
  readonly to_description?: string;
  readonly file?: UpdateFileFacts;
}

export type UpdatedPart = 'name' | 'description' | 'rows';

export interface UpdateDatasetData {
  readonly dataset_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly rows: number;
  readonly columns: readonly string[];
  readonly columnCount: number;
  /** What the call changed; empty when everything was as given. */
  readonly changed: readonly UpdatedPart[];
  /** The values before, for the changed name and description. */
  readonly previous: { readonly name?: string; readonly description?: string | null };
  /** The way back the log keeps: the definition (this tool), the rows (the restore), none. */
  readonly undo: 'definition' | 'rows' | 'withheld' | 'none';
}

export function cardViewUpdateDataset(facts: UpdateDatasetFacts, t: Translator): CardView {
  const lines: string[] = [];
  if (facts.to_name !== undefined) {
    lines.push(t('data_update_dataset.card.name', { from: facts.name, to: facts.to_name }));
  }
  if (facts.to_description !== undefined) {
    lines.push(
      facts.to_description === ''
        ? t('data_update_dataset.card.description_clear')
        : t('data_update_dataset.card.description', { to: facts.to_description }),
    );
  }
  const { file } = facts;
  if (file !== undefined) {
    lines.push(
      t('data_update_dataset.card.file', {
        file: file.path,
        rows: num(file.rows, t.locale),
        size: num(file.size, t.locale),
        sha: file.sha256.slice(0, 12),
        columns: file.columns.join(', ') + (file.columnCount > file.columns.length ? ', …' : ''),
      }),
    );
  }
  return {
    title: t('data_update_dataset.card.title', { name: facts.name }),
    lines,
    cost: t(
      file === undefined
        ? 'data_update_dataset.card.cost.none'
        : 'data_update_dataset.card.cost.upload',
      { size: num(file?.size ?? 0, t.locale) },
    ),
    undo: t(
      file === undefined
        ? 'data_update_dataset.card.undo.definition'
        : 'data_update_dataset.card.undo.rows',
    ),
  };
}

export function renderUpdateDataset(data: UpdateDatasetData, t: Translator): string {
  if (data.changed.length === 0) return t('data_update_dataset.unchanged', { name: data.name });
  const parts = data.changed.map((part) => t(`data_update_dataset.part.${part}`)).join(', ');
  const lines = [t('data_update_dataset.done', { name: data.name, parts })];
  if (data.previous.name !== undefined) {
    lines.push(t('data_update_dataset.was_name', { previous: data.previous.name }));
  }
  if (data.previous.description !== undefined) {
    lines.push(
      data.previous.description === null
        ? t('data_update_dataset.was_description_none')
        : t('data_update_dataset.was_description', { previous: data.previous.description }),
    );
  }
  if (data.changed.includes('rows')) {
    lines.push(
      t('data_update_dataset.rows_now', {
        rows: num(data.rows, t.locale),
        columns: num(data.columnCount, t.locale),
      }),
    );
  }
  lines.push(t(`data_update_dataset.undo.${data.undo}`));
  return lines.join('\n');
}
