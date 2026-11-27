// The view of `data_restore_dataset`: the dataset whose previous content is back, with its size now.
// The name and the column names are texts a person or a model wrote: they arrive masked and made one
// line. The cells of the dataset are never read.

import type { Translator } from '../../context.js';
import { num } from '../primitives.js';

export interface RestoreDatasetData {
  readonly dataset_id: string;
  readonly name: string;
  /** Rows after the restore, as the backend counts them. */
  readonly rows: number;
  /** The columns after the restore (at most 20 names) and how many there are. */
  readonly columns: readonly string[];
  readonly columnCount: number;
  readonly manuallyEdited: boolean;
}

export function renderRestoreDataset(data: RestoreDatasetData, t: Translator): string {
  return [
    t('data_restore_dataset.done', {
      name: data.name,
      rows: num(data.rows, t.locale),
      columns: num(data.columnCount, t.locale),
    }),
    t('data_restore_dataset.undo'),
  ].join('\n');
}
