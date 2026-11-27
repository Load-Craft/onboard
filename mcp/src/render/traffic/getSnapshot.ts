// The view of `traffic_get_snapshot`: one snapshot of production traffic, what it counts, where its
// counts came from, its quality (gaps, unusable intervals, the sender's excluded windows, a session
// profile in counts) and its series per route, summarized or with the first values of each.

import type { Translator } from '../../context.js';
import { num } from '../primitives.js';
import { bucketText } from './listSnapshots.js';
import { span } from './time.js';

export interface Interval {
  readonly start: string;
  readonly end: string;
}

export interface RouteValue {
  readonly at: string;
  /** Null for a gap. */
  readonly count: number | null;
  readonly quality: string;
}

export interface RouteSeries {
  /** Null: the series of no route. */
  readonly route: string | null;
  readonly points: number;
  readonly min: number | null;
  readonly max: number | null;
  readonly sum: number;
  readonly gap_points: number;
  /** In points mode only: the values, at most 60. */
  readonly values?: readonly RouteValue[];
}

export interface SnapshotData {
  readonly snapshot_id: string;
  /** The window as text (the log slot `{name}`). */
  readonly name: string;
  /** The log slot `{quality}`. */
  readonly quality: 'complete' | 'gaps' | 'unusable';
  readonly created_at: string;
  readonly channel: 'push' | 'file';
  readonly token_label: string | null;
  readonly window_start: string;
  readonly window_end: string;
  readonly bucket_seconds: number;
  readonly unit: 'requests' | 'sessions';
  readonly timezone: string;
  readonly entry_route: string | null;
  readonly source: { readonly kind: string; readonly query: string | null };
  readonly counts: {
    readonly buckets: number;
    readonly gaps: number;
    readonly partials: number;
    readonly resets: number;
    readonly unusable: number;
    readonly rows: number;
    readonly routes: number;
    readonly total_count: number;
  };
  readonly gaps: { readonly count: number; readonly items: readonly Interval[] };
  readonly unusable: { readonly count: number; readonly items: readonly Interval[] };
  readonly excluded_windows: {
    readonly count: number;
    readonly items: readonly (Interval & { readonly reason: string })[];
  };
  readonly session_profile: {
    readonly navigation_signal: string;
    readonly route_keys: number;
    readonly transition_cells: number;
    readonly next_cells: number;
    readonly suppressed_transition_cells: number;
    readonly suppressed_next_cells: number;
  } | null;
  readonly series_mode: 'summary' | 'points';
  readonly routes: { readonly count: number; readonly items: readonly RouteSeries[] };
}

/** Values of a route the text shows in points mode; the data holds up to 60. */
const VALUES_SHOWN = 12;

function counted(key: string, count: number, shown: number, t: Translator): string {
  return t(key, {
    counted:
      shown < count
        ? t('traffic_get_snapshot.count_first', { count, shown })
        : t('traffic_get_snapshot.count', { count }),
  });
}

function intervals(items: readonly Interval[]): string {
  return items.map((item) => span(item.start, item.end)).join('; ');
}

function valueText(value: RouteValue, t: Translator): string {
  const at = Number.isNaN(Date.parse(value.at))
    ? value.at
    : new Date(Date.parse(value.at)).toISOString().slice(5, 16).replace('T', ' ');
  return `${at} ${value.count === null ? '—' : num(value.count, t.locale)}`;
}

function routeLine(item: RouteSeries, t: Translator): string {
  const name = item.route ?? t('traffic_get_snapshot.no_route');
  const gaps =
    item.gap_points > 0
      ? ` ${t.plural('traffic_get_snapshot.gap_points', item.gap_points, { count: item.gap_points })}`
      : '';
  const stats = t('traffic_get_snapshot.route', {
    points: t.plural('traffic_get_snapshot.points', item.points, {
      count: num(item.points, t.locale),
    }),
    gaps,
    min: item.min === null ? '—' : num(item.min, t.locale),
    max: item.max === null ? '—' : num(item.max, t.locale),
    sum: num(item.sum, t.locale),
  });
  const values = item.values ?? [];
  const shown =
    values.length === 0
      ? ''
      : `: ${values
          .slice(0, VALUES_SHOWN)
          .map((value) => valueText(value, t))
          .join(', ')}${
          values.length > VALUES_SHOWN
            ? ` ${t('traffic_get_snapshot.values_more', { count: values.length - VALUES_SHOWN })}`
            : ''
        }`;
  return `  ${name} — ${stats}${shown}`;
}

export function renderGetSnapshot(data: SnapshotData, t: Translator): string {
  const arrival =
    data.channel === 'file'
      ? t('traffic_list_snapshots.file')
      : data.token_label === null
        ? t('traffic_list_snapshots.pushed')
        : t('traffic_list_snapshots.pushed_by', { label: data.token_label });
  const { counts } = data;
  const lines = [
    t('traffic_get_snapshot.header', { window: data.name, arrival }),
    t('traffic_get_snapshot.id', { id: data.snapshot_id }),
    t('traffic_get_snapshot.counts', {
      unit: t(`traffic_list_snapshots.unit.${data.unit}`),
      bucket: bucketText(data.bucket_seconds),
      timezone: data.timezone,
      routes: num(counts.routes, t.locale),
      rows: num(counts.rows, t.locale),
      total: num(counts.total_count, t.locale),
      entry:
        data.entry_route === null
          ? ''
          : t('traffic_get_snapshot.entry', { route: data.entry_route }),
    }),
    data.source.query === null
      ? t('traffic_get_snapshot.source', { kind: data.source.kind })
      : t('traffic_get_snapshot.source_query', {
          kind: data.source.kind,
          query: data.source.query,
        }),
  ];
  const quality = [
    t.plural('traffic_list_snapshots.buckets', counts.buckets, {
      count: num(counts.buckets, t.locale),
    }),
    t.plural('traffic_list_snapshots.gaps', counts.gaps, { count: num(counts.gaps, t.locale) }),
  ];
  if (counts.partials > 0) {
    quality.push(t('traffic_list_snapshots.partials', { count: num(counts.partials, t.locale) }));
  }
  if (counts.resets > 0) {
    quality.push(t('traffic_list_snapshots.resets', { count: num(counts.resets, t.locale) }));
  }
  quality.push(t('traffic_list_snapshots.unusable', { count: num(counts.unusable, t.locale) }));
  lines.push(t('traffic_get_snapshot.quality', { quality: quality.join(', ') }));
  if (data.gaps.count > 0) {
    lines.push(
      `${counted('traffic_get_snapshot.gaps', data.gaps.count, data.gaps.items.length, t)} ${intervals(data.gaps.items)}`,
    );
  }
  if (data.unusable.count > 0) {
    lines.push(
      `${counted('traffic_get_snapshot.unusable', data.unusable.count, data.unusable.items.length, t)} ${intervals(data.unusable.items)}`,
    );
  }
  const windows = data.excluded_windows;
  if (windows.count > 0) {
    lines.push(
      `${counted('traffic_get_snapshot.excluded', windows.count, windows.items.length, t)} ${windows.items
        .map((item) => `${span(item.start, item.end)} ${item.reason}`)
        .join('; ')}`,
    );
  }
  const profile = data.session_profile;
  if (profile !== null) {
    lines.push(
      t('traffic_get_snapshot.session_profile', {
        signal: profile.navigation_signal,
        keys: num(profile.route_keys, t.locale),
        transitions: num(profile.transition_cells, t.locale),
        next: num(profile.next_cells, t.locale),
        cut_transitions: num(profile.suppressed_transition_cells, t.locale),
        cut_next: num(profile.suppressed_next_cells, t.locale),
      }),
    );
  }
  if (data.routes.count > 0) {
    const shown = data.routes.items.length;
    lines.push(
      shown < data.routes.count
        ? t('traffic_get_snapshot.routes_first', { count: data.routes.count, shown })
        : t('traffic_get_snapshot.routes', { count: data.routes.count }),
    );
    for (const item of data.routes.items) lines.push(routeLine(item, t));
  }
  return lines.join('\n');
}
