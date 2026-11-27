// The view of `scenario_get_versions`: the versions of a scenario, newest first, one line each; or one
// version with its stored artifact. Texts arrive made one line and masked by the tool (`content` and
// `body` of tools/moduleCall.ts); the view adds no text of the backend of its own.

import type { Translator } from '../../context.js';
import { artifactLines, type ArtifactView } from './get.js';
import { momentOf } from './moment.js';

export interface VersionItem {
  readonly version: number;
  readonly id: string;
  readonly created_at: string | null;
  readonly change_reason: string | null;
  /** False: the backend refuses to restore the version while the scenario has an artifact. */
  readonly has_artifact_snapshot: boolean;
  /** Set on a variant cut after a block. */
  readonly cut: boolean;
}

export interface VersionsData {
  readonly mode: 'list' | 'one';
  readonly project_id: string;
  readonly scenario_id: string;
  /** How many versions the scenario has (1 for one). */
  readonly count: number;
  /** How many of them the data carries. */
  readonly shown: number;
  readonly versions: readonly VersionItem[];
  /** The stored artifact of the one version asked for; null in the list. */
  readonly artifact: ArtifactView | null;
}

function lineOf(item: VersionItem, t: Translator): string {
  const facts = [
    item.created_at === null ? null : momentOf(item.created_at),
    item.cut ? t('scenario_get_versions.cut') : null,
    item.has_artifact_snapshot ? null : t('scenario_get_versions.no_snapshot'),
  ].filter((fact): fact is string => fact !== null);
  const reason =
    item.change_reason === null || item.change_reason === '' ? '' : ` — ${item.change_reason}`;
  return `v${String(item.version)}${facts.length === 0 ? '' : ` (${facts.join(', ')})`}${reason}`;
}

export function renderScenarioVersions(data: VersionsData, t: Translator): string {
  if (data.mode === 'one') {
    const [item] = data.versions;
    if (item === undefined) return t('scenario_get_versions.empty');
    return [
      t('scenario_get_versions.one', { id: data.scenario_id, line: lineOf(item, t) }),
      ...(data.artifact === null ? [] : artifactLines(data.artifact, t)),
    ].join('\n');
  }
  if (data.count === 0) return t('scenario_get_versions.empty');
  const lines = [t.plural('scenario_get_versions.header', data.count, { id: data.scenario_id })];
  for (const item of data.versions) lines.push(lineOf(item, t));
  if (data.shown < data.count) {
    lines.push(t('scenario_get_versions.more', { shown: data.shown, total: data.count }));
  }
  return lines.join('\n');
}
