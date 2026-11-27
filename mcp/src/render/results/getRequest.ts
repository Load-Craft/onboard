// The view of `results_get_request`: the totals of one request of a run, its response times as the
// histogram buckets estimate them, its statuses and, on request, its course over time. The request
// and group names arrive masked and made one line by the tool (`content`); the view adds no text
// of the backend of its own.

import type { Translator } from '../../context.js';
import { decimal, num, sparkline } from '../primitives.js';

/** One point of the request over time. */
export interface SeriesPoint {
  readonly t: string;
  readonly rps: number;
  readonly okPerS: number;
  readonly koPerS: number;
  readonly meanMs: number;
  readonly p95: number;
  readonly p99: number;
}

export interface StatusCount {
  /** A three-digit status, `unknown`, `no_response`, `unmet_check`, `non_http_transport` or `other`. */
  readonly key: string;
  readonly count: number;
}

export interface RequestData {
  readonly run: string;
  readonly run_id: string;
  readonly request: string;
  readonly group: string | null;
  readonly count: number;
  readonly ok: number;
  readonly ko: number;
  /** 0..1 */
  readonly errorRate: number;
  readonly rps: number | null;
  readonly meanMs: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  /**
   * Bounds of the histogram buckets the fastest and the slowest response fell in (the backend's
   * `bucket-estimate`), not samples: a bound may lie above the mean. Null when not measured.
   */
  readonly minBoundMs: number | null;
  readonly maxBoundMs: number | null;
  readonly statuses: readonly StatusCount[];
  readonly series?: readonly SeriesPoint[];
  readonly seriesStepS?: number;
}

function statusName(key: string, t: Translator): string {
  return /^\d{3}$/u.test(key) ? key : t(`results_get_request.status.${key}`);
}

/** The largest value to `digits` decimals, without a fraction when it is whole. */
function maxOf(values: readonly number[], digits: number, locale: 'en' | 'pl'): string {
  const max = Number(Math.max(0, ...values).toFixed(digits));
  return decimal(max, Number.isInteger(max) ? 0 : digits, locale);
}

function seriesLines(data: RequestData, t: Translator): string[] {
  const points = data.series ?? [];
  if (points.length === 0) return [t('results_get_request.series.none')];
  const { locale } = t;
  return [
    t('results_get_request.series.header', { step: num(data.seriesStepS ?? 0, locale) }),
    t('results_get_request.series.p95', {
      spark: sparkline(points.map((p) => p.p95)),
      max: maxOf(
        points.map((p) => p.p95),
        0,
        locale,
      ),
    }),
    t('results_get_request.series.rps', {
      spark: sparkline(points.map((p) => p.rps)),
      max: maxOf(
        points.map((p) => p.rps),
        1,
        locale,
      ),
    }),
    t('results_get_request.series.ko', {
      spark: sparkline(points.map((p) => p.koPerS)),
      max: maxOf(
        points.map((p) => p.koPerS),
        1,
        locale,
      ),
    }),
  ];
}

export function renderGetRequest(
  data: RequestData,
  t: Translator,
  args: { readonly include?: readonly string[] | undefined },
): string {
  const { locale } = t;
  if (data.count === 0) {
    return t('results_get_request.none', { run: data.run, request: data.request });
  }
  const lines: string[] = [];
  lines.push(
    data.group === null
      ? t('results_get_request.header', { request: data.request, run: data.run })
      : t('results_get_request.header.group', {
          request: data.request,
          run: data.run,
          group: data.group,
        }),
  );
  const counts = {
    count: num(data.count, locale),
    ok: num(data.ok, locale),
    ko: num(data.ko, locale),
    rate: decimal(data.errorRate * 100, 2, locale),
  };
  lines.push(
    data.rps === null
      ? t('results_get_request.counts.noRate', counts)
      : t('results_get_request.counts', { ...counts, rps: decimal(data.rps, 1, locale) }),
  );
  lines.push(t('results_get_request.times.header'));
  lines.push(
    t('results_get_request.times', {
      mean: num(data.meanMs, locale),
      p50: num(data.p50, locale),
      p75: num(data.p75, locale),
      p90: num(data.p90, locale),
      p95: num(data.p95, locale),
      p99: num(data.p99, locale),
    }),
  );
  if (data.minBoundMs !== null && data.maxBoundMs !== null) {
    lines.push(
      t('results_get_request.bounds', {
        min: num(data.minBoundMs, locale),
        max: num(data.maxBoundMs, locale),
      }),
    );
  }
  if (data.statuses.length > 0) {
    const list = data.statuses
      .map((s) => `${statusName(s.key, t)} ×${num(s.count, locale)}`)
      .join(' · ');
    lines.push(t('results_get_request.statuses', { list }));
  }
  const withSeries = args.include?.includes('series') === true;
  if (withSeries) lines.push(...seriesLines(data, t));
  else lines.push(t('results_get_request.next.series'));
  if (data.ko > 0) lines.push(t('results_get_request.next.errors', { run: data.run }));
  return lines.join('\n');
}
