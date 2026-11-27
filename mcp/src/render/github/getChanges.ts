// The view of `github_get_changes`: the files that changed in the repository since the last sync, each
// with how it changed. Only the list: no content of a file is read. The call moves the sync marker, so
// the view says that a second call returns nothing. Paths arrive masked and made one line.

import type { Translator } from '../../context.js';
import { columns, num } from '../primitives.js';

export type ChangeType = 'added' | 'modified' | 'deleted' | 'other';

export interface ChangedFile {
  readonly path: string;
  readonly change: ChangeType;
  /** False for a deleted or unreadable file. */
  readonly hasContent: boolean;
}

export interface GetChangesData {
  /** How many files changed (the log slot `{files}`), and how many of them the data lists. */
  readonly files: number;
  readonly shown: number;
  readonly limit: number;
  /** The files the backend processed. */
  readonly processed: number;
  /** The commit the sync marker moved to (7 hex characters); null when the backend gave none. */
  readonly lastCommit: string | null;
  readonly changes: readonly ChangedFile[];
}

export function renderGetChanges(data: GetChangesData, t: Translator): string {
  const marker = t('github_get_changes.marker', { commit: data.lastCommit ?? '—' });
  if (data.files === 0) return [t('github_get_changes.none'), marker].join('\n');
  const lines = [t.plural('github_get_changes.header', data.files)];
  lines.push(
    ...columns(
      data.changes.map((file) => [t(`github_get_changes.change.${file.change}`), file.path]),
    ).map((row) => `  ${row}`),
  );
  if (data.shown < data.files) {
    lines.push(
      t('github_get_changes.more', {
        shown: num(data.shown, t.locale),
        total: num(data.files, t.locale),
      }),
    );
  }
  lines.push(marker);
  return lines.join('\n');
}
