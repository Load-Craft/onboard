// The view of `data_set_slot_label`: the label a data slot of a scenario got and the one it had. The
// labels are texts a person or a model wrote: they arrive masked and made one line.

import type { Translator } from '../../context.js';

export interface SetSlotLabelData {
  readonly scenario_id: string;
  readonly slot: string;
  /** The label after the call. */
  readonly label: string;
  /** The label before; null when the slot had none. */
  readonly previous: string | null;
  /** Whether the call wrote anything (false: the label was already as given). */
  readonly changed: boolean;
  /** Whether the log keeps the way back. */
  readonly undoable: boolean;
  /** Why it is not: the slot had no label (one cannot be cleared) or a text held a secret. */
  readonly notUndoable: 'no_previous' | 'secret' | null;
}

export function renderSetSlotLabel(data: SetSlotLabelData, t: Translator): string {
  if (!data.changed) {
    return t('data_set_slot_label.unchanged', { slot: data.slot, label: data.label });
  }
  const lines = [
    t('data_set_slot_label.done', { slot: data.slot, label: data.label }),
    data.previous === null
      ? t('data_set_slot_label.was_none')
      : t('data_set_slot_label.was', { previous: data.previous }),
  ];
  if (data.notUndoable !== null) {
    lines.push(t(`data_set_slot_label.not_undoable.${data.notUndoable}`));
  }
  return lines.join('\n');
}
