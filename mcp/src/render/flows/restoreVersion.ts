// The view of `flows_restore_version`: which version came back as which new one, or that it already
// was the current one. The name arrives made one line and masked by the tool (`content`).

import type { Translator } from '../../context.js';
import { inline } from '../primitives.js';

/** What the restore could not bring back: the code, and the endpoints it names (`METHOD path`). */
export interface RestoreWarning {
  /** The backend's code of the warning; a text exists in the dictionaries for each one it knows. */
  readonly code: string;
  readonly endpoints: readonly string[];
}

export interface RestoreVersionData {
  readonly project_id: string;
  readonly flow: { readonly id: string };
  /** The flow's name (the `{name}` of the log entry). */
  readonly name: string;
  /** The version that was asked for. */
  readonly version: number;
  /** The version number the restore created; null when nothing was written. */
  readonly new: number | null;
  /** The version that was current before the call. */
  readonly previous: number;
  readonly changed: boolean;
  /** What the restore could not bring back (the backend's list); empty when nothing. */
  readonly warnings: readonly RestoreWarning[];
}

export function renderRestoreVersion(data: RestoreVersionData, t: Translator): string {
  if (!data.changed || data.new === null) {
    return t('flows_restore_version.unchanged', { name: data.name, version: data.version });
  }
  const lines = [
    t('flows_restore_version.done', {
      name: data.name,
      version: data.version,
      new: data.new,
      previous: data.previous,
    }),
  ];
  for (const warning of data.warnings) {
    const key = `flows_restore_version.warning.${warning.code}`;
    lines.push(
      t.has(key)
        ? t(key, { endpoints: warning.endpoints.join(', ') })
        : t('flows_restore_version.warning.other', { code: inline(warning.code, 60) }),
    );
  }
  return lines.join('\n');
}
