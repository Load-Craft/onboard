// The view of `project_update`: which fields changed, the name with its previous value, and a line
// for the description. The texts arrive made one line and masked by the tool (`content`).

import type { Translator } from '../../context.js';

export type UpdatedField = 'name' | 'description';

export interface UpdateData {
  readonly project_id: string;
  /** The name after the call. */
  readonly name: string;
  /** The description after the call; null when the project has none. */
  readonly description: string | null;
  /** The fields the write changed; empty when the values were already as given (nothing sent). */
  readonly changed: readonly UpdatedField[];
  /** The values before, for the fields that changed. */
  readonly previous: { readonly name?: string; readonly description?: string | null };
  /** Whether the log keeps the way back: false when a previous value held a secret (it is not kept). */
  readonly undoable: boolean;
}

export function renderUpdate(data: UpdateData, t: Translator): string {
  if (data.changed.length === 0) return t('project_update.unchanged', { name: data.name });
  const fields = data.changed.map((field) => t(`project_update.field.${field}`)).join(', ');
  const lines = [t('project_update.header', { name: data.name, fields })];
  if (data.changed.includes('name')) {
    lines.push(t('project_update.name', { was: data.previous.name ?? '', now: data.name }));
  }
  if (data.changed.includes('description')) {
    lines.push(t('project_update.description', { now: data.description ?? '' }));
  }
  if (!data.undoable) lines.push(t('project_update.not_undoable'));
  return lines.join('\n');
}
