// View of `process_cancel`: whether the operation was stopped, or was no longer running.

import type { Translator } from '../../context.js';
import { inline, VIEW_WIDTH, wrap } from '../primitives.js';

export interface CancelData {
  /** The handle the call was about; absent when no test was running to be named. */
  readonly operation?: string;
  readonly cancelled: boolean;
  /**
   * Why: the operation was `stopped`, or is `stopping` (it still ends on its own and keeps what it
   * built), or was `not_running` (LoadCraft no longer has it), or the test had `ended` before the
   * call (`ended` says how), or the run of a plan had ended (`plan_ended`: nothing was sent), or no test was running at all (`none_running`, with the project).
   */
  readonly note: 'stopped' | 'stopping' | 'not_running' | 'ended' | 'plan_ended' | 'none_running';
  /** How a test that had already ended finished. */
  readonly ended?: string;
  /** Short handle (`e-…`) of a test found in LoadCraft: what `results_get_report` takes. */
  readonly execution?: string;
  /** Name of the project, for `none_running`. */
  readonly project?: string;
}

function lines(data: CancelData, t: Translator): string[] {
  const operation = inline(data.operation ?? '');
  switch (data.note) {
    case 'stopped':
      return [t('cancel.stopped', { operation })];
    case 'stopping':
      return [t('cancel.stopping', { operation }), `→ ${t('cancel.stopping.next', { operation })}`];
    case 'ended':
      return [
        t('cancel.ended', { operation, status: t(`cancel.status.${data.ended ?? 'completed'}`) }),
        `→ ${t('cancel.ended.next', { handle: inline(data.execution ?? operation) })}`,
      ];
    case 'plan_ended':
      return [
        t('cancel.planEnded', {
          operation,
          status: t(`cancel.status.${data.ended ?? 'completed'}`),
        }),
        `→ ${t('cancel.planEnded.next', { operation })}`,
      ];
    case 'none_running':
      return [t('cancel.noneRunning', { project: inline(data.project ?? '') })];
    case 'not_running':
      return [
        t('cancel.notRunning', { operation }),
        `→ ${t('cancel.notRunning.next', { operation })}`,
      ];
  }
}

export function renderCancel(data: CancelData, t: Translator): string {
  return lines(data, t)
    .flatMap((line) => wrap(line, VIEW_WIDTH, 2))
    .join('\n');
}
