/**
 * When did a metric go over its limit for good? A pure function over a time series, so the answer
 * does not depend on who draws the chart.
 *
 * Rule: the first window of at least `minBuckets` consecutive buckets (default 3) whose value is
 * strictly above the limit. A single spike is not "from when". Buckets are consecutive when their
 * offsets differ by exactly `bucketS`; a missing bucket or a non-finite value ends the run.
 * `sustained` says the run lasts to the end of the series.
 */

export interface SeriesPoint {
  offsetS: number;
  value: number;
}

export interface Breach {
  firstOffsetS: number;
  sustained: boolean;
}

/** `series_source` of the results payload, as far as this rule cares. */
export type SeriesSource = 'prometheus' | 'absent_retention' | 'absent_unmeasured';

export interface BreachOptions {
  bucketS: number;
  minBuckets?: number;
}

export interface BreachAnalysisOptions extends BreachOptions {
  seriesSource?: SeriesSource;
}

export type BreachReason =
  | 'ok'
  | 'limit_not_exceeded'
  | 'series_empty'
  | 'series_absent_retention'
  | 'series_absent_unmeasured';

export interface BreachAnalysis {
  breach: Breach | null;
  reason: BreachReason;
}

const DEFAULT_MIN_BUCKETS = 3;
const OFFSET_EPSILON = 1e-6;

/** As `findBreach`, but says why there is no breach: no data, or data that never crossed. */
export function analyzeBreach(
  series: readonly SeriesPoint[],
  limit: number,
  options: BreachAnalysisOptions,
): BreachAnalysis {
  const { bucketS, seriesSource } = options;
  const minBuckets = options.minBuckets ?? DEFAULT_MIN_BUCKETS;
  if (!Number.isFinite(bucketS) || bucketS <= 0) {
    throw new RangeError(`bucketS must be a positive number, got ${String(bucketS)}`);
  }
  if (!Number.isInteger(minBuckets) || minBuckets < 1) {
    throw new RangeError(`minBuckets must be a positive integer, got ${String(minBuckets)}`);
  }
  if (seriesSource === 'absent_retention')
    return { breach: null, reason: 'series_absent_retention' };
  if (seriesSource === 'absent_unmeasured')
    return { breach: null, reason: 'series_absent_unmeasured' };
  if (series.length === 0) return { breach: null, reason: 'series_empty' };

  const points = [...series].sort((a, b) => a.offsetS - b.offsetS);
  let runStart = -1;
  let runLength = 0;
  let previousOffset = Number.NaN;
  let qualified: { startIndex: number; endIndex: number } | null = null;

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (point === undefined) continue;
    const over = Number.isFinite(point.value) && point.value > limit;
    const adjacent = Math.abs(point.offsetS - previousOffset - bucketS) < OFFSET_EPSILON;
    previousOffset = point.offsetS;
    if (over && runLength > 0 && adjacent) {
      runLength += 1;
    } else if (over) {
      // A qualified run that a hole interrupted is over; the first one is the answer.
      if (qualified !== null) break;
      runStart = i;
      runLength = 1;
    } else {
      if (qualified !== null) break;
      runLength = 0;
      continue;
    }
    if (runLength >= minBuckets) {
      qualified ??= { startIndex: runStart, endIndex: i };
      qualified.endIndex = i;
    }
  }

  if (qualified === null) return { breach: null, reason: 'limit_not_exceeded' };
  const first = points[qualified.startIndex];
  if (first === undefined) return { breach: null, reason: 'limit_not_exceeded' };
  return {
    breach: {
      firstOffsetS: first.offsetS,
      sustained: qualified.endIndex === points.length - 1,
    },
    reason: 'ok',
  };
}

export function findBreach(
  series: readonly SeriesPoint[],
  limit: number,
  options: BreachOptions,
): Breach | null {
  return analyzeBreach(series, limit, options).breach;
}
