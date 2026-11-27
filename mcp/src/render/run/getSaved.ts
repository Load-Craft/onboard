// The view of `run_get_saved`: the saved runs of the project with their schedules, one line each, or
// one saved run in full. Names, cron expressions, errors and slot names are texts of a third party:
// they arrive in the data masked and made one line.

import type { Translator } from '../../context.js';
import { columns, keyValue, num } from '../primitives.js';
import type { WorkloadView } from './types.js';

export interface SavedSchedule {
  readonly enabled: boolean;
  readonly cron: string | null;
  readonly paused: boolean;
  /** Paused by the backend after three scheduled runs in a row failed. */
  readonly autoPaused: boolean;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly consecutiveFailures: number;
  readonly lastError: string | null;
}

export interface SavedRow {
  readonly id: string;
  readonly name: string;
  readonly targetKind: 'scenario' | 'composition' | null;
  readonly targetId: string | null;
  readonly environmentId: string | null;
  readonly workload: WorkloadView | null;
  readonly schedule: SavedSchedule;
}

export type SlotState = 'pinned' | 'reconciled' | 'stale' | 'unknown';

export interface SavedDetail extends SavedRow {
  readonly targetBaseUrl: string | null;
  /** The handle of the run this saved run was made from (`e-1a2b3c4d`). */
  readonly sourceRun: string | null;
  readonly slots: readonly { readonly slot: string; readonly state: SlotState }[];
  readonly slotCount: number;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface SavedData {
  readonly project_id: string;
  readonly count: number;
  readonly shown: number;
  readonly items: readonly SavedRow[];
  /** Set when one saved run was asked for. */
  readonly saved: SavedDetail | null;
}

const day = (at: string | null): string =>
  at === null ? '—' : (/^\d{4}-\d{2}-\d{2}/u.exec(at)?.[0] ?? at);
const minute = (at: string): string =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.exec(at)?.[0].replace('T', ' ') ?? at;

function loadOf(workload: WorkloadView | null, t: Translator): string {
  if (workload === null) return t('run_get_saved.load.none');
  const users = workload.vusers === null ? '?' : num(workload.vusers, t.locale);
  return `${users} ${t('run_get_saved.users')}${workload.type === null ? '' : ` ${workload.type}`}`;
}

function scheduleOf(schedule: SavedSchedule, t: Translator): string {
  if (schedule.cron === null || !schedule.enabled) return t('run_get_saved.schedule.none');
  const state = schedule.autoPaused ? 'auto_paused' : schedule.paused ? 'paused' : 'active';
  return t(`run_get_saved.schedule.${state}`, { cron: schedule.cron });
}

export function renderGetSaved(data: SavedData, t: Translator): string {
  const { saved } = data;
  if (saved !== null) {
    const rows: [string, string][] = [
      [
        t('run_get_saved.label.target'),
        saved.targetKind === null || saved.targetId === null
          ? '—'
          : `${t(`run_get_saved.target.${saved.targetKind}`)} ${saved.targetId}`,
      ],
      [
        t('run_get_saved.label.environment'),
        saved.environmentId ?? t('run_get_saved.environment.default'),
      ],
      [t('run_get_saved.label.load'), loadOf(saved.workload, t)],
      [t('run_get_saved.label.schedule'), scheduleOf(saved.schedule, t)],
      [
        t('run_get_saved.label.next'),
        saved.schedule.nextRunAt === null ? '—' : minute(saved.schedule.nextRunAt),
      ],
      [
        t('run_get_saved.label.last'),
        saved.schedule.lastRunAt === null ? '—' : minute(saved.schedule.lastRunAt),
      ],
    ];
    if (saved.schedule.consecutiveFailures > 0) {
      rows.push([
        t('run_get_saved.label.failures'),
        num(saved.schedule.consecutiveFailures, t.locale),
      ]);
    }
    if (saved.schedule.lastError !== null) {
      rows.push([t('run_get_saved.label.error'), saved.schedule.lastError]);
    }
    if (saved.targetBaseUrl !== null)
      rows.push([t('run_get_saved.label.url'), saved.targetBaseUrl]);
    if (saved.sourceRun !== null) rows.push([t('run_get_saved.label.source'), saved.sourceRun]);
    const lines = [t('run_get_saved.one', { name: saved.name }), ...keyValue(rows)];
    if (saved.slotCount > 0) {
      lines.push(
        t('run_get_saved.slots', {
          list: saved.slots
            .map((slot) => `${slot.slot} (${t(`run_get_saved.slot.${slot.state}`)})`)
            .join(', '),
        }),
      );
      if (saved.slots.length < saved.slotCount) {
        lines.push(
          t('run_get_saved.slots.more', { shown: saved.slots.length, total: saved.slotCount }),
        );
      }
    }
    return lines.join('\n');
  }
  if (data.count === 0) return t('run_get_saved.none');
  const lines = [t.plural('run_get_saved.header', data.count)];
  lines.push(
    ...columns(
      data.items.map((row) => [
        row.name,
        scheduleOf(row.schedule, t),
        loadOf(row.workload, t),
        `${t('run_get_saved.last')} ${day(row.schedule.lastRunAt)}`,
      ]),
    ).map((row) => `  ${row}`),
  );
  if (data.shown < data.count) {
    lines.push(t('run_get_saved.more', { shown: data.shown, total: data.count }));
  }
  return lines.join('\n');
}
