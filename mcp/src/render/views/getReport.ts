// View of `results_get_report`: the verdict, the thresholds of the whole test, the load that was planned,
// the counts and times, the errors, the per-request p95 as an estimate, and when the p95 went over
// the threshold. The model sees this text and nothing else, so every number it needs is in it, and
// every number says how it was measured: thresholds belong to the whole test only, the p95 of a
// request is an estimate, the load is always "planned".

import type { Translator } from '../../context.js';
import type { Profile, ProfileType } from '../../profiles/presets.js';
import {
  NOISE_ERROR_POINTS,
  NOISE_RELATIVE,
  type ComparisonData,
  type ComparisonDifference,
  type ComparisonNote,
  type ComparisonRow,
} from '../../report/compare.js';
import type { VerdictState } from '../../report/verdict.js';
import { clock, columns, decimal, inline, ms, num, VIEW_WIDTH, wrap } from '../primitives.js';
import { shape } from './run.js';

/** A threshold of the whole test, as the exact SLA verdict judged it. */
export interface ThresholdView {
  readonly kind: 'percentile' | 'stat' | 'failed_percent' | 'other';
  /** `percentile`: 95 for the p95. */
  readonly percentile?: number;
  /** `stat`: `mean`, `min`, `max` or `std_dev`. */
  readonly stat?: string;
  /** `other`: the backend's own words for the metric. */
  readonly label?: string;
  readonly unit: string;
  /** The measured value; null when the run had no samples to measure it on. */
  readonly value: number | null;
  /** The bound; absent for a condition that has none a single number can show. */
  readonly limit?: number;
  /** The upper bound of a range condition. */
  readonly limitTo?: number;
  readonly pass: boolean;
}

export interface ReportError {
  /** HTTP status; null for a group that is not a status (then `message` names it). */
  readonly status: number | null;
  /** The standard reason phrase of the status, when there is one. */
  readonly label?: string;
  readonly message?: string;
  readonly count: number;
  /** Set when exactly one request failed. */
  readonly endpoint?: string;
}

export interface ReportRequest {
  readonly name: string;
  /** Estimate from the histogram buckets, never an exact percentile. */
  readonly p95Estimate: number;
}

/**
 * The peak of concurrent virtual users the backend measured from the run's own log, or why the
 * report has none. Never a zero standing for "no data".
 */
export type ReportPeak =
  | { readonly users: number }
  | { readonly unavailable: 'no_capability' | 'composition' | 'not_recorded' };

export type ReportVerdictState = Exclude<VerdictState, 'in_progress'>;

export interface ReportData {
  readonly verdict: { readonly state: ReportVerdictState; readonly reasons: readonly string[] };
  /** The message the backend kept for a run that failed. */
  readonly failure?: string;
  readonly thresholds?: readonly ThresholdView[];
  /** Thresholds of single requests that were not met (they are not drawn per request). */
  readonly scopedFailed?: number;
  readonly run: {
    /** The measured duration of the load. */
    readonly durationS?: number;
    /** What the run was started with. */
    readonly planned?: Profile;
    /** The measured peak of concurrent users; absent when the report does not speak of it. */
    readonly peak?: ReportPeak;
    /** The environment's limit cut the load: what was asked for and what was sent. */
    readonly capped?: { readonly from?: number; readonly to?: number };
  };
  readonly requests: { readonly total?: number; readonly perSecond?: number };
  /** Absent when the percentiles were not measured. */
  readonly latency?: {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
    /** Read from a histogram, not Gatling's exact figures. */
    readonly estimate?: true;
  };
  readonly errors: readonly ReportError[];
  /** Error groups left out of `errors`. */
  readonly moreErrors?: number;
  /** The error groups could not be read, so `errors` says nothing. */
  readonly errorsUnavailable?: true;
  /** At most eight, slowest first. */
  readonly endpoints: readonly ReportRequest[];
  readonly moreEndpoints?: number;
  /** The p95 went over the threshold: when (seconds from the start of the series) and for how long. */
  readonly breach?: { readonly offsetS: number; readonly sustained: boolean };
  /** The series are gone or were never measured: the estimated sections are one sentence. */
  readonly seriesAbsent?: 'retention' | 'unmeasured' | 'unreachable';
  /** The comparison with an earlier run, when one was asked for. */
  readonly comparison?: ComparisonData;
}

/** The label column: 14 characters and a space, as in every golden text with labels. */
const LABEL_WIDTH = 15;
const VALUE_WIDTH = VIEW_WIDTH - LABEL_WIDTH;
const indent = ' '.repeat(LABEL_WIDTH);

const NAME_LIMIT = 80;
const FAILURE_LIMIT = 200;
const HANDLE_LIMIT = 40;
const TICK = '✓';
const CROSS = '✕';
/** A run this long is told in hours (`2 h`), in minutes below it. */
const HOUR_S = 3600;
/** Below this many seconds the duration is told in seconds. */
const SECONDS_ONLY_BELOW_S = 90;

const label = (text: string): string => text.padEnd(LABEL_WIDTH - 1) + ' ';

/** A label and its value wrapped under the value column. */
function field(name: string, value: string): string[] {
  const [first = '', ...rest] = wrap(value, VALUE_WIDTH);
  return [label(name) + first, ...rest.map((line) => indent + line)];
}

/** Several lines under one label: the first beside it, the rest under the value column. */
function fieldLines(name: string, lines: readonly string[]): string[] {
  const [first = '', ...rest] = lines;
  return [label(name) + first, ...rest.map((line) => indent + line)];
}

/** `0,6`, `0`, `99,9`: at most `digits` decimals, none that are zero. */
function trimmed(value: number, digits: number, locale: Translator['locale']): string {
  const text = decimal(value, digits, locale);
  const mark = locale === 'pl' ? ',' : '.';
  return text.includes(mark) ? text.replace(/0+$/u, '').replace(/[,.]$/u, '') : text;
}

function duration(seconds: number, t: Translator): string {
  if (seconds >= HOUR_S) {
    const hours = Math.floor(seconds / HOUR_S);
    const minutes = Math.round((seconds % HOUR_S) / 60);
    return minutes === 0
      ? t('profiles.dur.h', { n: num(hours, t.locale) })
      : `${t('profiles.dur.h', { n: num(hours, t.locale) })} ${t('profiles.dur.min', { n: minutes })}`;
  }
  if (seconds < SECONDS_ONLY_BELOW_S) {
    return t('profiles.dur.s', { n: num(Math.max(1, Math.round(seconds)), t.locale) });
  }
  return t('profiles.dur.min', { n: num(Math.round(seconds / 60), t.locale) });
}

// ---- thresholds -------------------------------------------------------------------------

function metricName(threshold: ThresholdView, t: Translator): string {
  switch (threshold.kind) {
    case 'percentile':
      return `p${trimmed(threshold.percentile ?? 0, 2, t.locale)}`;
    case 'stat':
      return t(`report.threshold.stat.${threshold.stat ?? 'mean'}`);
    case 'failed_percent':
      return t('report.threshold.failed');
    case 'other':
      return threshold.label === undefined || threshold.label === ''
        ? t('report.threshold.other')
        : inline(threshold.label, NAME_LIMIT);
  }
}

function quantity(unit: string, value: number, t: Translator): string {
  switch (unit) {
    case 'ms':
      return ms(value, t.locale);
    case 'percent':
      return `${trimmed(value, 2, t.locale)}%`;
    case 'count':
      return num(value, t.locale);
    case 'requests_per_second':
      return t('report.unit.perSecond', { value: trimmed(value, 1, t.locale) });
    default:
      return trimmed(value, 2, t.locale);
  }
}

/** The value, the way it stands to the bound (`>`, `<`, `=`), the bound and whether it passed. */
function thresholdText(threshold: ThresholdView, t: Translator): string {
  const mark = threshold.pass ? TICK : CROSS;
  const name = metricName(threshold, t);
  if (threshold.value === null) return `${name} ${t('report.threshold.noValue')} ${mark}`;
  const value = quantity(threshold.unit, threshold.value, t);
  if (threshold.limit === undefined) return `${name} ${value} ${mark}`;
  const limit = quantity(threshold.unit, threshold.limit, t);
  if (threshold.limitTo !== undefined) {
    const range = t('report.threshold.range', {
      from: limit,
      to: quantity(threshold.unit, threshold.limitTo, t),
    });
    return `${name} ${value} ${range} ${mark}`;
  }
  const relation =
    threshold.value > threshold.limit ? '>' : threshold.value < threshold.limit ? '<' : '=';
  return `${name} ${value} ${relation} ${limit} ${mark}`;
}

function thresholdLines(data: ReportData, t: Translator): string[] {
  const parts = (data.thresholds ?? []).map((threshold) => thresholdText(threshold, t));
  if (data.scopedFailed !== undefined && data.scopedFailed > 0) {
    parts.push(t('report.threshold.scoped', { count: num(data.scopedFailed, t.locale) }));
  }
  return parts.length === 0 ? [] : field(t('report.label.thresholds'), parts.join(' · '));
}

// ---- verdict ----------------------------------------------------------------------------

/** Codes that only repeat the name of the verdict. */
const SILENT_REASONS: ReadonlySet<string> = new Set(['sla_failed', 'result_has_errors']);

function reasonText(code: string, t: Translator): string {
  const at = code.indexOf(':');
  const kind = at < 0 ? code : code.slice(0, at);
  const detail = at < 0 ? '' : inline(code.slice(at + 1), NAME_LIMIT);
  switch (kind) {
    case 'sla_exit_code_2_legacy':
    case 'invariants_not_evaluated':
    case 'no_verdict':
      return t(`report.reason.${kind}`);
    case 'invariant_violated':
      return t('report.reason.invariant_violated', { name: detail });
    case 'value_ledger_failed':
      return t('report.reason.value_ledger_failed', { variable: detail });
    case 'sla_refused':
      return t('report.reason.sla_refused', { reason: detail });
    default:
      return inline(code, NAME_LIMIT);
  }
}

/** The next move for a verdict that is not a result of the application; absent for the others. */
function verdictNext(data: ReportData, t: Translator): string | undefined {
  if (data.verdict.state === 'run_failed') return t('report.next.run_failed');
  const unjudged = data.verdict.reasons.some(
    (code) => code.startsWith('sla_refused') || code === 'invariants_not_evaluated',
  );
  return data.verdict.state === 'sla_not_judged' && unjudged
    ? t('report.next.not_judged')
    : undefined;
}

function verdictLines(data: ReportData, t: Translator): string[] {
  const reasons = data.verdict.reasons
    .filter((code) => !SILENT_REASONS.has(code))
    .map((code) => reasonText(code, t));
  const name = t(`report.verdict.${data.verdict.state}`);
  const text = reasons.length === 0 ? name : `${name} · ${reasons.join('; ')}`;
  const next = verdictNext(data, t);
  return [
    ...field(t('report.label.verdict'), text),
    ...(data.failure === undefined
      ? []
      : field(t('report.label.failure'), inline(data.failure, FAILURE_LIMIT))),
    ...(next === undefined ? [] : wrap(next, VIEW_WIDTH)),
  ];
}

// ---- load, counts, times ----------------------------------------------------------------

function cappedLines(data: ReportData, t: Translator): string[] {
  const { capped } = data.run;
  if (capped === undefined) return [];
  const text =
    capped.from === undefined || capped.to === undefined
      ? t('report.capped.unknown')
      : t('report.capped', { to: num(capped.to, t.locale), from: num(capped.from, t.locale) });
  return field(t('report.label.note'), text);
}

/** Profiles that start users at a rate: how many are in flight at once depends on the path length. */
const OPEN_MODEL: ReadonlySet<ProfileType> = new Set<ProfileType>([
  'ramp',
  'constant',
  'ramp_hold',
  'stress',
]);

function peakText(peak: { readonly users: number }, planned: Profile | undefined, t: Translator) {
  const text = t('report.peak', { users: num(peak.users, t.locale) });
  return planned !== undefined && OPEN_MODEL.has(planned.type)
    ? t('report.peak.openModel', { peak: text })
    : text;
}

function runLines(data: ReportData, t: Translator): string[] {
  const { durationS, planned, peak } = data.run;
  const parts = [
    ...(durationS === undefined ? [] : [duration(durationS, t)]),
    ...(planned === undefined ? [] : [t('report.planned', { shape: shape(planned, t) })]),
    ...(peak === undefined || 'unavailable' in peak ? [] : [peakText(peak, planned, t)]),
  ];
  return parts.length === 0 ? [] : field(t('report.label.run'), parts.join(' · '));
}

function peakLines(data: ReportData, t: Translator): string[] {
  const { peak } = data.run;
  if (peak === undefined || !('unavailable' in peak)) return [];
  // Only a known reason picks a key; anything else is the plain "no peak was measured".
  const reason =
    peak.unavailable === 'no_capability' || peak.unavailable === 'composition'
      ? peak.unavailable
      : 'not_recorded';
  return field(
    t('report.label.peak'),
    t('report.peak.unavailable', { why: t(`report.peak.${reason}`) }),
  );
}

function requestLines(data: ReportData, t: Translator): string[] {
  const { total, perSecond } = data.requests;
  if (total === undefined) return [];
  const rate =
    perSecond === undefined
      ? []
      : [
          t('report.perSecond', {
            value: perSecond >= 10 ? num(perSecond, t.locale) : decimal(perSecond, 1, t.locale),
          }),
        ];
  return field(t('report.label.requests'), [num(total, t.locale), ...rate].join(' · '));
}

function latencyLines(data: ReportData, t: Translator): string[] {
  const { latency } = data;
  if (latency === undefined) return [];
  const text = [
    `p50 ${ms(latency.p50, t.locale)}`,
    `p95 ${ms(latency.p95, t.locale)}`,
    `p99 ${ms(latency.p99, t.locale)}`,
  ].join(' · ');
  return field(
    t('report.label.latency'),
    latency.estimate === true ? `${text} ${t('report.estimate')}` : text,
  );
}

// ---- errors -----------------------------------------------------------------------------

function errorLine(error: ReportError, t: Translator): string {
  const what =
    error.status === null
      ? inline(error.message ?? '?', NAME_LIMIT)
      : [String(error.status), ...(error.label === undefined ? [] : [inline(error.label)])].join(
          ' ',
        );
  const head = t('report.errors.entry', { what, count: num(error.count, t.locale) });
  return error.endpoint === undefined
    ? head
    : `${head} · ${t('report.errors.only', { endpoint: inline(error.endpoint, NAME_LIMIT) })}`;
}

function errorLines(data: ReportData, t: Translator): string[] {
  const lines = data.errors.map((error) => errorLine(error, t));
  if (data.moreErrors !== undefined && data.moreErrors > 0) {
    lines.push(t('status.more', { count: num(data.moreErrors, t.locale) }));
  }
  if (data.errorsUnavailable === true) lines.push(t('report.errors.unavailable'));
  return lines.length === 0 ? [] : fieldLines(t('report.label.errors'), lines);
}

// ---- requests and the breach ------------------------------------------------------------

const REQUEST_NAME = /^([A-Z]{3,7}) (.+)$/u;

/** `GET  /products`: the method padded to the widest one, so the paths line up. */
function requestTable(requests: readonly ReportRequest[], t: Translator): string[] {
  const names = requests.map((request) => inline(request.name, NAME_LIMIT));
  const parsed = names.map((name) => REQUEST_NAME.exec(name));
  const methodWidth = Math.max(0, ...parsed.map((match) => match?.[1]?.length ?? 0));
  const rows = requests.map((request, index): [string, string] => {
    const match = parsed[index];
    const name = names[index] ?? '';
    const aligned =
      match?.[1] === undefined || match[2] === undefined
        ? name
        : `${match[1].padEnd(methodWidth)} ${match[2]}`;
    return [aligned, ms(request.p95Estimate, t.locale)];
  });
  return columns(rows, { gap: 3, align: ['left', 'right'] }).map((line) => `  ${line}`);
}

function seriesLines(data: ReportData, t: Translator): string[] {
  if (data.seriesAbsent !== undefined) {
    return wrap(t(`report.series.${data.seriesAbsent}`), VIEW_WIDTH);
  }
  const lines: string[] = [];
  if (data.endpoints.length > 0) {
    lines.push(t('report.endpoints.header'), ...requestTable(data.endpoints, t));
    if (data.moreEndpoints !== undefined && data.moreEndpoints > 0) {
      lines.push(`  ${t('status.more', { count: num(data.moreEndpoints, t.locale) })}`);
    }
  }
  if (data.breach !== undefined) {
    lines.push(
      t(data.breach.sustained ? 'report.breach.sustained' : 'report.breach.brief', {
        at: clock(data.breach.offsetS),
      }),
    );
  }
  return lines;
}

// ---- the comparison with an earlier run -------------------------------------------------

const ARROW = '→';
const MINUS = '−';

function differenceText(difference: ComparisonDifference, t: Translator): string {
  switch (difference.kind) {
    case 'profile':
      return t('report.compare.diff.profile', {
        was: shape(difference.was, t),
        is: shape(difference.is, t),
      });
    case 'ended':
      return t(`report.compare.diff.${difference.state}.${difference.run}`);
    case 'backend':
      return inline(difference.text, FAILURE_LIMIT);
    default:
      return t(`report.compare.diff.${difference.kind}`);
  }
}

function noteText(note: ComparisonNote, t: Translator): string {
  switch (note.kind) {
    case 'unverified':
      return t('report.compare.note.unverified');
    case 'capped':
      return note.from === undefined || note.to === undefined
        ? t(`report.compare.note.capped.unknown.${note.run}`)
        : t(`report.compare.note.capped.${note.run}`, {
            to: num(note.to, t.locale),
            from: num(note.from, t.locale),
          });
    case 'durations':
      return t('report.compare.note.durations', {
        was: duration(note.was, t),
        is: duration(note.is, t),
      });
    case 'p95Sources':
      return t('report.compare.note.p95Sources');
    case 'backend':
      return inline(note.text, FAILURE_LIMIT);
  }
}

function figure(row: ComparisonRow, value: number | null, t: Translator): string {
  if (value === null) return '—';
  switch (row.metric) {
    case 'p95':
      return `${row.estimate === true ? '≈' : ''}${ms(value, t.locale)}`;
    case 'errors':
      return `${trimmed(value, 2, t.locale)}%`;
    case 'perSecond':
      return value >= 10 ? num(value, t.locale) : decimal(value, 1, t.locale);
  }
}

/** `(−60%)`: signed, a tenth of a percent below ten, whole percents from ten. */
function changeText(changePct: number | undefined, t: Translator): string {
  if (changePct === undefined) return '';
  if (changePct === 0) return ' (0%)';
  const size = Math.abs(changePct);
  const text = size < 10 ? trimmed(size, 1, t.locale) : num(size, t.locale);
  return ` (${changePct < 0 ? MINUS : '+'}${text}%)`;
}

function comparisonRow(row: ComparisonRow, t: Translator): [string, string, string] {
  const change =
    row.was === null || row.is === null
      ? ''
      : `${figure(row, row.was, t)} ${ARROW} ${figure(row, row.is, t)}${changeText(row.changePct, t)}`;
  return [
    t(`report.compare.row.${row.metric}`),
    change === '' ? '—' : change,
    t(`report.compare.${row.verdict}`),
  ];
}

function comparisonLines(data: ReportData, t: Translator): string[] {
  const { comparison } = data;
  if (comparison === undefined) return [];
  const previous = inline(comparison.previous, HANDLE_LIMIT);
  if (comparison.state === 'not_comparable') {
    const reasons = comparison.differences.map((difference) => differenceText(difference, t));
    const sentences = [
      t('report.compare.incomparable', { previous, reasons: reasons.join('; ') }),
      t('report.compare.noFigures'),
    ];
    return fieldLines(
      t('report.label.comparison'),
      sentences.flatMap((sentence) => wrap(sentence, VALUE_WIDTH)),
    );
  }
  const rows = columns(
    (comparison.rows ?? []).map((row) => comparisonRow(row, t)),
    { gap: 2 },
  );
  const footer =
    comparison.composition === true
      ? t('report.compare.composition')
      : t('report.compare.threshold', {
          pct: num(NOISE_RELATIVE * 100, t.locale),
          points: decimal(NOISE_ERROR_POINTS, 1, t.locale),
        });
  const lines = [
    t('report.compare.with', { previous }),
    ...comparison.notes.flatMap((note) => wrap(noteText(note, t), VALUE_WIDTH)),
    ...rows,
    ...wrap(footer, VALUE_WIDTH),
  ];
  return fieldLines(t('report.label.comparison'), lines);
}

export function renderGetReport(data: ReportData, t: Translator): string {
  return [
    ...verdictLines(data, t),
    ...thresholdLines(data, t),
    ...cappedLines(data, t),
    ...runLines(data, t),
    ...peakLines(data, t),
    ...requestLines(data, t),
    ...latencyLines(data, t),
    ...errorLines(data, t),
    ...seriesLines(data, t),
    ...comparisonLines(data, t),
  ].join('\n');
}
