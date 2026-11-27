// The view of `functional_get_analytics`: how well the validators of a project did over N days, as
// the dashboard, the flaky validators, the failure patterns, the accuracy or the trend of one
// validator, or the suggested threshold of one. Rates arrive as the backend gives them (fractions of
// one) and are shown as percent. Names, messages, evidence and rationale are texts a person or the
// target wrote: they arrive in the data masked and made one line.

import type { Translator } from '../../context.js';
import { columns, decimal, keyValue, num, percent } from '../primitives.js';

export type AnalyticsView =
  'dashboard' | 'flaky' | 'failure_patterns' | 'accuracy' | 'trend' | 'threshold_suggestion';

export interface FlakyRow {
  readonly validatorId: string;
  readonly name: string;
  readonly score: number;
  readonly passRateVariance: number;
  readonly sampleSize: number;
  readonly recommendation: string;
  readonly evidence: readonly string[];
}

export interface PatternRow {
  readonly type: string;
  readonly value: string;
  readonly failures: number;
  readonly failureRate: number;
  readonly correlation: number;
  readonly samples: readonly string[];
}

export interface AccuracyReport {
  readonly validatorId: string;
  readonly name: string;
  readonly type: string;
  readonly executions: number;
  readonly passes: number;
  readonly fails: number;
  readonly passRate: number;
  readonly retryRate: number;
  readonly avgConfidence: number | null;
  readonly avgDurationMs: number | null;
  readonly failureReasons: readonly string[];
  readonly suggestedActions: readonly string[];
}

export interface TrendPoint {
  readonly date: string;
  readonly passRate: number;
  readonly executions: number;
  readonly confidence: number | null;
}

export interface Summary {
  readonly validators: number;
  readonly executions: number;
  readonly passRate: number | null;
  readonly flaky: number;
  readonly ai: number;
  readonly avgAiConfidence: number | null;
  /** Where the figures come from and what they leave out. */
  readonly coverage: {
    readonly measured: boolean;
    readonly source: string;
    readonly excludes: readonly string[];
  } | null;
}

export interface AnalyticsData {
  readonly view: AnalyticsView;
  readonly days: number;
  /** The validator the view is about (accuracy, trend, threshold), by id. */
  readonly validatorId: string | null;
  /** What the log entry names: the view. */
  readonly count: number;
  readonly summary: Summary | null;
  readonly flaky: readonly FlakyRow[];
  readonly patterns: readonly PatternRow[];
  readonly accuracy: readonly AccuracyReport[];
  readonly trend: {
    readonly name: string;
    readonly direction: string;
    readonly points: readonly TrendPoint[];
    readonly pointCount: number;
  } | null;
  readonly threshold: {
    readonly current: number | null;
    readonly suggested: number;
    readonly rationale: string;
    readonly impact: readonly { readonly key: string; readonly value: number }[];
  } | null;
}

const pct = (value: number, t: Translator): string => percent(value * 100, 1, t.locale);

function flakyLines(rows: readonly FlakyRow[], t: Translator): string[] {
  if (rows.length === 0) return [t('functional_get_analytics.flaky.none')];
  const lines = [t.plural('functional_get_analytics.flaky', rows.length)];
  for (const row of rows) {
    lines.push(
      `  ${row.name}  ${t('functional_get_analytics.flaky.score', {
        score: decimal(row.score, 2, t.locale),
        sample: num(row.sampleSize, t.locale),
      })}: ${row.recommendation}`,
    );
    for (const evidence of row.evidence) lines.push(`    - ${evidence}`);
  }
  return lines;
}

function patternLines(rows: readonly PatternRow[], t: Translator): string[] {
  if (rows.length === 0) return [t('functional_get_analytics.patterns.none')];
  const lines = [t.plural('functional_get_analytics.patterns', rows.length)];
  for (const row of rows) {
    lines.push(
      `  ${row.type}: ${row.value}  ${t('functional_get_analytics.patterns.figures', {
        failures: num(row.failures, t.locale),
        rate: pct(row.failureRate, t),
        correlation: decimal(row.correlation, 2, t.locale),
      })}`,
    );
    for (const sample of row.samples) lines.push(`    - ${sample}`);
  }
  return lines;
}

function accuracyLines(rows: readonly AccuracyReport[], t: Translator): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    const items: [string, string][] = [
      [t('functional_get_analytics.label.executions'), num(row.executions, t.locale)],
      [
        t('functional_get_analytics.label.pass_rate'),
        `${pct(row.passRate, t)} (${num(row.passes, t.locale)} / ${num(row.fails, t.locale)})`,
      ],
      [t('functional_get_analytics.label.retry_rate'), decimal(row.retryRate, 2, t.locale)],
    ];
    if (row.avgConfidence !== null) {
      items.push([
        t('functional_get_analytics.label.confidence'),
        decimal(row.avgConfidence, 2, t.locale),
      ]);
    }
    if (row.avgDurationMs !== null) {
      items.push([
        t('functional_get_analytics.label.duration'),
        `${num(Math.round(row.avgDurationMs), t.locale)} ms`,
      ]);
    }
    lines.push(
      t('functional_get_analytics.accuracy', { name: row.name, type: row.type }),
      ...keyValue(items),
    );
    if (row.failureReasons.length > 0) {
      lines.push(
        t('functional_get_analytics.reasons'),
        ...row.failureReasons.map((reason) => `  - ${reason}`),
      );
    }
    if (row.suggestedActions.length > 0) {
      lines.push(
        t('functional_get_analytics.actions'),
        ...row.suggestedActions.map((action) => `  - ${action}`),
      );
    }
  }
  return lines;
}

export function renderGetAnalytics(data: AnalyticsData, t: Translator): string {
  switch (data.view) {
    case 'flaky':
      return flakyLines(data.flaky, t).join('\n');
    case 'failure_patterns':
      return patternLines(data.patterns, t).join('\n');
    case 'accuracy':
      return data.accuracy.length === 0
        ? t('functional_get_analytics.accuracy.none', { days: data.days })
        : accuracyLines(data.accuracy, t).join('\n');
    case 'trend': {
      const trend = data.trend;
      if (trend === null || trend.points.length === 0)
        return t('functional_get_analytics.trend.none');
      const lines = [
        t('functional_get_analytics.trend', {
          name: trend.name,
          direction: trend.direction,
          days: data.days,
        }),
        ...columns(
          trend.points.map((point) => [
            point.date.slice(0, 10),
            pct(point.passRate, t),
            t('functional_get_analytics.trend.executions', {
              count: num(point.executions, t.locale),
            }),
          ]),
        ).map((row) => `  ${row}`),
      ];
      if (trend.points.length < trend.pointCount) {
        lines.push(
          t('functional_get_analytics.more', {
            shown: trend.points.length,
            total: trend.pointCount,
          }),
        );
      }
      return lines.join('\n');
    }
    case 'threshold_suggestion': {
      const threshold = data.threshold;
      if (threshold === null) return t('functional_get_analytics.threshold.none');
      const lines = [
        t('functional_get_analytics.threshold', {
          suggested: decimal(threshold.suggested, 2, t.locale),
          current: threshold.current === null ? '—' : decimal(threshold.current, 2, t.locale),
        }),
        threshold.rationale,
      ];
      for (const item of threshold.impact) {
        lines.push(`  ${item.key}: ${decimal(item.value, 2, t.locale)}`);
      }
      return lines.join('\n');
    }
    case 'dashboard': {
      const { summary } = data;
      if (summary === null) return t('functional_get_analytics.dashboard.none');
      const rows: [string, string][] = [
        [t('functional_get_analytics.label.validators'), num(summary.validators, t.locale)],
        [t('functional_get_analytics.label.executions'), num(summary.executions, t.locale)],
        [
          t('functional_get_analytics.label.pass_rate'),
          summary.passRate === null
            ? t('functional_get_analytics.not_measured')
            : pct(summary.passRate, t),
        ],
        [t('functional_get_analytics.label.flaky'), num(summary.flaky, t.locale)],
        [t('functional_get_analytics.label.ai'), num(summary.ai, t.locale)],
      ];
      if (summary.avgAiConfidence !== null) {
        rows.push([
          t('functional_get_analytics.label.confidence'),
          decimal(summary.avgAiConfidence, 2, t.locale),
        ]);
      }
      const lines = [
        t('functional_get_analytics.dashboard', { days: data.days }),
        ...keyValue(rows),
      ];
      if (summary.coverage !== null) {
        lines.push(
          t(
            summary.coverage.measured
              ? 'functional_get_analytics.coverage'
              : 'functional_get_analytics.coverage.no',
            {
              source: summary.coverage.source,
            },
          ),
        );
        if (summary.coverage.excludes.length > 0) {
          lines.push(
            t('functional_get_analytics.excludes', { list: summary.coverage.excludes.join(', ') }),
          );
        }
      }
      if (data.flaky.length > 0) lines.push(...flakyLines(data.flaky, t));
      if (data.patterns.length > 0) lines.push(...patternLines(data.patterns, t));
      return lines.join('\n');
    }
  }
}
