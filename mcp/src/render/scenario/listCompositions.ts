// The view of `scenario_list_compositions`: one line per composition, its name with the id, then its
// status, how many members it has and whether the members drifted from the scenarios. The names
// arrive made one line and masked by the tool (`content` of tools/moduleCall.ts); the view adds no
// text of the backend of its own.

import type { Translator } from '../../context.js';

export interface CompositionItem {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  /** How many scenarios the composition has, and how many of them are enabled. */
  readonly members: number;
  readonly enabled_members: number;
  /** Whether a member's scenario changed since the composition pinned it. */
  readonly has_drift: boolean;
  /** The stored verdict of the last check; null when the answer carries none. */
  readonly valid: boolean | null;
  readonly updated_at: string | null;
}

export interface CompositionListData {
  readonly project_id: string;
  /** The status the list was narrowed to; null for all. */
  readonly status: string | null;
  /** How many compositions the project has (of that status). */
  readonly count: number;
  /** How many of them the data carries. */
  readonly shown: number;
  readonly compositions: readonly CompositionItem[];
}

export function renderCompositionList(data: CompositionListData, t: Translator): string {
  if (data.count === 0) {
    return data.status === null
      ? t('scenario_list_compositions.empty')
      : t('scenario_list_compositions.empty_status', { status: data.status });
  }
  const lines = [
    data.status === null
      ? t.plural('scenario_list_compositions.header', data.count)
      : t.plural('scenario_list_compositions.header_status', data.count, { status: data.status }),
  ];
  data.compositions.forEach((item, index) => {
    const facts = [
      item.status,
      t.plural('scenario_list_compositions.members', item.members),
      ...(item.enabled_members < item.members
        ? [t('scenario_list_compositions.enabled', { count: item.enabled_members })]
        : []),
      ...(item.valid === false ? [t('scenario_list_compositions.invalid')] : []),
      ...(item.has_drift ? [t('scenario_list_compositions.drift')] : []),
    ];
    lines.push(`${String(index + 1)}. ${item.name} [${item.id}] — ${facts.join(', ')}`);
  });
  if (data.shown < data.count) {
    lines.push(t('scenario_list_compositions.more', { shown: data.shown, total: data.count }));
  }
  return lines.join('\n');
}
