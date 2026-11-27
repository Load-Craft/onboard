// The view of `data_list_datasets`: two lines per dataset, the name with its id, then the type, the
// rows, how it is consumed, where it came from and its columns. Only the metadata of a dataset is
// read, never a cell: a column of credentials is named and marked, so no value can be shown. The names
// arrive made one line and masked by the tool (`content` of tools/moduleCall.ts).

import type { Translator } from '../../context.js';
import { semanticsText, type ColumnSemantics } from './semantics.js';

export interface DatasetColumn {
  readonly name: string;
  /** What the backend says the column holds; null when it does not say. */
  readonly semantics: ColumnSemantics | null;
}

export interface DatasetItem {
  readonly id: string;
  readonly name: string;
  readonly file_name: string;
  readonly type: string;
  readonly strategy: string;
  readonly consumption: 'shared' | 'exclusive';
  readonly rows: number;
  readonly columns: readonly DatasetColumn[];
  readonly columns_total: number;
  readonly has_recipe: boolean;
  readonly provenance: 'uploaded' | 'auto' | 'auto-edited';
  /** The scenario a generated dataset was made for. */
  readonly scenario_id: string | null;
  readonly manually_edited: boolean;
  readonly updated_at: string | null;
}

export interface DatasetListData {
  readonly project_id: string;
  /** How many datasets the project has. */
  readonly count: number;
  /** How many of them the data carries. */
  readonly shown: number;
  readonly datasets: readonly DatasetItem[];
}

function columnText(column: DatasetColumn, t: Translator): string {
  return column.semantics === 'secret' || column.semantics === 'identity'
    ? `${column.name} (${semanticsText(column.semantics, t)})`
    : column.name;
}

function originText(item: DatasetItem, t: Translator): string {
  if (item.provenance === 'uploaded') return t('data_list_datasets.uploaded');
  const edited = item.provenance === 'auto-edited' ? t('data_list_datasets.edited') : '';
  return item.scenario_id === null
    ? t('data_list_datasets.generated', { edited })
    : t('data_list_datasets.generated_for', { scenario: item.scenario_id, edited });
}

function columnsText(item: DatasetItem, t: Translator): string {
  const shown = item.columns.map((column) => columnText(column, t)).join(', ');
  const hidden = item.columns_total - item.columns.length;
  return hidden > 0
    ? `${shown}, ${t('data_list_datasets.more_columns', { count: hidden })}`
    : shown;
}

export function renderListDatasets(data: DatasetListData, t: Translator): string {
  if (data.count === 0) return t('data_list_datasets.empty');
  const lines = [t.plural('data_list_datasets.header', data.count)];
  data.datasets.forEach((item, index) => {
    lines.push(`${String(index + 1)}. "${item.name}" [${item.id}]`);
    const facts = t('data_list_datasets.facts', {
      type: item.type,
      rows: t.plural('data_list_datasets.rows', item.rows),
      consumption: t(`data.consumption.${item.consumption}`),
      strategy: item.strategy,
      origin: originText(item, t),
      columns: columnsText(item, t),
    });
    lines.push(`   ${facts}`);
  });
  if (data.shown < data.count) {
    lines.push(t('data_list_datasets.more', { shown: data.shown, total: data.count }));
  }
  return lines.join('\n');
}
