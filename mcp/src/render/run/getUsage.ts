// The view of `run_get_usage`: the finished runs of the last days, newest first, and the compute
// time of the project's runs. Texts of the backend are in the data already made one line.

import type { Translator } from '../../context.js';
import { columns, decimal, num, percent } from '../primitives.js';

export interface UsageRun {
  /** The handle of the run (`e-1a2b3c4d`) and its UUID. */
  readonly run: string;
  readonly run_id: string;
  readonly at: string;
  readonly status: 'completed' | 'failed' | 'cancelled';
  /** The measured load window in seconds; null when unmeasured. */
  readonly durationS: number | null;
  /** Failed requests over all requests, 0..1 as the backend gives it. */
  readonly errorRate: number;
  readonly backend: string;
}

export interface UsageData {
  readonly project_id: string;
  readonly days: number;
  /** Finished runs the period holds, and how many of them the data lists. */
  readonly count: number;
  readonly shown: number;
  readonly items: readonly UsageRun[];
  /** Sum of created→completed of the project's runs, build included; null when it was not read. */
  readonly totalBurnSeconds: number | null;
  readonly measuredRuns: number | null;
}

const MINUTE = 60;

/** Compute minutes with one decimal. */
export function computeMinutes(totalBurnSeconds: number): number {
  return Math.round((totalBurnSeconds / MINUTE) * 10) / 10;
}

function dayOf(at: string): string {
  return /^\d{4}-\d{2}-\d{2}/u.exec(at)?.[0] ?? at;
}

export function renderGetUsage(data: UsageData, t: Translator): string {
  const lines = [
    data.count === 0
      ? t('run_get_usage.header.none', { days: data.days })
      : t.plural('run_get_usage.header', data.count, { days: data.days }),
  ];
  if (data.count > 0) {
    lines.push(
      ...columns(
        data.items.map((run) => [
          run.run,
          dayOf(run.at),
          t(`run.status.${run.status}`),
          run.durationS === null ? '—' : `${num(Math.round(run.durationS), t.locale)} s`,
          percent(run.errorRate * 100, 1, t.locale),
        ]),
        { align: ['left', 'left', 'left', 'right', 'right'] },
      ).map((row) => `  ${row}`),
    );
    if (data.shown < data.count) {
      lines.push(t('run_get_usage.more', { shown: data.shown, total: data.count }));
    }
  }
  lines.push(
    data.totalBurnSeconds === null
      ? t('run_get_usage.compute.unavailable')
      : t('run_get_usage.compute', {
          minutes: decimal(computeMinutes(data.totalBurnSeconds), 1, t.locale),
          runs: num(data.measuredRuns ?? 0, t.locale),
        }),
  );
  return lines.join('\n');
}
