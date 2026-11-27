// The view of `project_set_apimap`: the areas after the call, the prefixes no operation is under,
// and whether the change can be taken back. The texts arrive made one line and masked by the tool
// (`content` of tools/moduleCall.ts).

import type { Translator } from '../../context.js';

export interface SetApimapData {
  readonly project_id: string;
  readonly mode: 'prefixes' | 'detected';
  /** The saved prefixes after the call (the first ones); empty while the areas are detected. */
  readonly prefixes: readonly string[];
  /** How many prefixes are saved. */
  readonly count: number;
  /** How many areas the map has now. */
  readonly areas: number;
  /** Saved prefixes no operation of the documentation is under. */
  readonly empty_prefixes: readonly string[];
  /** False when the areas were already as asked (nothing changed). */
  readonly changed: boolean;
  /** The saved prefixes before; null when the areas were the detected ones. */
  readonly previous: readonly string[] | null;
  /** Whether the log keeps the way back. */
  readonly undoable: boolean;
}

export function renderSetApimap(data: SetApimapData, t: Translator): string {
  if (!data.changed) {
    return t(
      data.mode === 'detected'
        ? 'project_set_apimap.unchanged_detected'
        : 'project_set_apimap.unchanged',
    );
  }
  const lines: string[] =
    data.mode === 'detected'
      ? [t('project_set_apimap.detected', { areas: data.areas })]
      : [
          t('project_set_apimap.manual', { prefixes: data.prefixes.join(', ') }),
          t('project_set_apimap.counts', { count: data.count, areas: data.areas }),
        ];
  if (data.empty_prefixes.length > 0) {
    lines.push(t('project_set_apimap.empty', { prefixes: data.empty_prefixes.join(', ') }));
  }
  if (!data.undoable) lines.push(t('project_set_apimap.not_undoable'));
  return lines.join('\n');
}
