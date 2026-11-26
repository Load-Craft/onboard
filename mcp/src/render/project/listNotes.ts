// The view of `project_list_notes`: one numbered line per note, what it applies to in brackets.
// The texts arrive made one line and masked by the tool (`content` of tools/moduleCall.ts); the
// view adds no text of the backend of its own.

import type { Translator } from '../../context.js';

/** What a note applies to: a page of the application, a step of a plan, or the whole project. */
export type NoteScope = 'url_path' | 'plan_step';

export interface NoteItem {
  readonly id: string | null;
  readonly text: string;
  readonly scope: NoteScope;
  /** The page path or the words of the step; null when the note names neither. */
  readonly at: string | null;
  /** The run the agent learned the note in; null when the backend does not say. */
  readonly learned_from_run: string | null;
}

export interface NotesData {
  readonly project_id: string;
  /** How many notes the project has. */
  readonly count: number;
  /** How many of them the data carries (the first ones, as the backend lists them). */
  readonly shown: number;
  readonly notes: readonly NoteItem[];
}

function scopeOf(note: NoteItem, t: Translator): string {
  if (note.at === null) return t('project_list_notes.scope.project');
  return t(`project_list_notes.scope.${note.scope}`, { at: note.at });
}

export function renderListNotes(data: NotesData, t: Translator): string {
  if (data.count === 0) return t('project_list_notes.empty');
  const lines = [t.plural('project_list_notes.header', data.count)];
  data.notes.forEach((note, index) => {
    lines.push(`${String(index + 1)}. [${scopeOf(note, t)}] ${note.text}`);
  });
  if (data.shown < data.count) {
    lines.push(t('project_list_notes.more', { shown: data.shown, total: data.count }));
  }
  return lines.join('\n');
}
