// The view of `functional_save_flow`: the flow that was created, changed or snapshotted, which fields were written, the safety snapshot
// that holds the way back of the blocks, and what the undo does not cover. The name and the labels arrive masked, made one line.

import type { Translator } from '../../context.js';

/** What the log keeps for taking the change back. */
export type FlowUndo = 'restore' | 'values' | 'partial' | 'none' | 'withheld' | 'too_large';

export interface SaveFlowData {
  readonly flow: { readonly id: string };
  readonly name: string;
  readonly created: boolean;
  /** The fields written; empty when nothing differed or a snapshot was taken. */
  readonly changed: readonly string[];
  /** The label of the safety snapshot taken before a change of blocks or edges, or of the snapshot asked for. */
  readonly snapshot: string | null;
  /** The snapshot was asked for (`version`), not taken for the undo. */
  readonly snapshot_asked: boolean;
  readonly blocks: number;
  /** Changed fields the backend cannot put back (it ignores a null), or the undo does not cover. */
  readonly not_undoable: readonly string[];
  readonly undo: FlowUndo;
}

export function renderSaveFlow(data: SaveFlowData, t: Translator): string {
  if (data.created) {
    return t('functional_save_flow.created', {
      name: data.name,
      id: data.flow.id,
      blocks: data.blocks,
    });
  }
  if (data.snapshot_asked && data.snapshot !== null) {
    return t('functional_save_flow.snapshot_saved', { name: data.name, version: data.snapshot });
  }
  if (data.changed.length === 0) return t('functional_save_flow.unchanged', { name: data.name });
  const lines = [
    t('functional_save_flow.updated', { name: data.name, fields: data.changed.join(', ') }),
  ];
  if (data.snapshot !== null) {
    lines.push(t('functional_save_flow.safety', { snapshot: data.snapshot }));
  }
  if (data.not_undoable.length > 0) {
    lines.push(t('functional_save_flow.not_undoable', { fields: data.not_undoable.join(', ') }));
  }
  if (data.undo === 'withheld') lines.push(t('functional_save_flow.withheld'));
  if (data.undo === 'too_large') lines.push(t('functional_save_flow.too_large'));
  return lines.join('\n');
}
