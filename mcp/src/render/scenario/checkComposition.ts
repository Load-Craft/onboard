// The view of `scenario_check_composition`: the verdict of the check, the issues between the members
// (errors, then warnings, each with the member, the step, the variable and what to do), the members
// whose scenario drifted since it was pinned, and the datasets the composition binds that are gone.
// The texts arrive made one line and masked by the tool (`content` of tools/moduleCall.ts); the view
// adds no text of the backend of its own.

import type { Translator } from '../../context.js';
import { decimal } from '../primitives.js';
import { momentOf } from './moment.js';
import { collisionLines, type SlotCollision } from './slotCollisions.js';

export interface IssueView {
  readonly level: 'error' | 'warning';
  readonly message: string;
  readonly scenario_id: string | null;
  readonly step_index: number | null;
  readonly suggestion: string | null;
  readonly variable: string | null;
}

export interface DriftedView {
  readonly scenario_id: string;
  readonly scenario_name: string | null;
  readonly variant_label: string;
  readonly pinned_version: number | null;
  readonly current_version: number | null;
  readonly drift_fields: readonly string[];
}

export interface CheckData {
  readonly project_id: string;
  readonly composition_id: string;
  /** Whether the composition can run. */
  readonly valid: boolean;
  /** Whether it is valid as written, before its members' drift is counted. */
  readonly authoring_valid: boolean;
  readonly effective_status: string;
  readonly has_drift: boolean;
  readonly scenario_count: number;
  /** The shares of the members, summed: 1 is the whole traffic. */
  readonly total_proportion: number;
  readonly last_validated_at: string | null;
  /** How many issues of each level the check found. */
  readonly errors: number;
  readonly warnings: number;
  /** How many issues the check found in all (errors and warnings). */
  readonly issues: number;
  /** The issues the data lists: the first 20. */
  readonly issue_list: readonly IssueView[];
  readonly drifted: readonly DriftedView[];
  readonly missing_bound_feeders: readonly string[];
  /** Slots the members declare differently (names only): one dataset cannot fit them. */
  readonly slot_collisions: readonly SlotCollision[];
}

function issueLines(issue: IssueView, t: Translator): string[] {
  const where = [
    issue.scenario_id === null ? null : issue.scenario_id,
    issue.step_index === null
      ? null
      : t('scenario_check_composition.step', { n: issue.step_index + 1 }),
    issue.variable === null
      ? null
      : t('scenario_check_composition.variable', { name: issue.variable }),
  ].filter((part): part is string => part !== null);
  const head = `  ${t(`scenario_check_composition.${issue.level}`)}: “${issue.message}”`;
  return [
    where.length === 0 ? head : `${head} (${where.join(', ')})`,
    ...(issue.suggestion === null
      ? []
      : [`    ${t('scenario_check_composition.suggestion', { text: issue.suggestion })}`]),
  ];
}

export function renderCompositionCheck(data: CheckData, t: Translator): string {
  const lines = [
    t(data.valid ? 'scenario_check_composition.valid' : 'scenario_check_composition.invalid', {
      id: data.composition_id,
      at: data.last_validated_at === null ? '-' : momentOf(data.last_validated_at),
    }),
  ];
  if (!data.authoring_valid && data.valid) lines.push(t('scenario_check_composition.authoring'));
  lines.push(
    t('scenario_check_composition.shares', {
      members: data.scenario_count,
      percent: decimal(data.total_proportion * 100, 1, t.locale),
    }),
  );
  if (data.issue_list.length > 0) {
    lines.push(
      t('scenario_check_composition.issues', { errors: data.errors, warnings: data.warnings }),
    );
    for (const issue of data.issue_list) lines.push(...issueLines(issue, t));
    const rest = data.issues - data.issue_list.length;
    if (rest > 0) lines.push(t('scenario_check_composition.more', { count: rest }));
  } else {
    lines.push(t('scenario_check_composition.no_issues'));
  }
  if (data.drifted.length > 0) {
    lines.push(t.plural('scenario_check_composition.drift', data.drifted.length));
    for (const member of data.drifted) {
      const name = member.scenario_name ?? member.scenario_id;
      const label = member.variant_label === '' ? '' : ` “${member.variant_label}”`;
      const versions =
        member.pinned_version !== null && member.current_version !== null
          ? t('scenario_check_composition.versions', {
              pinned: member.pinned_version,
              current: member.current_version,
            })
          : '';
      const fields = member.drift_fields.length === 0 ? '' : `; ${member.drift_fields.join(', ')}`;
      lines.push(
        `  ${name}${label} [${member.scenario_id}]${versions === '' ? '' : ` ${versions}`}${fields}`,
      );
    }
  }
  if (data.missing_bound_feeders.length > 0) {
    lines.push(
      t('scenario_check_composition.missing_feeders', {
        names: data.missing_bound_feeders.join(', '),
      }),
    );
  }
  lines.push(...collisionLines(data.slot_collisions, t));
  lines.push(...collisionLines(data.slot_collisions, t));
  return lines.join('\n');
}
