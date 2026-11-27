// The view of `scenario_list`: two lines per scenario, the name with its version and id, then the
// flow it came from and the state of its self-check. The names arrive made one line and masked by
// the tool (`content` of tools/moduleCall.ts); the view adds no text of the backend of its own.

import type { Translator } from '../../context.js';

export interface ScenarioItem {
  readonly id: string;
  readonly name: string;
  readonly source_flow_id: string | null;
  readonly source_flow_version: number | null;
  /** The current version of the scenario. */
  readonly version: number;
  /** The latest self-check; null when it never ran. */
  readonly self_check: { readonly status: string; readonly version: number } | null;
  readonly generator_state: string | null;
  /** How many data slots the scenario has. */
  readonly slots: number;
  readonly updated_at: string | null;
}

export interface ScenarioListData {
  readonly project_id: string;
  /** How many scenarios the project has. */
  readonly count: number;
  /** How many of them the data carries. */
  readonly shown: number;
  readonly scenarios: readonly ScenarioItem[];
}

/** The state of a self-check as a phrase; a check of an older version says which. */
export function selfCheckPhrase(item: ScenarioItem, t: Translator): string {
  const check = item.self_check;
  if (check === null) return t('scenario.check_state.none');
  const status = t(`scenario.check_state.${check.status}`);
  return check.version === item.version
    ? status
    : t('scenario.check_state.stale', { status, checked: check.version, current: item.version });
}

export function renderScenarioList(data: ScenarioListData, t: Translator): string {
  if (data.count === 0) return t('scenario_list.empty');
  const lines = [t.plural('scenario_list.header', data.count)];
  data.scenarios.forEach((item, index) => {
    lines.push(`${String(index + 1)}. ${item.name} v${String(item.version)} [${item.id}]`);
    const from =
      item.source_flow_id === null
        ? t('scenario_list.no_flow')
        : t('scenario_list.from_flow', {
            flow: item.source_flow_id,
            version: item.source_flow_version ?? 0,
          });
    lines.push(`   ${from}; ${t('scenario_list.check', { state: selfCheckPhrase(item, t) })}`);
    if (item.generator_state === 'built_with_older_generator') {
      lines.push(`   ${t('scenario_list.older_generator')}`);
    }
  });
  if (data.shown < data.count) {
    lines.push(t('scenario_list.more', { shown: data.shown, total: data.count }));
  }
  return lines.join('\n');
}
