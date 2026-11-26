// What a comparison of two test runs may honestly say. Two runs are set side by side only when
// the conditions that decide their numbers are the same: the load that was sent (after the
// environment's limit cut it), the environment, the scenario or composition, and the target and
// build the backend recorded. When any of them is known to differ, no figure is drawn; when the
// backend could not tell, the figures are drawn under a sentence that says so. A change inside
// the noise of one measurement is "no significant change", never an improvement or a regression.

import type { RunComparison } from '../api/results.js';
import type { Profile } from '../profiles/presets.js';

/** A relative change below this is within the noise of one run (5%). */
export const NOISE_RELATIVE = 0.05;
/** An error rate that moved less than this many percentage points is noise, however large relatively. */
export const NOISE_ERROR_POINTS = 0.1;
/** Measured durations that differ by more than this (10%) are told before the figures. */
export const DURATION_RELATIVE = 0.1;
/** Backend sentences about the evidence that are carried into the view. */
const MAX_BACKEND_NOTES = 3;

export type RowMetric = 'p95' | 'errors' | 'perSecond';
/** `changed`: a real change in a figure that is not better or worse in itself (throughput). */
export type RowVerdict = 'better' | 'worse' | 'same' | 'changed' | 'unknown';

export interface ComparisonRow {
  readonly metric: RowMetric;
  /** The earlier run; the error rate is a percentage, the p95 milliseconds, throughput per second. */
  readonly was: number | null;
  readonly is: number | null;
  /** Relative change in percent; absent when there is no figure on a side or the earlier is zero. */
  readonly changePct?: number;
  readonly verdict: RowVerdict;
  /** Read from histogram buckets or from two different estimators: drawn with `≈`, never assessed. */
  readonly estimate?: true;
}

export type RunSide = 'previous' | 'current';

/** Something known to differ between the runs: no figures are drawn. */
export type ComparisonDifference =
  | { readonly kind: 'profile'; readonly was: Profile; readonly is: Profile }
  | { readonly kind: 'workload' }
  | { readonly kind: 'environment' }
  | { readonly kind: 'scope' }
  | { readonly kind: 'ended'; readonly run: RunSide; readonly state: 'cancelled' | 'run_failed' }
  /** A difference of target or build, in the backend's own words. */
  | { readonly kind: 'backend'; readonly text: string }
  | { readonly kind: 'unspecified' };

/** A caution that stands before figures drawn from runs that may still not be alike. */
export type ComparisonNote =
  | { readonly kind: 'unverified' }
  | { readonly kind: 'capped'; readonly run: RunSide; readonly from?: number; readonly to?: number }
  | { readonly kind: 'durations'; readonly was: number; readonly is: number }
  | { readonly kind: 'p95Sources' }
  | { readonly kind: 'backend'; readonly text: string };

export interface ComparisonData {
  /** Short handle of the earlier run. */
  readonly previous: string;
  readonly state: 'comparable' | 'unverified' | 'not_comparable';
  readonly differences: readonly ComparisonDifference[];
  readonly notes: readonly ComparisonNote[];
  /** Absent when the runs are not comparable. */
  readonly rows?: readonly ComparisonRow[];
  /** The runs are of a composition: figures and their change, no assessment of it. */
  readonly composition?: true;
}

const sameProfile = (a: Profile, b: Profile): boolean =>
  a.type === b.type && a.vusers === b.vusers && a.ramp === b.ramp && a.hold === b.hold;

export interface RunSideFacts {
  readonly planned: Profile | null;
  readonly scenarioId: string | null;
  readonly compositionId: string | null;
  readonly state: string;
  /** Measured duration of the load, in seconds. */
  readonly durationS: number | null;
  /** Where the whole-test percentiles of the run came from (`gatling-report`, `histogram`, …). */
  readonly percentileSource: string | null;
  readonly capped?: { readonly from?: number; readonly to?: number };
}

export interface ComparisonInput {
  readonly previous: string;
  readonly was: RunSideFacts;
  readonly is: RunSideFacts;
  readonly comparison: RunComparison;
}

function differencesOf(input: ComparisonInput): ComparisonDifference[] {
  const { was, is, comparison } = input;
  const found: ComparisonDifference[] = [];
  for (const [run, side] of [
    ['previous', was],
    ['current', is],
  ] as const) {
    if (side.state === 'cancelled' || side.state === 'run_failed') {
      found.push({ kind: 'ended', run, state: side.state });
    }
  }
  if (was.planned !== null && is.planned !== null && !sameProfile(was.planned, is.planned)) {
    found.push({ kind: 'profile', was: was.planned, is: is.planned });
  } else if (comparison.sameWorkload === false) {
    found.push({ kind: 'workload' });
  }
  const { was: envWas, is: envIs } = comparison.environments;
  if (envWas !== null && envIs !== null && envWas !== envIs) found.push({ kind: 'environment' });
  if (was.scenarioId !== is.scenarioId || was.compositionId !== is.compositionId) {
    found.push({ kind: 'scope' });
  }
  for (const text of comparison.reasons) found.push({ kind: 'backend', text });
  if (found.length === 0 && comparison.comparable === false) found.push({ kind: 'unspecified' });
  return found;
}

/** Both p95 are Gatling's own figure; any other pair mixes or lacks estimators. */
function exactP95(input: ComparisonInput): boolean {
  return (
    input.was.percentileSource === 'gatling-report' &&
    input.is.percentileSource === 'gatling-report'
  );
}

function notesOf(input: ComparisonInput, comparable: boolean): ComparisonNote[] {
  const notes: ComparisonNote[] = [];
  if (!comparable) notes.push({ kind: 'unverified' });
  for (const [run, side] of [
    ['previous', input.was],
    ['current', input.is],
  ] as const) {
    if (side.capped !== undefined) notes.push({ kind: 'capped', run, ...side.capped });
  }
  const was = input.was.durationS;
  const is = input.is.durationS;
  if (was !== null && is !== null && Math.max(was, is) > 0) {
    if (Math.abs(is - was) / Math.max(was, is) > DURATION_RELATIVE) {
      notes.push({ kind: 'durations', was, is });
    }
  }
  if (!exactP95(input)) notes.push({ kind: 'p95Sources' });
  for (const text of input.comparison.warnings.slice(0, MAX_BACKEND_NOTES)) {
    notes.push({ kind: 'backend', text });
  }
  return notes;
}

/** Relative change in percent, rounded to a tenth; absent when it cannot be told. */
function changeOf(was: number | null, is: number | null): number | undefined {
  if (was === null || is === null || was === 0) return undefined;
  return Math.round(((is - was) / was) * 1000) / 10;
}

/**
 * Whether the change is more than noise: 5% of the earlier figure, and for the error rate also at
 * least a tenth of a percentage point (a few more failed requests out of a handful are not a trend).
 */
function moved(metric: RowMetric, was: number, is: number): boolean {
  const diff = Math.abs(is - was);
  if (diff === 0) return false;
  if (metric === 'errors' && diff < NOISE_ERROR_POINTS) return false;
  // Rounded, so that 5% computed in floating point is not read as 4.9999%.
  return was === 0 || Math.round((diff / was) * 1e6) / 1e6 >= NOISE_RELATIVE;
}

function verdictOf(
  metric: RowMetric,
  was: number | null,
  is: number | null,
  assess: boolean,
): RowVerdict {
  if (was === null || is === null) return 'unknown';
  if (!moved(metric, was, is)) return 'same';
  if (metric === 'perSecond' || !assess) return 'changed';
  return is < was ? 'better' : 'worse';
}

const rate = (failed: number | null, total: number | null): number | null =>
  failed === null || total === null || total <= 0 ? null : (failed / total) * 100;

function rowsOf(comparison: RunComparison, assess: boolean, exact: boolean): ComparisonRow[] {
  const errorsWas = rate(comparison.failedRequests.was, comparison.totalRequests.was);
  const errorsIs = rate(comparison.failedRequests.is, comparison.totalRequests.is);
  const spec: readonly [RowMetric, number | null, number | null][] = [
    ['p95', comparison.p95.was, comparison.p95.is],
    ['errors', errorsWas, errorsIs],
    ['perSecond', comparison.requestsPerSecond.was, comparison.requestsPerSecond.is],
  ];
  return spec.map(([metric, was, is]): ComparisonRow => {
    const change = changeOf(was, is);
    const estimate = metric === 'p95' && !exact;
    return {
      metric,
      was,
      is,
      ...(change === undefined ? {} : { changePct: change }),
      verdict: verdictOf(metric, was, is, assess && !estimate),
      ...(estimate ? { estimate: true as const } : {}),
    };
  });
}

/** The comparison of the earlier run with the current one, ready for the view. */
export function buildComparison(input: ComparisonInput): ComparisonData {
  const differences = differencesOf(input);
  if (differences.length > 0) {
    return { previous: input.previous, state: 'not_comparable', differences, notes: [] };
  }
  const known = input.comparison.comparable === true;
  const composition = input.is.compositionId !== null;
  return {
    previous: input.previous,
    state: known ? 'comparable' : 'unverified',
    differences: [],
    notes: notesOf(input, known),
    rows: rowsOf(input.comparison, !composition, exactP95(input)),
    ...(composition ? { composition: true as const } : {}),
  };
}
