// The view of `project_update_note`: which fields of the note changed, the new text, the new scope,
// and what the undo can restore. The texts arrive made one line and masked by the tool (`content`).

import type { Translator } from '../../context.js';
import type { NoteScope } from './listNotes.js';

export type NoteField = 'text' | 'scope';

/** What the log keeps for taking the change back. */
export type NoteUndo = 'kept' | 'text_only' | 'scope' | 'withheld' | 'none';

export interface UpdateNoteData {
  readonly project_id: string;
  readonly id: string;
  readonly text: string;
  readonly scope: NoteScope;
  /** The page path or the words of the step; null when the note names neither. */
  readonly at: string | null;
  /** The fields the write changed; empty when the note was already as given (nothing sent). */
  readonly changed: readonly NoteField[];
  /** The values before, for the fields that changed. */
  readonly previous: {
    readonly text?: string;
    readonly scope?: NoteScope;
    readonly at?: string | null;
  };
  readonly undo: NoteUndo;
}

function scopeOf(data: UpdateNoteData, t: Translator): string {
  if (data.at === null) return t('project_list_notes.scope.project');
  return t(`project_list_notes.scope.${data.scope}`, { at: data.at });
}

export function renderUpdateNote(data: UpdateNoteData, t: Translator): string {
  if (data.changed.length === 0) return t('project_update_note.unchanged', { id: data.id });
  const fields = data.changed.map((field) => t(`project_update_note.field.${field}`)).join(', ');
  const lines = [t('project_update_note.header', { id: data.id, fields })];
  if (data.changed.includes('text')) lines.push(t('project_update_note.text', { text: data.text }));
  if (data.changed.includes('scope')) {
    lines.push(t('project_update_note.scope', { scope: scopeOf(data, t) }));
  }
  if (data.undo === 'text_only' || data.undo === 'scope' || data.undo === 'withheld') {
    lines.push(t(`project_update_note.undo.${data.undo}`));
  }
  return lines.join('\n');
}
