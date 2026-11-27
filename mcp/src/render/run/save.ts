// The view of `run_save` and of the lines of its consent card: a saved run made or changed, and, for a
// change of the load, the environment or the target address of a run that has a schedule, what it was
// and what it becomes (the card; the next start of the schedule is shown, not bound). The name, the
// cron expression and the address are texts a person wrote: they arrive masked and made one line.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';

/** A load as the card words it: the figures of the stored or the given workload. */
export interface LoadFacts {
  readonly type: string | null;
  readonly vusers: number | null;
  readonly ramp: number | null;
  readonly hold: number | null;
}

export interface FromTo<T> {
  readonly from: T;
  readonly to: T;
}

/** What the card froze. `name` is also the slot of the log entry. */
export interface SaveFacts {
  readonly name: string;
  readonly saved_run_id: string;
  /** The cron expression of the schedule (null when the backend gave none). */
  readonly cron: string | null;
  readonly workload?: FromTo<LoadFacts | null>;
  readonly environment?: FromTo<string | null>;
  readonly target?: FromTo<string | null>;
}

export type SavedPart = 'name' | 'workload' | 'environment' | 'target' | 'feeder_bindings';

export interface SaveData {
  readonly saved_run_id: string;
  readonly name: string;
  readonly created: boolean;
  /** What a change touched; empty for a new saved run and for a call that changed nothing. */
  readonly changed: readonly SavedPart[];
  /** The way back the log keeps: the previous values, the deletion of a new one, none. */
  readonly undo: 'values' | 'removal' | 'withheld' | 'none';
}

const loadText = (load: LoadFacts | null, t: Translator): string => {
  if (load === null) return t('run_save.none');
  const unknown = '?';
  return t('run_save.load', {
    type: load.type ?? unknown,
    vusers: load.vusers === null ? unknown : String(load.vusers),
    ramp: load.ramp === null ? unknown : String(load.ramp),
    hold: load.hold === null ? unknown : String(load.hold),
  });
};

export function cardViewSave(
  facts: SaveFacts,
  t: Translator,
  volatile: Readonly<Record<string, string | number | boolean | null>>,
): CardView {
  const none = t('run_save.none');
  const lines = [
    t('run_save.card.schedule', { cron: facts.cron ?? none }),
    ...(facts.workload === undefined
      ? []
      : [
          t('run_save.card.workload', {
            from: loadText(facts.workload.from, t),
            to: loadText(facts.workload.to, t),
          }),
        ]),
    ...(facts.environment === undefined
      ? []
      : [
          t('run_save.card.environment', {
            from: facts.environment.from ?? none,
            to: facts.environment.to ?? none,
          }),
        ]),
    ...(facts.target === undefined
      ? []
      : [
          t('run_save.card.target', {
            from: facts.target.from ?? none,
            to: facts.target.to ?? none,
          }),
        ]),
  ];
  return {
    title: t('run_save.card.title', {
      name: facts.name,
      next_start: String(volatile['next_start'] ?? none),
    }),
    lines,
    undo: t('run_save.card.undo'),
  };
}

export function renderSave(data: SaveData, t: Translator): string {
  if (data.created) {
    return [
      t('run_save.created', { name: data.name, id: data.saved_run_id }),
      t(`run_save.undo.${data.undo}`, { id: data.saved_run_id }),
    ].join('\n');
  }
  if (data.changed.length === 0) return t('run_save.unchanged', { name: data.name });
  const parts = data.changed.map((part) => t(`run_save.part.${part}`)).join(', ');
  return [
    t('run_save.changed', { name: data.name, parts }),
    t(`run_save.undo.${data.undo}`, { id: data.saved_run_id }),
  ].join('\n');
}
