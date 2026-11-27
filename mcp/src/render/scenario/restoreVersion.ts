// The view of `scenario_restore_version`: which version came back as which new one, or that it already
// was the current one. The name arrives made one line and masked by the tool (`content`).

import type { Translator } from '../../context.js';

export interface RestoreVersionData {
  readonly project_id: string;
  readonly scenario: { readonly id: string };
  /** The scenario's name (the `{name}` of the log entry). */
  readonly name: string;
  /** The version that was asked for. */
  readonly version: number;
  /** The version number the restore created; null when nothing was written. */
  readonly new: number | null;
  /** The version that was current before the call. */
  readonly previous: number;
  readonly changed: boolean;
}

export function renderRestoreVersion(data: RestoreVersionData, t: Translator): string {
  if (!data.changed || data.new === null) {
    return t('scenario_restore_version.unchanged', { name: data.name, version: data.version });
  }
  return t('scenario_restore_version.done', {
    name: data.name,
    version: data.version,
    new: data.new,
    previous: data.previous,
  });
}
