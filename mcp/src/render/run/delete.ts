// The view of `run_delete` and of the lines of its consent card: exactly what disappears (a run with
// its results and report, a load profile, a saved run with its schedule) and what stays. The names
// are texts a person wrote: they arrive masked and made one line. A run has no name: it is its handle.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

/** The word of the kind, which is also the `{kind}` slot of the log entry. */
export type RunDeleteKind = 'run' | 'profile' | 'saved run';

/** What the card froze. `names` and `kind` are also the slots of the log entry. */
export interface RunDeleteFacts {
  readonly kind: RunDeleteKind;
  readonly names: string;
  readonly id: string;
  /** A run: its status, the day it started (or was made) and the requests it measured (null: none). */
  readonly status?: string;
  readonly day?: string | null;
  readonly requests?: number | null;
  /** A profile: the users and the seconds it asks for, and whether it is the project's default. */
  readonly users?: number;
  readonly seconds?: number;
  readonly is_default?: boolean;
  /** A saved run: its cron expression (null: it has no schedule) and whether the schedule is on. */
  readonly cron?: string | null;
  readonly scheduled?: boolean;
}

export interface RunDeleteData {
  readonly kind: RunDeleteKind;
  readonly id: string;
  readonly names: string;
  readonly count: number;
}

const keyOf = (kind: RunDeleteKind): string => (kind === 'saved run' ? 'saved' : kind);

export function cardViewRunDelete(facts: RunDeleteFacts, t: Translator): CardView {
  const key = keyOf(facts.kind);
  const lines: string[] = [t(`run_delete.card.item.${key}`, { id: facts.id })];
  if (facts.kind === 'run') {
    lines.push(
      t(
        facts.requests === null || facts.requests === undefined
          ? 'run_delete.card.run_no_requests'
          : 'run_delete.card.run_requests',
        {
          status: facts.status ?? '',
          day: facts.day ?? '—',
          requests: num(facts.requests ?? 0, t.locale),
        },
      ),
    );
  } else if (facts.kind === 'profile') {
    lines.push(
      t('run_delete.card.profile_size', {
        users: num(facts.users ?? 0, t.locale),
        seconds: num(facts.seconds ?? 0, t.locale),
      }),
    );
    if (facts.is_default === true) lines.push(t('run_delete.card.profile_default'));
  } else {
    lines.push(
      facts.cron === null || facts.cron === undefined
        ? t('run_delete.card.saved_unscheduled')
        : t(
            facts.scheduled === true
              ? 'run_delete.card.saved_scheduled'
              : 'run_delete.card.saved_schedule_off',
            { cron: facts.cron },
          ),
    );
  }
  lines.push(t(`run_delete.card.stays.${key}`));
  return {
    title: t(`run_delete.card.title.${key}`, { name: facts.names }),
    lines,
    undo: t(`run_delete.card.undo.${key}`),
  };
}

export function renderRunDelete(data: RunDeleteData, t: Translator): string {
  const key = keyOf(data.kind);
  return [
    t(`run_delete.done.${key}`, { name: data.names, count: num(data.count, t.locale) }),
    t(`run_delete.stays.${key}`),
  ].join('\n');
}
