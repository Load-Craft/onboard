// The view of `traffic_list_snapshots`: one entry per snapshot of production traffic, newest first,
// with the window it covers, how it arrived, what it counts per bucket and its quality in counts;
// optionally the packet format by example (field names and types, CSV columns, never a value).

import type { Translator } from '../../context.js';
import { num } from '../primitives.js';
import { minute, span } from './time.js';

export interface SnapshotItem {
  readonly id: string;
  readonly created_at: string;
  readonly channel: 'push' | 'file';
  /** The label of the push token that sent it; null for a file. */
  readonly token_label: string | null;
  readonly window_start: string;
  readonly window_end: string;
  readonly bucket_seconds: number;
  readonly unit: 'requests' | 'sessions';
  readonly timezone: string;
  readonly routes: number;
  readonly rows: number;
  readonly total_count: number;
  readonly source_kind: string;
  readonly quality: {
    readonly buckets: number;
    readonly gaps: number;
    readonly partials: number;
    readonly resets: number;
    readonly unusable: number;
    /** Whether the packet held a session profile. */
    readonly session_profile: boolean;
  };
}

export interface FormatSample {
  readonly schema_title: string | null;
  readonly fields: readonly { readonly path: string; readonly type: string }[];
  readonly csv_columns: readonly string[];
}

export interface SnapshotsData {
  readonly project_id: string;
  /** Every snapshot the project holds (the log slot `{count}`). */
  readonly count: number;
  readonly shown: number;
  readonly snapshots: readonly SnapshotItem[];
  readonly limits: { readonly snapshots_kept_per_sender: number; readonly max_window_days: number };
  readonly format_state: 'none' | 'read' | 'unavailable';
  readonly format_sample: FormatSample | null;
}

/** `1 h`, `5 min`, `30 s`: a bucket in the largest whole unit. */
export function bucketText(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) return `${String(seconds / 3600)} h`;
  if (seconds >= 60 && seconds % 60 === 0) return `${String(seconds / 60)} min`;
  return `${String(seconds)} s`;
}

function arrival(item: SnapshotItem, t: Translator): string {
  if (item.channel === 'file') return t('traffic_list_snapshots.file');
  return item.token_label === null
    ? t('traffic_list_snapshots.pushed')
    : t('traffic_list_snapshots.pushed_by', { label: item.token_label });
}

function qualityText(item: SnapshotItem, t: Translator): string {
  const { quality } = item;
  const parts = [
    t.plural('traffic_list_snapshots.buckets', quality.buckets, {
      count: num(quality.buckets, t.locale),
    }),
    t.plural('traffic_list_snapshots.gaps', quality.gaps, { count: num(quality.gaps, t.locale) }),
  ];
  if (quality.partials > 0) {
    parts.push(t('traffic_list_snapshots.partials', { count: num(quality.partials, t.locale) }));
  }
  if (quality.resets > 0) {
    parts.push(t('traffic_list_snapshots.resets', { count: num(quality.resets, t.locale) }));
  }
  parts.push(t('traffic_list_snapshots.unusable', { count: num(quality.unusable, t.locale) }));
  if (quality.session_profile) parts.push(t('traffic_list_snapshots.session_profile'));
  return parts.join(', ');
}

function itemLines(item: SnapshotItem, index: number, t: Translator): string[] {
  const window =
    item.window_end === '' ? minute(item.window_start) : span(item.window_start, item.window_end);
  return [
    `${String(index + 1)}. ${window}, ${arrival(item, t)}: ${t('traffic_list_snapshots.counts', {
      unit: t(`traffic_list_snapshots.unit.${item.unit}`),
      bucket: bucketText(item.bucket_seconds),
      routes: num(item.routes, t.locale),
      rows: num(item.rows, t.locale),
      total: num(item.total_count, t.locale),
    })}`,
    `   ${t('traffic_list_snapshots.id_quality', { id: item.id, quality: qualityText(item, t) })}`,
  ];
}

function formatLines(data: SnapshotsData, t: Translator): string[] {
  if (data.format_state === 'unavailable') return [t('traffic_list_snapshots.format_unavailable')];
  const sample = data.format_sample;
  if (data.format_state !== 'read' || sample === null) return [];
  const lines = [
    sample.schema_title === null
      ? t('traffic_list_snapshots.format')
      : t('traffic_list_snapshots.format_named', { title: sample.schema_title }),
  ];
  if (sample.fields.length > 0) {
    lines.push(
      `  ${t('traffic_list_snapshots.fields', {
        fields: sample.fields.map((field) => `${field.path} (${field.type})`).join(', '),
      })}`,
    );
  }
  if (sample.csv_columns.length > 0) {
    lines.push(`  ${t('traffic_list_snapshots.csv', { columns: sample.csv_columns.join(', ') })}`);
  }
  return lines;
}

export function renderListSnapshots(data: SnapshotsData, t: Translator): string {
  if (data.count === 0) {
    return [t('traffic_list_snapshots.empty'), ...formatLines(data, t)].join('\n');
  }
  const lines = [t('traffic_list_snapshots.header', { count: num(data.count, t.locale) })];
  data.snapshots.forEach((item, index) => lines.push(...itemLines(item, index, t)));
  if (data.shown < data.count) {
    lines.push(t('traffic_list_snapshots.more', { shown: data.shown, total: data.count }));
  }
  lines.push(
    t('traffic_list_snapshots.limits', {
      kept: num(data.limits.snapshots_kept_per_sender, t.locale),
      days: num(data.limits.max_window_days, t.locale),
    }),
  );
  lines.push(...formatLines(data, t));
  return lines.join('\n');
}
