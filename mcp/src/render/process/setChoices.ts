// The view of `process_set_choices`: the paths changed, the new values and the cleared fields. The
// values arrive as one-line JSON text masked by the tool (`content` of tools/moduleCall.ts).

import type { Translator } from '../../context.js';

export interface SetChoicesData {
  /** Paths `group.field` the call changed. */
  readonly changed: readonly string[];
  /** Paths that were already as given. */
  readonly unchanged: readonly string[];
  /** The new value (one-line JSON text) of the changed paths that were set. */
  readonly set: Readonly<Record<string, string>>;
  /** The changed paths that were cleared. */
  readonly cleared: readonly string[];
  /** Whether the log keeps the way back. */
  readonly undoable: boolean;
}

export function renderSetChoices(data: SetChoicesData, t: Translator): string {
  if (data.changed.length === 0) return t('process_set_choices.unchanged');
  const lines = [t('process_set_choices.header', { paths: data.changed.join(', ') })];
  for (const path of data.changed) {
    const value = data.set[path];
    lines.push(
      value === undefined
        ? t('process_set_choices.cleared', { path })
        : t('process_set_choices.value', { path, value }),
    );
  }
  if (!data.undoable) lines.push(t('process_set_choices.not_undoable'));
  return lines.join('\n');
}
