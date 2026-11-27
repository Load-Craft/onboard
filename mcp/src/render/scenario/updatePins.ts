// The view of `scenario_update_pins`: the members that moved to the current versions of their scenarios.
// The names arrive made one line and masked by the tool (`content` of tools/moduleCall.ts).

import type { Translator } from '../../context.js';

export interface PinMove {
  readonly link_id: string;
  readonly scenario_id: string;
  /** The scenario's name. */
  readonly scenario: string;
  readonly from: number | null;
  readonly to: number | null;
}

export interface UpdatePinsData {
  readonly project_id: string;
  readonly composition: { readonly id: string };
  /** The composition's name. */
  readonly name: string;
  /** How many members were moved. */
  readonly count: number;
  readonly members: readonly PinMove[];
  /** Members that still drift after the last write. */
  readonly still_drifted: number;
  /** Members pinned to no version: they follow the current version of their scenario by themselves. */
  readonly unpinned: number;
  /** Members pinned to an older version number whose content is the current one (drift is decided by content). */
  readonly same_content: number;
}

const version = (value: number | null): string => (value === null ? '?' : `v${String(value)}`);

export function renderUpdatePins(data: UpdatePinsData, t: Translator): string {
  if (data.count === 0) {
    const lines = [t('scenario_update_pins.none', { name: data.name })];
    if (data.unpinned > 0) lines.push(t.plural('scenario_update_pins.unpinned', data.unpinned));
    if (data.same_content > 0) {
      lines.push(t.plural('scenario_update_pins.same_content', data.same_content));
    }
    return lines.join('\n');
  }
  const lines = [t.plural('scenario_update_pins.done', data.count, { name: data.name })];
  for (const move of data.members) {
    lines.push(
      t('scenario_update_pins.member', {
        scenario: move.scenario,
        from: version(move.from),
        to: version(move.to),
      }),
    );
  }
  if (data.members.length < data.count) {
    lines.push(t('scenario_update_pins.more', { shown: data.members.length, total: data.count }));
  }
  if (data.still_drifted > 0) {
    lines.push(t('scenario_update_pins.still', { count: data.still_drifted }));
  }
  return lines.join('\n');
}
