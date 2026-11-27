// The view of `scenario_get_composition`: the composition's name, id and status, its members with the
// share of the traffic, the pinned and the current version of each scenario and the drift, the load
// profile, the names of the default headers (never their values), the pauses and the stored verdict
// of the last check. Texts arrive made one line and masked by the tool (`content` and `body` of
// tools/moduleCall.ts); the view adds no text of the backend of its own.

import type { Translator } from '../../context.js';
import { decimal } from '../primitives.js';
import { momentOf } from './moment.js';

export interface MemberView {
  readonly link_id: string;
  readonly scenario_id: string;
  readonly scenario_name: string | null;
  readonly variant_label: string;
  /** The share of the traffic, 0 to 1. */
  readonly proportion: number;
  readonly enabled: boolean;
  readonly pinned_version: number | null;
  readonly current_version: number | null;
  readonly has_drift: boolean;
  readonly drift_fields: readonly string[];
  readonly think_time_ms: number | null;
  /** Whether the member has an injection of its own instead of the composition's. */
  readonly own_injection: boolean;
  /** How many datasets feed the member. */
  readonly datasets: number;
}

export interface ValidationView {
  readonly is_valid: boolean;
  readonly authoring_valid: boolean;
  readonly effective_status: string;
  readonly last_validated_at: string | null;
  readonly total_proportion: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly missing_bound_feeders: readonly string[];
}

export type LoadProfileView =
  | { readonly kind: 'shown'; readonly text: string; readonly truncated: boolean }
  | { readonly kind: 'hidden'; readonly bytes: number }
  | { readonly kind: 'none' };

/** The load test type of the composition: its kind and the plain parameters it was set with. */
export interface TestTypeView {
  readonly type: string | null;
  readonly params: Readonly<Record<string, string | number | boolean>>;
}

export interface CompositionView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly mode: string;
  readonly updated_at: string | null;
  readonly members: readonly MemberView[];
  /** The test type set on the composition (`scenario_set_composition_type`); null when none is. */
  readonly test_type: TestTypeView | null;
  readonly load_profile: LoadProfileView;
  /** The names of the default headers; the values are never read. */
  readonly header_names: readonly string[];
  readonly header_count: number;
  readonly think_time_ms: number | null;
  readonly pause_distribution: string;
  readonly throttle_steps: number;
  readonly bound_slots: number;
  readonly validation: ValidationView | null;
}

export interface CompositionData {
  readonly project_id: string;
  readonly composition: CompositionView;
}

function memberLine(member: MemberView, index: number, t: Translator): string {
  const name = member.scenario_name ?? member.scenario_id;
  const label = member.variant_label === '' ? '' : ` “${member.variant_label}”`;
  const share = t('scenario_get_composition.share', {
    percent: decimal(member.proportion * 100, 1, t.locale),
  });
  const versions =
    member.pinned_version === null
      ? []
      : [
          member.current_version === null || member.current_version === member.pinned_version
            ? t('scenario_get_composition.pinned', { pinned: member.pinned_version })
            : t(
                member.has_drift
                  ? 'scenario_get_composition.drifted'
                  : 'scenario_get_composition.same_content',
                { pinned: member.pinned_version, current: member.current_version },
              ),
        ];
  const facts = [
    share,
    ...versions,
    ...(member.enabled ? [] : [t('scenario_get_composition.off')]),
    ...(member.own_injection ? [t('scenario_get_composition.own_injection')] : []),
    ...(member.datasets > 0
      ? [t.plural('scenario_get_composition.datasets', member.datasets)]
      : []),
  ];
  return `  ${String(index + 1)}. ${name}${label} [${member.scenario_id}]: ${facts.join(', ')}`;
}

export function renderComposition(data: CompositionData, t: Translator): string {
  const c = data.composition;
  const lines = [`${c.name} [${c.id}] — ${c.status}`];
  if (c.description !== null && c.description !== '') lines.push(c.description);
  lines.push(t.plural('scenario_get_composition.members', c.members.length));
  c.members.forEach((member, index) => lines.push(memberLine(member, index, t)));
  const type = c.test_type;
  if (type === null) {
    lines.push(t('scenario_get_composition.no_test_type'));
  } else {
    const params = Object.entries(type.params).map(([name, value]) => `${name} ${String(value)}`);
    lines.push(
      t('scenario_get_composition.test_type', {
        type: type.type ?? '-',
        params: params.length === 0 ? '' : ` (${params.join(', ')})`,
      }),
    );
  }
  const load = c.load_profile;
  if (load.kind === 'shown') {
    lines.push(t('scenario_get_composition.load', { profile: load.text }));
    if (load.truncated) lines.push(t('scenario_get_composition.load_cut'));
  } else if (load.kind === 'hidden') {
    lines.push(t('scenario_get_composition.load_hidden', { bytes: load.bytes }));
  }
  lines.push(
    c.header_count === 0
      ? t('scenario_get_composition.no_headers')
      : t('scenario_get_composition.headers', {
          names:
            c.header_names.join(', ') +
            (c.header_count > c.header_names.length
              ? `, +${String(c.header_count - c.header_names.length)}`
              : ''),
        }),
  );
  lines.push(
    c.think_time_ms === null
      ? t('scenario_get_composition.pauses_members', { distribution: c.pause_distribution })
      : t('scenario_get_composition.pauses', {
          distribution: c.pause_distribution,
          think: `${String(c.think_time_ms)} ms`,
        }),
  );
  const v = c.validation;
  if (v === null) {
    lines.push(t('scenario_get_composition.no_check'));
  } else {
    const at = v.last_validated_at === null ? null : momentOf(v.last_validated_at);
    const state = v.is_valid ? (v.warnings.length > 0 ? 'valid_warnings' : 'valid') : 'invalid';
    lines.push(
      t(`scenario_get_composition.check_${state}${at === null ? '_nodate' : ''}`, {
        at: at ?? '',
        count: v.warnings.length,
      }),
    );
    for (const error of v.errors)
      lines.push(`  ${t('scenario_get_composition.error', { text: `“${error}”` })}`);
    for (const warning of v.warnings) {
      lines.push(`  ${t('scenario_get_composition.warning', { text: `“${warning}”` })}`);
    }
    if (v.missing_bound_feeders.length > 0) {
      lines.push(
        `  ${t('scenario_get_composition.missing_feeders', { names: v.missing_bound_feeders.join(', ') })}`,
      );
    }
  }
  return lines.join('\n');
}
