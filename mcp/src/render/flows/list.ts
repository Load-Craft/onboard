// The view of `flows_list`: one numbered line per flow with its type, version, step count and what
// is open on it. The names arrive made one line and masked by the tool (`content` of
// tools/moduleCall.ts); the view adds no text of the backend of its own.

import type { Translator } from '../../context.js';

export interface FlowRow {
  readonly id: string;
  readonly name: string;
  readonly flow_type: string;
  readonly version: number;
  readonly steps: number;
  /** Open questions of the generator on the flow. */
  readonly needs_input: number;
  /** Of them, the ones whose steps fail as built. */
  readonly needs_input_definite: number;
  readonly is_active: boolean;
  readonly spec_status: string | null;
  readonly updated_at: string;
}

export interface FlowsListData {
  readonly project_id: string;
  /** The flows of the project. */
  readonly total: number;
  /** The flows the backend returned (at most 100, newest changes first). */
  readonly fetched: number;
  /** The fetched flows that match the query; all of them without one. */
  readonly count: number;
  readonly shown: number;
  readonly query: string | null;
  readonly flows: readonly FlowRow[];
}

function line(flow: FlowRow, index: number, t: Translator): string {
  const parts = [
    `${String(index + 1)}. ${flow.name} (${flow.flow_type}) v${String(flow.version)}`,
    t.plural('flows_list.steps', flow.steps),
  ];
  if (flow.needs_input > 0) {
    parts.push(
      t('flows_list.open', { count: flow.needs_input, definite: flow.needs_input_definite }),
    );
  }
  if (!flow.is_active) parts.push(t('flows_list.inactive'));
  if (flow.spec_status === 'outdated') parts.push(t('flows_list.outdated'));
  return parts.join(', ');
}

export function renderFlowsList(data: FlowsListData, t: Translator): string {
  if (data.fetched === 0) return t('flows_list.empty');
  if (data.count === 0) {
    return t('flows_list.no_match', { query: data.query ?? '', fetched: data.fetched });
  }
  const lines = [t.plural('flows_list.header', data.count)];
  data.flows.forEach((flow, index) => lines.push(line(flow, index, t)));
  if (data.shown < data.count) {
    lines.push(t('flows_list.more', { shown: data.shown, count: data.count }));
  }
  if (data.total > data.fetched) {
    lines.push(t('flows_list.cut', { total: data.total, fetched: data.fetched }));
  }
  return lines.join('\n');
}
