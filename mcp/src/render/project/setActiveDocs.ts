// The view of `project_set_active_docs`: which documentation is now the active one, or that it
// already was. The texts arrive made one line and masked by the tool (`content`).

import type { Translator } from '../../context.js';

export interface SetActiveDocsData {
  readonly project_id: string;
  readonly kind: 'openapi' | 'asyncapi';
  readonly docs_id: string;
  readonly title: string | null;
  /** Null when the version could not be read after the write. */
  readonly version: string | null;
  /** False when the version was already the active one (nothing was written). */
  readonly changed: boolean;
  /** The version that was active before; null when none. */
  readonly previous_id: string | null;
  /** Whether the log keeps the way back. */
  readonly undoable: boolean;
}

export function renderSetActiveDocs(data: SetActiveDocsData, t: Translator): string {
  const params = {
    kind: t(`project_set_active_docs.kind.${data.kind}`),
    version: data.version ?? '?',
    title: data.title ?? '',
  };
  const named = data.title === null ? '.name_less' : '';
  const key = data.changed ? 'project_set_active_docs.done' : 'project_set_active_docs.already';
  const lines = [t(`${key}${named}`, params)];
  if (data.changed && !data.undoable) lines.push(t('project_set_active_docs.not_undoable'));
  return lines.join('\n');
}
