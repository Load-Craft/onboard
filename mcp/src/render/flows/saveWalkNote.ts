// The view of `flows_save_walk_note`: the note that was added or changed at a step of a walk. The
// texts arrive made one line and masked by the tool (`content` of tools/moduleCall.ts).

import type { Translator } from '../../context.js';

/** What the log keeps for taking the change back. */
export type WalkNoteUndo = 'kept' | 'none' | 'withheld';

export interface SaveWalkNoteData {
  readonly project_id: string;
  readonly walk_id: string;
  /** The note's id; null when the backend gave none. */
  readonly id: string | null;
  /** The step the note is at. */
  readonly step: string;
  /** The note's text after the call. */
  readonly text: string;
  /** A new note (false: the text of an existing one). */
  readonly created: boolean;
  /** The note is also kept as a note of the project. */
  readonly remember: boolean;
  /** False when the note already said that (nothing was sent). */
  readonly changed: boolean;
  readonly undo: WalkNoteUndo;
}

export function renderSaveWalkNote(data: SaveWalkNoteData, t: Translator): string {
  const id = data.id ?? '?';
  if (!data.changed) return t('flows_save_walk_note.unchanged', { id });
  const lines = [
    t(data.created ? 'flows_save_walk_note.added' : 'flows_save_walk_note.changed', {
      id,
      step: data.step,
      text: data.text,
    }),
  ];
  if (data.remember) lines.push(t('flows_save_walk_note.remembered'));
  if (data.undo === 'withheld') lines.push(t('flows_save_walk_note.withheld'));
  if (data.created) lines.push(t('flows_save_walk_note.no_undo_new'));
  return lines.join('\n');
}
