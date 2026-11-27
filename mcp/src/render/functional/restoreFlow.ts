// The view of `functional_restore_flow`: which flow went back to which saved version, and under which
// label the state before the restore was kept (what the undo goes back to). Names are texts a person
// or a model wrote: they arrive masked and made one line.

import type { Translator } from '../../context.js';

export interface RestoreFlowData {
  readonly flow_id: string;
  readonly name: string;
  /** The saved version the flow was restored to (its label). */
  readonly version: string;
  /** The label under which the backend kept the state before the restore; null when it listed none. */
  readonly snapshot: string | null;
  readonly blocks: number;
  /** Whether the log keeps the way back (false when no snapshot was found). */
  readonly undoable: boolean;
}

export function renderRestoreFlow(data: RestoreFlowData, t: Translator): string {
  const lines = [
    t('functional_restore_flow.done', {
      name: data.name,
      version: data.version,
      blocks: data.blocks,
    }),
  ];
  lines.push(
    data.snapshot === null
      ? t('functional_restore_flow.no_snapshot')
      : t('functional_restore_flow.snapshot', { snapshot: data.snapshot }),
  );
  return lines.join('\n');
}
