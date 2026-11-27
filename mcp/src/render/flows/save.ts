// The view of `flows_save`: what the save did to the flow, in one line. The names and the reason arrive
// made one line and masked by the tool (`content` of tools/moduleCall.ts). The variables of a flow, its
// blocks and their values are never in the data, so the view cannot show one.

import type { Translator } from '../../context.js';

export type SaveChange = 'name' | 'description' | 'graph';

export interface SaveFlowData {
  readonly project_id: string;
  readonly flow: { readonly id: string };
  /** The flow's name after the call (the `{name}` of the log entry). */
  readonly name: string;
  /** The version of the flow after the call. */
  readonly version: number;
  /** The version before; null for a new flow. */
  readonly previous_version: number | null;
  readonly created: boolean;
  readonly changed: readonly SaveChange[];
  readonly renamed_from: string | null;
  /** The steps of the outline of the flow after the call. */
  readonly steps: number;
  readonly dropped: readonly { readonly num: string; readonly name: string }[];
  readonly reason: string | null;
}

export function renderSaveFlow(data: SaveFlowData, t: Translator): string {
  if (data.created) {
    return t('flows_save.created', {
      name: data.name,
      version: data.version,
      steps: t.plural('flows_save.steps', data.steps),
    });
  }
  if (data.changed.length === 0) return t('flows_save.unchanged', { name: data.name });
  if (data.changed.includes('graph')) {
    const what =
      data.dropped.length > 0
        ? t('flows_save.dropped', {
            steps: data.dropped.map((item) => `${item.num} (${item.name})`).join(', '),
          })
        : t('flows_save.graph_replaced');
    const reason =
      data.reason === null ? '' : ` ${t('flows_save.reason', { reason: data.reason })}`;
    return `${t('flows_save.saved', {
      name: data.name,
      version: data.version,
      previous: data.previous_version ?? '-',
      what,
    })}${reason}`;
  }
  const parts: string[] = [];
  if (data.changed.includes('name')) {
    parts.push(t('flows_save.renamed', { name: data.name, from: data.renamed_from ?? '' }));
  }
  if (data.changed.includes('description')) {
    parts.push(
      data.changed.includes('name')
        ? t('flows_save.description_changed')
        : t('flows_save.described', { name: data.name }),
    );
  }
  return parts.join(' ');
}
