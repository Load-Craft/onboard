// The view of `run_list`: the project's runs, newest first, one line each: when, state, where, how
// much and how it ended; with the headline results of the runs that have them when asked. Texts of
// the backend arrive in the data masked and made one line.

import type { Translator } from '../../context.js';
import { columns, decimal, ms, num } from '../primitives.js';
import type { RunStatus } from './types.js';

export interface RunHeadline {
  readonly p95Ms: number | null;
  readonly meanMs: number | null;
  readonly rps: number | null;
}

export interface RunRow {
  /** The handle of the run (`e-1a2b3c4d`) and its UUID. */
  readonly run: string;
  readonly run_id: string;
  readonly status: RunStatus;
  readonly source: 'manual' | 'saved_run' | 'scheduled' | 'self_check' | null;
  readonly createdAt: string | null;
  readonly durationS: number | null;
  readonly targetKind: 'scenario' | 'composition' | null;
  readonly targetId: string | null;
  readonly environment: string | null;
  readonly savedRun: string | null;
  readonly requests: number | null;
  readonly ko: number | null;
  readonly sla: 'passed' | 'failed' | 'refused' | null;
  readonly errorMessage: string | null;
  /** Present when `include` asked for results: null for a run without a stored result. */
  readonly headline?: RunHeadline | null;
}

export interface RunListData {
  readonly project_id: string;
  /** The runs the backend returned (at most `limit`), and how many the data lists. */
  readonly count: number;
  readonly shown: number;
  readonly limit: number;
  /** The scenario or composition the list was narrowed to, by name. */
  readonly target: string | null;
  readonly items: readonly RunRow[];
  /** `include` asked for results; false when the read of them failed. */
  readonly resultsIncluded: boolean;
  readonly resultsAvailable: boolean;
}

const minute = (at: string | null): string =>
  at === null ? '—' : (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.exec(at)?.[0].replace('T', ' ') ?? at);

function headlineOf(row: RunRow, t: Translator): string | null {
  const h = row.headline;
  if (h === undefined || h === null) return null;
  const parts = [
    h.p95Ms === null ? null : `p95 ${ms(h.p95Ms, t.locale)}`,
    h.rps === null ? null : `${decimal(h.rps, 1, t.locale)} req/s`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** The second line of a run: what it counted, how its thresholds ended, its headline results. */
function figuresOf(row: RunRow, t: Translator): string {
  const parts: string[] = [];
  if (row.requests !== null) {
    parts.push(`${num(row.requests, t.locale)} req · ${num(row.ko ?? 0, t.locale)} KO`);
  }
  if (row.sla !== null) parts.push(`SLA ${t(`run_list.sla.${row.sla}`)}`);
  const headline = headlineOf(row, t);
  if (headline !== null) parts.push(headline);
  return parts.length === 0 ? t('run_list.nofigures') : parts.join(' · ');
}

export function renderList(data: RunListData, t: Translator): string {
  if (data.count === 0) {
    return data.target === null
      ? t('run_list.none')
      : t('run_list.none.target', { target: data.target });
  }
  const lines = [
    data.target === null
      ? t.plural('run_list.header', data.count)
      : t.plural('run_list.header.target', data.count, { target: data.target }),
  ];
  const head = columns(
    data.items.map((row) => [
      row.run,
      minute(row.createdAt),
      t(`run.status.${row.status}`),
      row.environment ?? '—',
    ]),
  );
  data.items.forEach((row, index) => {
    lines.push(`  ${head[index] ?? row.run}`, `    ${figuresOf(row, t)}`);
  });
  const failed = data.items.filter((row) => row.errorMessage !== null);
  for (const row of failed.slice(0, 3)) {
    lines.push(t('run_list.error', { run: row.run, error: row.errorMessage ?? '' }));
  }
  if (data.resultsIncluded && !data.resultsAvailable) lines.push(t('run_list.results.unavailable'));
  if (data.shown < data.count) {
    lines.push(t('run_list.more', { shown: data.shown, total: data.count }));
  }
  if (data.count >= data.limit) lines.push(t('run_list.limit', { limit: data.limit }));
  return lines.join('\n');
}
