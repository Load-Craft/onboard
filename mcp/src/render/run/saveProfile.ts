// The view of `run_save_profile`: a profile created, a profile changed (the fields and their
// previous values) or nothing to change. Texts arrive made one line and masked by the tool.

import type { Translator } from '../../context.js';
import { num } from '../primitives.js';

export type ProfileField =
  | 'name'
  | 'type'
  | 'users'
  | 'duration_seconds'
  | 'ramp_duration_seconds'
  | 'description'
  | 'is_default';

export interface SaveProfileData {
  readonly project_id: string;
  /** The id of the profile created or changed. */
  readonly id: string;
  readonly name: string;
  readonly created: boolean;
  /** The fields a change wrote; for a creation, the fields sent. Empty: nothing to change. */
  readonly changed: readonly ProfileField[];
  /** The profile as it stands after the call. */
  readonly type: string;
  readonly users: number;
  readonly durationS: number;
  readonly rampS: number | null;
  readonly isDefault: boolean;
  /** The values before, for the fields a change wrote. */
  readonly previous: Readonly<Partial<Record<ProfileField, string | number | boolean | null>>>;
  /** Whether the log keeps the way back (false for a creation and for a change that cannot be restored). */
  readonly undoable: boolean;
  /** Why the change is not offered for undo, when it is not. */
  readonly notUndoable: 'secret' | 'was_empty' | 'default_moved' | null;
}

export function renderSaveProfile(data: SaveProfileData, t: Translator): string {
  const load = t('run_save_profile.load', {
    type: data.type,
    users: num(data.users, t.locale),
    seconds: num(data.durationS, t.locale),
  });
  if (data.created) {
    return [
      t('run_save_profile.created', { name: data.name, load }),
      t('run_save_profile.created_undo'),
    ].join('\n');
  }
  if (data.changed.length === 0) return t('run_save_profile.unchanged', { name: data.name });
  const fields = data.changed.map((field) => t(`run_save_profile.field.${field}`)).join(', ');
  const lines = [t('run_save_profile.updated', { name: data.name, fields, load })];
  for (const field of data.changed) {
    const was = data.previous[field];
    if (was !== undefined) {
      lines.push(
        t('run_save_profile.was', {
          field: t(`run_save_profile.field.${field}`),
          was: was === null ? '—' : String(was),
        }),
      );
    }
  }
  if (data.notUndoable !== null) lines.push(t(`run_save_profile.not_undoable.${data.notUndoable}`));
  return lines.join('\n');
}
