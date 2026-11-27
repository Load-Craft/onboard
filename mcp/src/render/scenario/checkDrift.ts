// The views of `scenario_check_drift`: the card (what will be compared with what and what it costs), the
// progress of the check while it runs, and the result (the staleness score and the drift report). The
// texts arrive made one line and masked by the tool (`content` of tools/moduleCall.ts); the view adds
// no text of the backend of its own.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { decimal } from '../primitives.js';
import { momentOf } from './moment.js';

export type ReferenceSource = 'har' | 'openapi';

/** What the card shows and is bound to: the same on every call for the same scenario and reference. */
export interface DriftFacts {
  readonly scenario_id: string;
  readonly name: string;
  readonly reference_source: ReferenceSource;
  readonly reference_id: string;
}

export interface DriftedEndpoint {
  readonly method: string;
  readonly path: string;
  readonly status: 'modified' | 'removed';
  readonly details: readonly string[];
}

export interface ParameterDrift {
  readonly endpoint: string;
  readonly param: string;
  readonly location: 'query' | 'header' | 'body';
  readonly change: string;
}

/** The report of the `complete` frame; absent when the result was read from the cache of the score. */
export interface DriftReport {
  /** Endpoints of the scenario the reference still has unchanged, and the ones that changed or are gone. */
  readonly current: number;
  readonly drifted_total: number;
  readonly drifted: readonly DriftedEndpoint[];
  readonly parameter_drifts_total: number;
  readonly parameter_drifts: readonly ParameterDrift[];
  readonly recommendations: readonly string[];
  readonly uncovered_total: number;
  readonly uncovered: readonly string[];
}

export interface DriftData {
  readonly scenario_id: string;
  readonly name: string;
  readonly reference_source: ReferenceSource;
  readonly reference_id: string;
  /** 0 current to 1 stale, as the backend gave it. */
  readonly score: number;
  readonly checked_at: string | null;
  readonly report: DriftReport | null;
}

export function cardViewCheckDrift(facts: DriftFacts, t: Translator): CardView {
  return {
    title: t('scenario_check_drift.card.title', { name: facts.name }),
    lines: [
      t('scenario_check_drift.card.scenario', { name: facts.name, id: facts.scenario_id }),
      t(`scenario_check_drift.card.reference.${facts.reference_source}`, {
        id: facts.reference_id,
      }),
    ],
    cost: t('scenario_check_drift.card.cost'),
    undo: t('scenario_check_drift.card.undo'),
  };
}

/** The nodes of the backend's check, the only values the progress line takes from it. */
const NODES = ['extract_endpoints', 'compare', 'recommend'] as const;
export type DriftNode = (typeof NODES)[number];

export function isDriftNode(value: string): value is DriftNode {
  return (NODES as readonly string[]).includes(value);
}

export function renderDriftProgress(
  progress: { readonly node: DriftNode | null; readonly percent: number },
  t: Translator,
): string {
  return progress.node === null
    ? t('scenario_check_drift.progress.start')
    : t('scenario_check_drift.progress.step', {
        step: t(`scenario_check_drift.node.${progress.node}`),
        percent: Math.round(progress.percent),
      });
}

export function renderCheckDrift(data: DriftData, t: Translator): string {
  const lines = [
    t('scenario_check_drift.result', {
      name: data.name,
      score: decimal(data.score, 2, t.locale),
      at: data.checked_at === null ? '-' : momentOf(data.checked_at),
    }),
    t('scenario_check_drift.reference', {
      kind: t(`scenario_check_drift.source.${data.reference_source}`),
      id: data.reference_id,
    }),
  ];
  const report = data.report;
  if (report === null) {
    lines.push(t('scenario_check_drift.no_report'));
    return lines.join('\n');
  }
  lines.push(
    t('scenario_check_drift.summary', {
      current: report.current,
      drifted: report.drifted_total,
      parameters: report.parameter_drifts_total,
      uncovered: report.uncovered_total,
    }),
  );
  for (const endpoint of report.drifted) {
    lines.push(
      `  ${endpoint.method} ${endpoint.path}: ${t(`scenario_check_drift.status.${endpoint.status}`)}` +
        (endpoint.details.length === 0 ? '' : ` (${endpoint.details.join('; ')})`),
    );
  }
  for (const drift of report.parameter_drifts) {
    lines.push(
      `  ${drift.endpoint} ${t(`scenario_check_drift.location.${drift.location}`)} ${drift.param}: ${drift.change}`,
    );
  }
  if (report.drifted_total > report.drifted.length) {
    lines.push(
      t('scenario_check_drift.more_endpoints', {
        count: report.drifted_total - report.drifted.length,
      }),
    );
  }
  if (report.recommendations.length > 0) {
    lines.push(t('scenario_check_drift.recommendations'));
    for (const text of report.recommendations) lines.push(`  - ${text}`);
  }
  if (report.uncovered.length > 0) {
    lines.push(t('scenario_check_drift.uncovered', { count: report.uncovered_total }));
    for (const path of report.uncovered) lines.push(`  ${path}`);
  }
  return lines.join('\n');
}
