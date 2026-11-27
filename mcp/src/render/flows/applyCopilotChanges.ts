// The view of `flows_apply_copilot_changes`: how many of the accepted changes were applied and as
// which version, what was dropped, what was recorded as rejected, and what the undo brings back. The
// changes are named by id and their description (a model's text: masked, one line by the tool); the
// blocks of a change are never shown.

import type { Translator } from '../../context.js';

export interface AppliedWarning {
  readonly change: string;
  readonly message: string;
}

export interface ApplyCopilotChangesData {
  readonly project_id: string;
  readonly flow: { readonly id: string };
  /** The flow's name. */
  readonly name: string;
  /** The copilot turn the changes come from. */
  readonly message_id: string;
  /** How many changes were sent to be applied (the `{requested}` of the log entry). */
  readonly requested: number;
  /** How many the backend applied (the `{applied}` of the log entry); it can drop some. */
  readonly applied: number;
  /** The version the apply created, or the current one when none was saved (the `{version}`). */
  readonly version: number;
  /** The version that was current before the call. */
  readonly previous: number;
  /** A new version was saved: the undo is the restore of `previous`. */
  readonly saved: boolean;
  /** The ids of the changes recorded as rejected. */
  readonly rejected: readonly string[];
  /** Recording the outcomes (accepted and rejected) worked. */
  readonly recorded: boolean;
  readonly warnings: readonly AppliedWarning[];
}

export function renderApplyCopilotChanges(data: ApplyCopilotChangesData, t: Translator): string {
  const lines: string[] = [];
  if (data.requested > 0) {
    lines.push(
      data.saved
        ? t('flows_apply_copilot_changes.applied', {
            name: data.name,
            applied: data.applied,
            requested: data.requested,
            version: data.version,
            previous: data.previous,
          })
        : t('flows_apply_copilot_changes.not_applied', {
            name: data.name,
            requested: data.requested,
          }),
    );
    for (const warning of data.warnings) {
      lines.push(
        t('flows_apply_copilot_changes.warning', {
          change: warning.change,
          message: warning.message,
        }),
      );
    }
  } else {
    lines.push(t('flows_apply_copilot_changes.only_rejected', { name: data.name }));
  }
  if (data.rejected.length > 0) {
    lines.push(
      t.plural('flows_apply_copilot_changes.rejected', data.rejected.length, {
        ids: data.rejected.join(', '),
      }),
    );
  }
  if (!data.recorded) lines.push(t('flows_apply_copilot_changes.not_recorded'));
  lines.push(
    data.saved
      ? t('flows_apply_copilot_changes.undo', { previous: data.previous })
      : t('flows_apply_copilot_changes.no_undo'),
  );
  return lines.join('\n');
}
