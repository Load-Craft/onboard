// The view of `data_get_dataset`: the dataset's metadata and columns, then the parts asked for. No
// cell of a secret column is ever in the data, and the content of the dataset is not copied; the
// texts arrive made one line and masked by the tool (`content` of tools/moduleCall.ts).

import type { Translator } from '../../context.js';
import { semanticsText, type ColumnSemantics } from './semantics.js';

export interface DatasetColumnView {
  readonly name: string;
  readonly semantics: ColumnSemantics | null;
}

export interface DatasetView {
  readonly id: string;
  readonly name: string;
  readonly file_name: string;
  readonly type: string;
  readonly strategy: string;
  readonly consumption: 'shared' | 'exclusive';
  readonly row_count: number;
  readonly columns: readonly DatasetColumnView[];
  readonly columns_total: number;
  /** How each column is generated; empty for an uploaded dataset. */
  readonly recipe: readonly { readonly column: string; readonly generator: string }[];
  readonly has_recipe: boolean;
  readonly provenance: 'uploaded' | 'auto' | 'auto-edited';
  readonly scenario_id: string | null;
  readonly manually_edited: boolean;
  readonly description: string | null;
  readonly created_at: string | null;
  readonly updated_at: string | null;
}

export interface PreviewView {
  readonly offset: number;
  readonly total_rows: number;
  readonly has_more: boolean;
  /** The columns shown: the secret ones are not among them. */
  readonly columns: readonly string[];
  readonly hidden_columns: readonly string[];
  /** The rows of the shown columns, in their order (named `cells`: `rows` is the log's row count). */
  readonly cells: readonly (readonly string[])[];
}

export interface ConsumerView {
  readonly kind: 'scenario' | 'composition';
  readonly id: string;
  readonly name: string;
  readonly usage: 'all' | 'steps' | 'split';
  readonly rows_note: string;
  readonly slots: readonly string[];
}

export interface RevisionView {
  readonly change_type: string;
  readonly created_at: string;
  readonly created_by: string | null;
}

export interface HistoryView {
  readonly provenance: string;
  readonly created_by: string | null;
  readonly revisions_total: number;
  readonly revisions: readonly RevisionView[];
}

export interface RedisView {
  readonly ok: boolean;
  readonly remaining: number | null;
  readonly latency_ms: number | null;
  readonly detail: string;
}

export interface Unavailable {
  readonly unavailable: true;
}

export type Part<T> = T | Unavailable | null;

export type IncludePart = 'rows' | 'consumers' | 'history' | 'snippet' | 'redis';

export interface DatasetData {
  readonly project_id: string;
  readonly dataset: DatasetView;
  /** The parts the call asked for. */
  readonly included: readonly IncludePart[];
  readonly preview: Part<PreviewView>;
  readonly consumers: Part<readonly ConsumerView[]>;
  readonly history: Part<HistoryView>;
  /** Lines of the feed snippet. */
  readonly snippet: Part<readonly string[]>;
  readonly redis: Part<RedisView>;
}

export const isUnavailable = (part: unknown): part is Unavailable =>
  typeof part === 'object' && part !== null && 'unavailable' in part;

function columnText(column: DatasetColumnView, t: Translator): string {
  return column.semantics === 'secret' || column.semantics === 'identity'
    ? `${column.name} (${semanticsText(column.semantics, t)})`
    : column.name;
}

function originText(dataset: DatasetView, t: Translator): string {
  if (dataset.provenance === 'uploaded') return t('data_get_dataset.uploaded');
  const edited = dataset.provenance === 'auto-edited' ? t('data_get_dataset.edited') : '';
  return dataset.scenario_id === null
    ? t('data_get_dataset.generated', { edited })
    : t('data_get_dataset.generated_for', { scenario: dataset.scenario_id, edited });
}

const dayOf = (at: string): string => /^\d{4}-\d{2}-\d{2}/u.exec(at)?.[0] ?? at;

function datasetLines(dataset: DatasetView, t: Translator): string[] {
  const hidden = dataset.columns_total - dataset.columns.length;
  const columns =
    dataset.columns.map((column) => columnText(column, t)).join(', ') +
    (hidden > 0 ? `, ${t('data_get_dataset.more_columns', { count: hidden })}` : '');
  const lines = [
    t('data_get_dataset.header', {
      name: dataset.name,
      id: dataset.id,
      type: dataset.type,
      rows: t.plural('data_get_dataset.rows', dataset.row_count),
      consumption: t(`data.consumption.${dataset.consumption}`),
      strategy: dataset.strategy,
      origin: originText(dataset, t),
    }),
    t('data_get_dataset.columns', { columns }),
  ];
  if (dataset.recipe.length > 0) {
    lines.push(
      t('data_get_dataset.recipe', {
        recipe: dataset.recipe.map((item) => `${item.column}: ${item.generator}`).join('; '),
      }),
    );
  }
  if (dataset.description !== null) {
    lines.push(t('data_get_dataset.description', { text: dataset.description }));
  }
  return lines;
}

function previewLines(preview: Part<PreviewView>, t: Translator): string[] {
  if (preview === null) return [];
  if (isUnavailable(preview)) return [t('data_get_dataset.rows_unavailable')];
  if (preview.cells.length === 0) {
    return [t('data_get_dataset.rows_none', { total: preview.total_rows })];
  }
  const hidden =
    preview.hidden_columns.length === 0
      ? ''
      : ` ${t('data_get_dataset.hidden', { columns: preview.hidden_columns.join(', ') })}`;
  const lines = [
    `${t('data_get_dataset.rows_range', {
      from: preview.offset + 1,
      to: preview.offset + preview.cells.length,
      total: preview.total_rows,
    })}${hidden}:`,
  ];
  preview.cells.forEach((cells, index) => {
    const text = preview.columns.map((column, at) => `${column}=${cells[at] ?? ''}`).join(' | ');
    lines.push(`${String(preview.offset + index + 1)}. ${text}`);
  });
  return lines;
}

function consumersLine(consumers: Part<readonly ConsumerView[]>, t: Translator): string[] {
  if (consumers === null) return [];
  if (isUnavailable(consumers)) return [t('data_get_dataset.consumers_unavailable')];
  if (consumers.length === 0) return [t('data_get_dataset.consumers_none')];
  const items = consumers.map((item) => `${item.kind} ${item.name} (${item.rows_note})`);
  return [t('data_get_dataset.consumers', { count: consumers.length, items: items.join('; ') })];
}

function historyLine(history: Part<HistoryView>, t: Translator): string[] {
  if (history === null) return [];
  if (isUnavailable(history)) return [t('data_get_dataset.history_unavailable')];
  if (history.revisions.length === 0) return [t('data_get_dataset.history_none')];
  const items = history.revisions.map(
    (item) =>
      `${item.change_type} ${dayOf(item.created_at)}${
        item.created_by === null ? '' : ` ${t('data_get_dataset.by', { who: item.created_by })}`
      }`,
  );
  return [
    t('data_get_dataset.history', { count: history.revisions_total, items: items.join('; ') }),
  ];
}

function snippetLines(snippet: Part<readonly string[]>, t: Translator): string[] {
  if (snippet === null) return [];
  if (isUnavailable(snippet)) return [t('data_get_dataset.snippet_unavailable')];
  return [t('data_get_dataset.snippet'), ...snippet.map((line) => `  ${line}`)];
}

function redisLine(redis: Part<RedisView>, t: Translator): string[] {
  if (redis === null) return [];
  if (isUnavailable(redis)) return [t('data_get_dataset.redis_unavailable')];
  return [
    redis.ok && redis.remaining !== null
      ? t('data_get_dataset.redis_ok', { remaining: redis.remaining })
      : t('data_get_dataset.redis_error', { detail: redis.detail }),
  ];
}

export function renderDataset(data: DatasetData, t: Translator): string {
  return [
    ...datasetLines(data.dataset, t),
    ...previewLines(data.preview, t),
    ...consumersLine(data.consumers, t),
    ...historyLine(data.history, t),
    ...redisLine(data.redis, t),
    ...snippetLines(data.snippet, t),
  ].join('\n');
}
