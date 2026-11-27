// `traffic_get_snapshot` (module traffic): Get one snapshot: quality report, excluded windows,
// per-route series (summarized by default).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "{snapshot_id}", result "{name}: quality {quality}": the data carries `snapshot_id`,
// `name` (the window as text) and `quality` (complete, gaps, unusable).
// Routes, the entry route, the source's kind and query, reasons, labels and the timezone are the
// sender's text and pass `content()`; the rest are counts and ISO stamps
// (docs/tools/traffic/get-snapshot.md).

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetSnapshot,
  type RouteSeries,
  type SnapshotData,
} from '../../render/traffic/getSnapshot.js';
import { span } from '../../render/traffic/time.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { idOf, projectIdOf } from '../moduleState.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { TRAFFIC_GET_SNAPSHOT } from './meta.generated.js';

/** GET /projects/{project_id}/production-traffic/snapshots/{snapshot_id} (REST API v1) */
export function getSnapshot(
  ctx: CallContext,
  path: { readonly project_id: string; readonly snapshot_id: string },
): Promise<
  OpOutput<'get_snapshot_api_v1_projects__project_id__production_traffic_snapshots__snapshot_id__get'>
> {
  return callBackend(
    ctx,
    'get_snapshot_api_v1_projects__project_id__production_traffic_snapshots__snapshot_id__get',
    { path },
  );
}

type Detail =
  OpOutput<'get_snapshot_api_v1_projects__project_id__production_traffic_snapshots__snapshot_id__get'>;

const NAME_LIMIT = 120;
const QUERY_LIMIT = 300;
const INTERVALS_SHOWN = 10;
const SUMMARY_ROUTES = 50;
const POINT_ROUTES = 20;
const POINTS_SHOWN = 60;

function seriesOf(
  ctx: CallContext,
  series: NonNullable<Detail['series']>,
  withValues: boolean,
): RouteSeries[] {
  const all = series.map((one) => {
    const points = one.points ?? [];
    const counts = points
      .map((point) => point.count)
      .filter((count): count is number => count !== null && count !== undefined);
    const item: RouteSeries = {
      route: one.route == null ? null : content(ctx, one.route, NAME_LIMIT),
      points: points.length,
      min: counts.length === 0 ? null : Math.min(...counts),
      max: counts.length === 0 ? null : Math.max(...counts),
      sum: counts.reduce((total, count) => total + count, 0),
      gap_points: points.length - counts.length,
    };
    return { item, one };
  });
  all.sort((a, b) => b.item.sum - a.item.sum);
  return all.slice(0, withValues ? POINT_ROUTES : SUMMARY_ROUTES).map(({ item, one }) =>
    withValues
      ? {
          ...item,
          values: (one.points ?? []).slice(0, POINTS_SHOWN).map((point) => ({
            at: point.bucket_start,
            count: point.count ?? null,
            quality: point.quality ?? 'ok',
          })),
        }
      : item,
  );
}

function dataOf(ctx: CallContext, detail: Detail, mode: 'summary' | 'points'): SnapshotData {
  const report = detail.report;
  const gaps = report.gaps ?? [];
  const unusable = report.unusable ?? [];
  const windows = detail.excluded_windows ?? [];
  const series = detail.series ?? [];
  const profile = report.session_profile ?? null;
  const quality = detail.quality;
  return {
    snapshot_id: detail.id,
    name: span(detail.window_start, detail.window_end),
    quality:
      unusable.length > 0 || (quality.unusable ?? 0) > 0
        ? 'unusable'
        : gaps.length > 0 || (quality.gaps ?? 0) > 0
          ? 'gaps'
          : 'complete',
    created_at: detail.created_at,
    channel: detail.channel,
    token_label: detail.token_label == null ? null : content(ctx, detail.token_label, NAME_LIMIT),
    window_start: detail.window_start,
    window_end: detail.window_end,
    bucket_seconds: detail.bucket_seconds,
    unit: detail.unit,
    timezone: content(ctx, detail.timezone, NAME_LIMIT),
    entry_route: detail.entry_route == null ? null : content(ctx, detail.entry_route, NAME_LIMIT),
    source: {
      kind: content(ctx, detail.source.kind, NAME_LIMIT),
      query:
        detail.source.query == null || detail.source.query.trim() === ''
          ? null
          : content(ctx, detail.source.query, QUERY_LIMIT),
    },
    counts: {
      buckets: quality.buckets ?? 0,
      gaps: quality.gaps ?? 0,
      partials: quality.partials ?? 0,
      resets: quality.resets ?? 0,
      unusable: quality.unusable ?? 0,
      rows: detail.rows_count ?? 0,
      routes: detail.routes_count ?? 0,
      total_count: quality.total_count ?? 0,
    },
    gaps: { count: gaps.length, items: gaps.slice(0, INTERVALS_SHOWN) },
    unusable: { count: unusable.length, items: unusable.slice(0, INTERVALS_SHOWN) },
    excluded_windows: {
      count: windows.length,
      items: windows.slice(0, INTERVALS_SHOWN).map((window) => ({
        start: window.start,
        end: window.end,
        reason: content(ctx, window.reason, NAME_LIMIT),
      })),
    },
    session_profile:
      profile === null
        ? null
        : {
            navigation_signal: profile.navigation_signal,
            route_keys: profile.route_keys ?? 0,
            transition_cells: profile.transition_cells ?? 0,
            next_cells: profile.next_cells ?? 0,
            suppressed_transition_cells: profile.suppressed_transition_cells ?? 0,
            suppressed_next_cells: profile.suppressed_next_cells ?? 0,
          },
    series_mode: mode,
    routes: { count: series.length, items: seriesOf(ctx, series, mode === 'points') },
  };
}

export const trafficGetSnapshot = moduleTool(TRAFFIC_GET_SNAPSHOT, {
  title: 'Get one snapshot',
  input: {
    snapshot_id: uuidArgument()
      .optional()
      .describe('The snapshot; default: the one chosen for runs of this workspace.'),
    series: z
      .enum(['summary', 'points'])
      .default('summary')
      .describe(
        'summary: per route the count, min, max and sum; points: up to 20 routes of 60 points.',
      ),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const snapshotId = idOf(
      ctx,
      'snapshot_id',
      args.snapshot_id?.toLowerCase(),
      'choices.run.traffic_snapshot_id',
    );
    const detail = await getSnapshot(ctx, { project_id: projectId, snapshot_id: snapshotId });
    return { status: 'done', data: dataOf(ctx, detail, args.series) };
  },
  render: renderGetSnapshot,
});
