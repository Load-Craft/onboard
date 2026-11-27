// The view of `results_get_logs`: one line per log line, its time of day (UTC) and its text, then a
// line that marks them as data. The texts arrive masked and made one line by the tool (`content` of
// tools/moduleCall.ts); the labels of the log streams are not in the data at all.

import type { Translator } from '../../context.js';
import { num } from '../primitives.js';

/** Where the samples of the run stand (`series_source`); a value the view does not know is `other`. */
export type LogsSeriesSource =
  'prometheus' | 'absent_retention' | 'absent_unmeasured' | 'metrics_backend_unreachable' | 'other';

/**
 * Whether the log store still holds the run's window (`logs_source`): `loki` (within its retention,
 * or none known), `partial_retention` (the first lines are deleted), `absent_retention` (every line
 * is deleted); a value the view does not know is `other`.
 */
export type LogsStoreSource = 'loki' | 'partial_retention' | 'absent_retention' | 'other';

export interface LogLine {
  /** The instant of the line (ISO 8601); null when the backend's timestamp is no instant. */
  readonly at: string | null;
  readonly text: string;
}

export interface LogsData {
  /** The handle of the run (`e-1a2b3c4d`) and its UUID. */
  readonly run: string;
  readonly run_id: string;
  readonly level: 'error' | 'warn' | 'info' | 'debug' | null;
  readonly limit: number;
  readonly lines: readonly LogLine[];
  readonly count: number;
  readonly seriesSource: LogsSeriesSource;
  readonly retention: string | null;
  /** Where the log store stands on the run's window, and how long it keeps lines (null: unknown). */
  readonly logsSource: LogsStoreSource;
  readonly logsRetention: string | null;
  /** Whether the read was the run's own window; false for a run that never started (last hour). */
  readonly runWindow: boolean;
}

const NO_TIME = '--:--:--';

/** `HH:MM:SS` of an ISO instant, in UTC. */
function timeOf(at: string | null): string {
  if (at === null) return NO_TIME;
  const time = /T(\d{2}:\d{2}:\d{2})/u.exec(at)?.[1];
  return time ?? NO_TIME;
}

/** Why a run shows no line: deleted by the store, no start to read from, or nothing logged. */
function emptyOf(data: LogsData, t: Translator): string {
  const params = { run: data.run, level: data.level ?? '', retention: data.logsRetention ?? '?' };
  const why =
    data.logsSource === 'absent_retention'
      ? 'deleted'
      : data.logsSource === 'partial_retention'
        ? 'partly_deleted'
        : data.runWindow
          ? 'silent'
          : 'unstarted';
  return t(`results_get_logs.empty.${why}${data.level === null ? '' : '.level'}`, params);
}

export function renderGetLogs(data: LogsData, t: Translator): string {
  const run = data.run;
  if (data.count === 0) return emptyOf(data, t);
  const counts = { run, count: num(data.count, t.locale), limit: num(data.limit, t.locale) };
  const lines = [
    data.level === null
      ? t('results_get_logs.header', counts)
      : t('results_get_logs.header.level', { ...counts, level: data.level }),
  ];
  for (const line of data.lines) {
    lines.push(t('results_get_logs.line', { time: timeOf(line.at), text: line.text }));
  }
  if (data.logsSource === 'partial_retention') {
    lines.push(t('results_get_logs.partly_deleted', { retention: data.logsRetention ?? '?' }));
  }
  lines.push(t('results_get_logs.footer'));
  if (data.count >= data.limit) lines.push(t('results_get_logs.more'));
  return lines.join('\n');
}
