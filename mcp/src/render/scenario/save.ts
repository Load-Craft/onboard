// The view of `scenario_save`: a created empty scenario, or what a save changed (each changed field
// with its value before and after), and the way back. The names and the tags are the application's
// own text and arrive masked and made one line by the tool (`content`).

import type { Translator } from '../../context.js';

/** How the SLO thresholds of a scenario stand: inherited from the project, the stock ones, or its own. */
export type SloState =
  | { readonly mode: 'inherited' }
  | { readonly mode: 'stock' }
  | { readonly mode: 'own'; readonly thresholds: Readonly<Record<string, number>> };

export interface Change<T> {
  readonly was: T;
  readonly now: T;
}

export interface SaveData {
  readonly project_id: string;
  readonly scenario_id: string;
  /** The scenario's name after the call (the `{name}` of the log entry). */
  readonly name: string;
  /** A new empty scenario was created, not an existing one changed. */
  readonly created: boolean;
  /** What a save changed; empty for a creation and for a save that changed nothing. */
  readonly changes: {
    readonly name?: Change<string>;
    readonly tags?: Change<readonly string[]>;
    readonly is_active?: Change<boolean>;
    readonly slo?: Change<SloState>;
  };
  /** Whether the log entry holds an undo (the previous values, or the deletion of the new scenario). */
  readonly undoable: boolean;
}

const MAX_SHOWN = 8;

function sloText(state: SloState, t: Translator): string {
  if (state.mode === 'inherited') return t('scenario_save.slo.inherited');
  if (state.mode === 'stock') return t('scenario_save.slo.stock');
  const rows = Object.entries(state.thresholds);
  const shown = rows.slice(0, MAX_SHOWN).map(([key, value]) => `${key}=${String(value)}`);
  const more = rows.length - shown.length;
  return t('scenario_save.slo.own', {
    list: more > 0 ? `${shown.join(', ')} (+${String(more)})` : shown.join(', '),
  });
}

function tagsText(tags: readonly string[], t: Translator): string {
  return tags.length === 0 ? t('scenario_save.tags.none') : tags.join(', ');
}

function yesNo(value: boolean, t: Translator): string {
  return t(value ? 'scenario_save.yes' : 'scenario_save.no');
}

export function renderSave(data: SaveData, t: Translator): string {
  if (data.created) {
    return [
      t('scenario_save.created', { name: data.name }),
      t('scenario_save.undo.created', { id: data.scenario_id }),
    ].join('\n');
  }
  const { changes } = data;
  const lines: string[] = [];
  if (changes.name !== undefined) {
    lines.push(t('scenario_save.change.name', { was: changes.name.was, now: changes.name.now }));
  }
  if (changes.tags !== undefined) {
    lines.push(
      t('scenario_save.change.tags', {
        was: tagsText(changes.tags.was, t),
        now: tagsText(changes.tags.now, t),
      }),
    );
  }
  if (changes.is_active !== undefined) {
    lines.push(
      t('scenario_save.change.active', {
        was: yesNo(changes.is_active.was, t),
        now: yesNo(changes.is_active.now, t),
      }),
    );
  }
  if (changes.slo !== undefined) {
    lines.push(
      t('scenario_save.change.slo', {
        was: sloText(changes.slo.was, t),
        now: sloText(changes.slo.now, t),
      }),
    );
  }
  if (lines.length === 0) return t('scenario_save.unchanged', { name: data.name });
  return [
    t('scenario_save.saved', { name: data.name }),
    ...lines,
    t(data.undoable ? 'scenario_save.undo' : 'scenario_save.undo.none'),
  ].join('\n');
}
