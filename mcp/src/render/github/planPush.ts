// The view of `github_plan_push`: the files the push of a composition would change, each with its
// status and the lines it adds and removes, optionally a short diff under each. Nothing is written.

import type { Translator } from '../../context.js';
import { num } from '../primitives.js';

export interface PlannedFile {
  readonly path: string;
  readonly status: 'new' | 'modified';
  readonly additions: number;
  readonly deletions: number;
  /** With `diffs`, for the first 10 files: at most 40 lines. */
  readonly diff?: readonly string[];
}

export interface PlanPushData {
  readonly composition_id: string;
  /** How many files would change (the log slot `{files}`). */
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
  readonly shown: number;
  readonly file_list: readonly PlannedFile[];
}

function changes(additions: number, deletions: number, t: Translator): string {
  const parts = [`+${num(additions, t.locale)}`];
  if (deletions > 0) parts.push(`−${num(deletions, t.locale)}`);
  return `(${parts.join(' ')})`;
}

export function renderPlanPush(data: PlanPushData, t: Translator): string {
  if (data.files === 0) {
    return t('github_plan_push.nothing', { composition: data.composition_id });
  }
  const lines = [
    t('github_plan_push.header', {
      composition: data.composition_id,
      files: num(data.files, t.locale),
      changes: `(+${num(data.additions, t.locale)} −${num(data.deletions, t.locale)})`,
    }),
  ];
  for (const file of data.file_list) {
    const diff = file.diff ?? [];
    lines.push(
      `  ${t(`github_plan_push.status.${file.status}`)} ${file.path} ${changes(file.additions, file.deletions, t)}${
        diff.length > 0 ? ':' : ''
      }`,
    );
    for (const line of diff) lines.push(`    ${line}`);
  }
  if (data.shown < data.files) {
    lines.push(t('github_plan_push.more', { shown: data.shown, total: data.files }));
  }
  return lines.join('\n');
}
