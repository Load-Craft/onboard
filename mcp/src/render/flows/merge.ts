// The view of `flows_merge`: the new flow and what the backend warned about. The texts arrive made one
// line and masked by the tool (`content` of tools/moduleCall.ts).

import type { Translator } from '../../context.js';

export interface MergeData {
  readonly project_id: string;
  readonly flow: { readonly id: string };
  /** The new flow's name. */
  readonly name: string;
  /** How many flows were merged. */
  readonly count: number;
  readonly version: number;
  /** The ids of the flows merged, in the order given. */
  readonly sources: readonly string[];
  readonly warnings: readonly string[];
}

export function renderMerge(data: MergeData, t: Translator): string {
  return [
    t('flows_merge.done', { name: data.name, count: data.count }),
    ...data.warnings.map((warning) => t('flows_merge.warning', { warning })),
  ].join('\n');
}
