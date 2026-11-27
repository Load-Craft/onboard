// The view of `results_check_production`: the load a production-replay run started against its plan,
// the series the plan was fitted to and the think-time verdict. Labels of sites arrive masked and
// made one line by the tool (`content`); the codes of the backend are shown only when they are one of
// the contract's.

import type { Translator } from '../../context.js';
import { clock, decimal, num } from '../primitives.js';

/** Why the backend gives no verdict on the load; `other` for a code the contract does not list. */
export type LoadReason =
  | 'series_absent'
  | 'session_starts_not_emitted'
  | 'injection_start_unknown'
  | 'injection_start_inconsistent'
  | 'session_starts_gap'
  | 'metrics_backend_unreachable'
  | 'run_not_finished'
  | 'other';

export type ProductionSeries =
  'present' | 'snapshot_not_found' | 'snapshot_artifact_missing' | 'snapshot_changed';

export interface WorstStep {
  readonly k: number;
  readonly planned: number;
  readonly actualLo: number;
  readonly actualHi: number;
}

export interface LoadData {
  readonly passed: boolean | null;
  readonly reason: LoadReason | null;
  readonly planned: number;
  readonly actual: number | null;
  readonly achievedPct: number | null;
  readonly tolerance: number | null;
  readonly steps: { readonly total: number; readonly passed: number; readonly failed: number };
  readonly worst?: WorstStep;
}

export interface OffPlanSite {
  readonly label: string;
  readonly status: 'shorter_than_plan' | 'longer_than_plan';
  readonly worstEdgeMs: number | null;
}

export type ThinkData =
  | {
      readonly state: 'read';
      readonly passed: boolean | null;
      readonly code: string;
      readonly source: string | null;
      readonly coverage: {
        readonly total: number;
        readonly production: number;
        readonly judged: number;
        readonly excluded: number;
      };
      readonly offPlan: readonly OffPlanSite[];
      readonly moreOffPlan: number;
    }
  | { readonly state: 'unavailable'; readonly status: number };

export interface ProductionData {
  readonly run: string;
  readonly run_id: string;
  readonly load: LoadData;
  readonly plan: {
    readonly steps: number;
    readonly totalUsers: number;
    readonly durationS: number;
    readonly scale: number;
  };
  readonly productionSeries: ProductionSeries;
  readonly seriesSource: string;
  readonly retention: string | null;
  readonly think: ThinkData;
}

function loadLines(load: LoadData, t: Translator): string[] {
  const { locale } = t;
  if (load.passed === null) {
    return [t('results_check_production.load.notJudged', { reason: load.reason ?? 'other' })];
  }
  const lines = [
    t(
      load.passed ? 'results_check_production.load.passed' : 'results_check_production.load.failed',
      {
        actual: load.actual === null ? '?' : num(load.actual, locale),
        planned: num(load.planned, locale),
        pct: load.achievedPct === null ? '?' : decimal(load.achievedPct, 1, locale),
        tolerance: load.tolerance === null ? '?' : decimal(load.tolerance, 0, locale),
      },
    ),
  ];
  if (load.steps.total > 0) {
    let steps = t('results_check_production.steps', {
      passed: num(load.steps.passed, locale),
      total: num(load.steps.total, locale),
    });
    if (load.worst !== undefined) {
      steps += t('results_check_production.steps.worst', {
        k: num(load.worst.k, locale),
        planned: num(load.worst.planned, locale),
        lo: num(load.worst.actualLo, locale),
        hi: num(load.worst.actualHi, locale),
      });
    }
    lines.push(steps);
  }
  return lines;
}

function thinkLines(think: ThinkData, t: Translator): string[] {
  const { locale } = t;
  if (think.state === 'unavailable') return [t('results_check_production.think.unavailable')];
  if (think.passed === null) {
    return [t('results_check_production.think.notJudged', { code: think.code })];
  }
  const lines = [
    t(
      think.passed
        ? 'results_check_production.think.within'
        : 'results_check_production.think.outside',
      {
        judged: num(think.coverage.judged, locale),
        total: num(think.coverage.total, locale),
        source: think.source ?? 'unknown',
      },
    ),
  ];
  for (const site of think.offPlan) {
    const status = t(`results_check_production.site.${site.status}`);
    lines.push(
      site.worstEdgeMs === null
        ? t('results_check_production.site.noEdge', { label: site.label, status })
        : t('results_check_production.site', {
            label: site.label,
            status,
            ms: num(site.worstEdgeMs, locale),
          }),
    );
  }
  if (think.moreOffPlan > 0) {
    lines.push(t('results_check_production.site.more', { count: num(think.moreOffPlan, locale) }));
  }
  return lines;
}

export function renderCheckProduction(data: ProductionData, t: Translator): string {
  const { locale } = t;
  const lines = [t('results_check_production.header', { run: data.run })];
  lines.push(...loadLines(data.load, t));
  lines.push(
    t('results_check_production.plan', {
      steps: num(data.plan.steps, locale),
      users: num(data.plan.totalUsers, locale),
      duration: clock(data.plan.durationS),
      scale: decimal(data.plan.scale, 2, locale),
    }),
  );
  if (data.productionSeries !== 'present') {
    lines.push(t(`results_check_production.series.${data.productionSeries}`));
  }
  lines.push(...thinkLines(data.think, t));
  return lines.join('\n');
}
