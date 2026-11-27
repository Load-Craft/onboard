// The view of `results_compare_runs`: nine rows of figures, the earlier run as `was`, the one asked
// about as `now`, the change and, when the runs are comparable, a verdict on it. Every row of the
// table fits 40 columns; the twelve metrics are in the data. Texts of a third party (reasons that
// name an address, console errors) arrive masked and made one line by the tool (`content`).

import type { Translator } from '../../context.js';
import { columns, decimal, num } from '../primitives.js';

export type MetricKey =
  | 'p50'
  | 'p75'
  | 'p90'
  | 'p95'
  | 'p99'
  | 'mean_response_time'
  | 'max_response_time'
  | 'min_response_time'
  | 'ko_count'
  | 'ok_count'
  | 'total_requests'
  | 'requests_per_second';

export type Judgement = 'better' | 'worse' | 'same';

export interface MetricRow {
  readonly key: MetricKey;
  /** The earlier (compared) run. */
  readonly other: number | null;
  /** The run asked about. */
  readonly run: number | null;
  readonly delta: number | null;
  readonly deltaPct: number | null;
  readonly judgement: Judgement | null;
}

export interface MessageCount {
  readonly message: string;
  readonly count: number;
}

export interface CommonMessage {
  readonly message: string;
  readonly countOther: number;
  readonly countRun: number;
}

export interface CompareErrors {
  readonly onlyRun: readonly MessageCount[];
  readonly onlyOther: readonly MessageCount[];
  readonly common: readonly CommonMessage[];
  /** How many messages the backend named in each part, before the lists above were cut. */
  readonly totals: {
    readonly onlyRun: number;
    readonly onlyOther: number;
    readonly common: number;
  };
}

export interface CompareData {
  readonly run: string;
  readonly run_id: string;
  readonly other: string;
  readonly other_id: string;
  /** The other run is the baseline of this one. */
  readonly baseline: boolean;
  /**
   * Where the baseline comes from: the reference run of the scenario and its load, which LoadCraft
   * takes from the pair's first measured run unless one is pinned in the app; the backend does not
   * record which. Present only against the baseline.
   */
  readonly baselineSource?: 'reference_of_scenario_and_load';
  /** Seconds each run sent load (requests over throughput); null when a side has no figure. */
  readonly durationsS: { readonly other: number; readonly run: number } | null;
  /** The durations differ by more than 10%: throughput is shown but not assessed. */
  readonly lastedDifferently: boolean;
  readonly comparable: boolean | null;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
  readonly workload: 'same' | 'different' | 'unknown';
  readonly sameEnvironment: boolean | null;
  /** The environment each run's manifest names (null: none recorded); null when none is known. */
  readonly environments: { readonly other: string | null; readonly run: string | null } | null;
  readonly metrics: readonly MetricRow[];
  readonly better: number;
  readonly worse: number;
  readonly errors?: CompareErrors;
}

/** The rows the view shows, in this order (the data has all twelve). */
const SHOWN: readonly MetricKey[] = [
  'p50',
  'p75',
  'p90',
  'p95',
  'p99',
  'mean_response_time',
  'max_response_time',
  'ko_count',
  'requests_per_second',
];

const NO_VALUE = '—';

/** A figure, or a dash for one the backend did not give (p75 of a Gatling report); a line says so. */
function figure(value: number | null, key: MetricKey, t: Translator): string {
  if (value === null) return NO_VALUE;
  return key === 'requests_per_second' ? decimal(value, 1, t.locale) : num(value, t.locale);
}

/** The shown rows that have no figure on a side, in table order. */
function unmeasured(data: CompareData): MetricKey[] {
  return SHOWN.filter((key) => {
    const row = data.metrics.find((one) => one.key === key);
    return row !== undefined && (row.other === null || row.run === null);
  });
}

/** `11:25`, minutes and seconds. */
function minutes(seconds: number): string {
  const whole = Math.round(seconds);
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
}

function change(row: MetricRow, t: Translator): string {
  if (row.deltaPct === null) return NO_VALUE;
  const sign = row.deltaPct > 0 ? '+' : '';
  const pct = `${sign}${decimal(row.deltaPct, 1, t.locale)}%`;
  return row.judgement === null
    ? pct
    : `${pct} ${t(`results_compare_runs.judgement.${row.judgement}`)}`;
}

function table(data: CompareData, t: Translator): string[] {
  const byKey = new Map(data.metrics.map((row) => [row.key, row] as const));
  const rows: string[][] = [t('results_compare_runs.columns').split('|')];
  for (const key of SHOWN) {
    const row = byKey.get(key);
    if (row === undefined) continue;
    rows.push([
      t(`results_compare_runs.metric.${key}`),
      figure(row.other, key, t),
      figure(row.run, key, t),
      change(row, t),
    ]);
  }
  return columns(rows, { align: ['left', 'right', 'right', 'left'] });
}

function comparableLines(data: CompareData, t: Translator): string[] {
  if (data.comparable === true) return [t('results_compare_runs.comparable.yes')];
  if (data.comparable === null) {
    return [
      t('results_compare_runs.comparable.unknown', {
        what: t('results_compare_runs.unknown.workload'),
      }),
    ];
  }
  const reasons =
    data.reasons.length > 0 ? data.reasons.join('; ') : t('results_compare_runs.reason.workload');
  return [
    t('results_compare_runs.comparable.no', { reasons }),
    t('results_compare_runs.figuresOnly'),
  ];
}

function errorLines(errors: CompareErrors, data: CompareData, t: Translator): string[] {
  const { locale } = t;
  const lines: string[] = [];
  if (errors.onlyRun.length > 0) {
    lines.push(
      t('results_compare_runs.errors.onlyRun', {
        run: data.run,
        count: num(errors.totals.onlyRun, locale),
      }),
    );
    for (const row of errors.onlyRun) {
      lines.push(
        t('results_compare_runs.errors.row', {
          count: num(row.count, locale),
          message: row.message,
        }),
      );
    }
  }
  if (errors.onlyOther.length > 0) {
    lines.push(
      t('results_compare_runs.errors.onlyOther', {
        other: data.other,
        count: num(errors.totals.onlyOther, locale),
      }),
    );
    for (const row of errors.onlyOther) {
      lines.push(
        t('results_compare_runs.errors.row', {
          count: num(row.count, locale),
          message: row.message,
        }),
      );
    }
  }
  if (errors.common.length > 0) {
    lines.push(
      t('results_compare_runs.errors.common', { count: num(errors.totals.common, locale) }),
    );
    for (const row of errors.common) {
      lines.push(
        t('results_compare_runs.errors.rowCommon', {
          countOther: num(row.countOther, locale),
          countRun: num(row.countRun, locale),
          message: row.message,
        }),
      );
    }
  }
  if (lines.length === 0) lines.push(t('results_compare_runs.errors.none'));
  return lines;
}

function environmentLines(data: CompareData, t: Translator): string[] {
  const { environments } = data;
  if (data.sameEnvironment === null) return [t('results_compare_runs.environment.unknown')];
  if (environments?.other == null || environments.run == null) {
    return data.sameEnvironment ? [] : [t('results_compare_runs.environment.differs')];
  }
  return [
    data.sameEnvironment
      ? t('results_compare_runs.environment.same', { name: environments.run })
      : t('results_compare_runs.environment.differs.named', {
          other: environments.other,
          run: environments.run,
        }),
  ];
}

export function renderCompareRuns(
  data: CompareData,
  t: Translator,
  args: { readonly include?: readonly string[] | undefined },
): string {
  const lines = [
    t(data.baseline ? 'results_compare_runs.header.baseline' : 'results_compare_runs.header', {
      run: data.run,
      other: data.other,
    }),
    ...comparableLines(data, t),
  ];
  if (data.baseline) lines.push(t('results_compare_runs.baseline.source'));
  lines.push(...environmentLines(data, t));
  if (data.lastedDifferently && data.durationsS !== null) {
    lines.push(
      t('results_compare_runs.durations', {
        was: minutes(data.durationsS.other),
        is: minutes(data.durationsS.run),
      }),
    );
  }
  for (const text of data.warnings) lines.push(t('results_compare_runs.warning', { text }));
  lines.push(...table(data, t));
  const missing = unmeasured(data);
  if (missing.length > 0) {
    lines.push(
      t('results_compare_runs.notMeasured', {
        metrics: missing.map((key) => t(`results_compare_runs.metric.${key}`)).join(', '),
      }),
    );
  }
  if (data.lastedDifferently) lines.push(t('results_compare_runs.rps.notAssessed'));
  if (data.comparable !== false) {
    lines.push(
      t('results_compare_runs.summary', {
        better: num(data.better, t.locale),
        worse: num(data.worse, t.locale),
      }),
    );
  }
  if (args.include?.includes('errors') === true && data.errors !== undefined) {
    lines.push(...errorLines(data.errors, data, t));
  } else {
    lines.push(t('results_compare_runs.next.errors'));
  }
  lines.push(t('results_compare_runs.next.data'));
  return lines.join('\n');
}
