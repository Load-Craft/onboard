// The view of `project_get_activity`: the latest events across the caller's projects (a project or a
// flow made, a run that ended) and the runs in progress. Names are texts a person wrote: they arrive in
// the data masked and made one line.

import type { Translator } from '../../context.js';
import { columns, decimal, num, percent } from '../primitives.js';

export interface ActivityEvent {
  readonly id: string;
  /** `project`, `flow`, `gatling_execution`, `functional_execution`, or the word the backend gave. */
  readonly type: string;
  readonly at: string;
  readonly project: string | null;
  readonly projectId: string | null;
  /** The project, flow or run the event is about; a run by its handle. */
  readonly entity: string | null;
  readonly entityId: string | null;
  /** The handle (`e-1a2b3c4d`) of a load run the event is about; null for any other event. */
  readonly run: string | null;
  /** The status the event carries for a run (`completed`, `failed`, …), else null. */
  readonly status: string | null;
  readonly exitCode: number | null;
  /** The verdict on the thresholds of a load run, when it has one. */
  readonly sla: 'passed' | 'failed' | 'refused' | null;
  readonly hasErrors: boolean | null;
}

export interface RunningRun {
  /** The handle of the run (`e-1a2b3c4d`) and its UUID. */
  readonly run: string;
  readonly run_id: string;
  readonly project: string;
  readonly projectId: string;
  readonly scenario: string;
  readonly status: string;
  /** 0-100, as the backend estimates it. */
  readonly progress: number;
  readonly startedAt: string;
  readonly estimatedCompletionAt: string | null;
  readonly rps: number | null;
  /** Failed requests over all requests, in percent as the backend gives it. */
  readonly errorRate: number | null;
  /** Whether this server process drives the run: false for a run that was abandoned. */
  readonly supervised: boolean;
}

export interface ActivityData {
  /** The events the backend returned (at most `limit`) and the runs in progress (the log slots). */
  readonly events: number;
  readonly running: number;
  readonly limit: number;
  readonly items: readonly ActivityEvent[];
  readonly runs: readonly RunningRun[];
}

const minute = (at: string): string =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.exec(at)?.[0].replace('T', ' ') ?? at;

export function renderGetActivity(data: ActivityData, t: Translator): string {
  const lines: string[] = [];
  if (data.running === 0) {
    lines.push(t('project_get_activity.running.none'));
  } else {
    lines.push(t.plural('project_get_activity.running', data.running));
    lines.push(
      ...columns(
        data.runs.map((run) => [
          run.run,
          run.project,
          run.scenario,
          `${t(`run.status.${run.status}`)} ${num(Math.round(run.progress), t.locale)}%`,
          run.rps === null ? '' : `${decimal(run.rps, 1, t.locale)} req/s`,
          run.errorRate === null ? '' : `KO ${percent(run.errorRate, 1, t.locale)}`,
        ]),
      ).map((row) => `  ${row}`),
    );
    for (const run of data.runs.filter((item) => !item.supervised)) {
      lines.push(t('project_get_activity.abandoned', { run: run.run }));
    }
  }
  if (data.events === 0) {
    lines.push(t('project_get_activity.events.none'));
  } else {
    lines.push(t.plural('project_get_activity.events', data.events));
    lines.push(
      ...columns(
        data.items.map((event) => [
          minute(event.at),
          t(`project_get_activity.type.${event.type}`),
          [event.run, event.entity].filter((part) => part !== null).join(' ') || '—',
          event.project ?? '—',
          [
            event.status,
            event.sla === null ? null : `SLA ${t(`project_get_activity.sla.${event.sla}`)}`,
          ]
            .filter((part): part is string => part !== null)
            .join(' · '),
        ]),
      ).map((row) => `  ${row}`),
    );
  }
  return lines.join('\n');
}
