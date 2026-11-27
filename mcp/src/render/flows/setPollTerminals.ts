// The view of `flows_set_poll_terminals`: which status field of which flow was answered, with which
// terminal statuses, the version that came out and how many questions are still open. The names and
// the statuses are texts of the application under test or of the generator: they arrive masked and
// made one line by the tool.

import type { Translator } from '../../context.js';

export interface SetPollTerminalsData {
  readonly project_id: string;
  readonly flow: { readonly id: string };
  /** The flow's name. */
  readonly name: string;
  /** The status field that was answered (the `{field}` of the log entry). */
  readonly field: string;
  readonly success: readonly string[];
  readonly failure: readonly string[];
  /** The version the answer created (the `{version}` of the log entry). */
  readonly version: number;
  /** The version that was current before the call. */
  readonly previous: number;
  /** Questions the flow still has open (the `{open}` of the log entry). */
  readonly open: number;
}

export function renderSetPollTerminals(data: SetPollTerminalsData, t: Translator): string {
  const lines = [
    t('flows_set_poll_terminals.done', {
      name: data.name,
      field: data.field,
      version: data.version,
      previous: data.previous,
    }),
    t('flows_set_poll_terminals.success', { statuses: data.success.join(', ') }),
    data.failure.length === 0
      ? t('flows_set_poll_terminals.no_failure')
      : t('flows_set_poll_terminals.failure', { statuses: data.failure.join(', ') }),
    data.open === 0
      ? t('flows_set_poll_terminals.none_open')
      : t.plural('flows_set_poll_terminals.open', data.open),
    t('flows_set_poll_terminals.undo', { previous: data.previous }),
  ];
  return lines.join('\n');
}
