// The view of `flows_get_versions`: one line per stored version of a flow, or one version drawn as the
// outline `flows_get` shows, under a line that says which version it is. The texts arrive made one
// line and masked by the tool (`content` of tools/moduleCall.ts).

import type { Translator } from '../../context.js';
import type { FlowOutline } from '../../flow/outline.js';
import type { FlowQuestion } from '../../flow/questions.js';
import { renderFlowOutline } from '../views/flowOutline.js';

export interface VersionRow {
  readonly version: number;
  readonly created_at: string;
  /** A user id; null when the backend does not say. */
  readonly created_by: string | null;
  readonly change_reason: string | null;
}

export interface VersionsData {
  readonly mode: 'list' | 'version';
  readonly project_id: string;
  readonly flow: { readonly id: string; readonly name: string };
  /** The versions the flow has; 1 for one. */
  readonly count: number;
  readonly shown: number;
  readonly versions: readonly VersionRow[];
  /** The version asked for, with what it kept; null for the list. */
  readonly detail: {
    readonly row: VersionRow;
    readonly outline: FlowOutline;
    readonly questions: readonly FlowQuestion[];
  } | null;
}

const dayOf = (at: string): string | null => /^\d{4}-\d{2}-\d{2}/u.exec(at)?.[0] ?? null;

function rowLine(row: VersionRow): string {
  const day = dayOf(row.created_at);
  return [
    `v${String(row.version)}`,
    ...(day === null ? [] : [day]),
    ...(row.change_reason === null || row.change_reason === '' ? [] : [row.change_reason]),
  ].join(' · ');
}

export function renderGetVersions(data: VersionsData, t: Translator): string {
  if (data.mode === 'version' && data.detail !== null) {
    const { row, outline, questions } = data.detail;
    const day = dayOf(row.created_at);
    const header = t('flows_get_versions.version_header', {
      version: row.version,
      name: data.flow.name,
      day: day ?? '-',
    });
    const reason =
      row.change_reason === null || row.change_reason === '' ? '' : `: ${row.change_reason}`;
    return [`${header}${reason}`, renderFlowOutline(outline, t, { mode: 'full', questions })].join(
      '\n',
    );
  }
  if (data.count === 0) return t('flows_get_versions.empty', { name: data.flow.name });
  const lines = [t.plural('flows_get_versions.header', data.count, { name: data.flow.name })];
  for (const row of data.versions) lines.push(rowLine(row));
  if (data.shown < data.count) {
    lines.push(t('flows_get_versions.more', { shown: data.shown, count: data.count }));
  }
  return lines.join('\n');
}
