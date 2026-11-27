// The view of `scenario_get`: the scenario's name, version and id, where it came from, the state of
// its self-check and its data slots; with `include` the variable contract, the drift score and the
// stored artifact. Texts arrive made one line and masked by the tool (`content` and `body` of
// tools/moduleCall.ts); the view adds no text of the backend of its own.

import type { Translator } from '../../context.js';
import { decimal } from '../primitives.js';
import { momentOf } from './moment.js';

export interface SlotItem {
  readonly slot: string;
  readonly label: string | null;
  readonly role: string | null;
  readonly identity_kind: string | null;
  readonly strategy: string | null;
  /** `bound` when a dataset feeds the slot, `stale` when the binding no longer fits, else `unbound`. */
  readonly binding: 'bound' | 'stale' | 'unbound';
}

export interface SelfCheckView {
  readonly status: string;
  /** The version of the scenario the check ran on. */
  readonly version: number;
  readonly notes: readonly string[];
  readonly missing_slots: readonly string[];
  readonly repairs: number;
  readonly failure: {
    readonly request_name: string | null;
    readonly http_status: number | null;
    readonly message: string;
  } | null;
}

export interface ContractView {
  readonly required_inputs: readonly string[];
  readonly exports: readonly string[];
  readonly session_vars: readonly string[];
  readonly control_vars: readonly string[];
  readonly locals: readonly string[];
}

/** Drift: `read` carries the score (0 fresh, 1 stale); `none` means no check cached one yet. */
export type DriftView =
  | { readonly state: 'read'; readonly score: number; readonly checked_at: string }
  | { readonly state: 'none' }
  | { readonly state: 'unavailable' };

export type ArtifactView =
  | { readonly kind: 'shown'; readonly text: string; readonly truncated: boolean }
  | { readonly kind: 'hidden'; readonly type: string | null; readonly bytes: number }
  | { readonly kind: 'none' };

export interface ScenarioDetailView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly version: number;
  readonly is_active: boolean;
  readonly class_name: string;
  readonly source_flow_id: string | null;
  readonly source_flow_version: number | null;
  readonly generator_state: string | null;
  readonly tags: readonly string[];
  readonly self_check: SelfCheckView | null;
  readonly slots: readonly SlotItem[];
}

export interface ScenarioGetData {
  readonly project_id: string;
  readonly scenario: ScenarioDetailView;
  /** Present with `include: ["contract"]`; null when the read failed. */
  readonly contract: ContractView | null;
  readonly contract_state: 'none' | 'read' | 'unavailable';
  /** Present with `include: ["drift"]`. */
  readonly drift: DriftView | null;
  /** Present with `include: ["artifact"]`. */
  readonly artifact: ArtifactView | null;
}

const GENERATED_FROM = /^Generated from flow\b/iu;

const list = (names: readonly string[], t: Translator): string =>
  names.length === 0 ? t('scenario_get.none') : names.join(', ');

function slotLine(slot: SlotItem, t: Translator): string {
  const facts = [slot.role, slot.identity_kind, slot.strategy].filter(
    (fact): fact is string => fact !== null,
  );
  const label = slot.label === null || slot.label === slot.slot ? '' : ` “${slot.label}”`;
  const detail = facts.length === 0 ? '' : ` (${facts.join(', ')})`;
  return `  - ${slot.slot}${label}${detail}: ${t(`scenario_get.binding.${slot.binding}`)}`;
}

/** The lines of a stored artifact: its masked text, or why there is none to show. */
export function artifactLines(artifact: ArtifactView, t: Translator): string[] {
  if (artifact.kind === 'shown') {
    return [
      t('scenario_get.artifact'),
      artifact.text,
      ...(artifact.truncated ? [t('scenario_get.artifact_cut')] : []),
    ];
  }
  if (artifact.kind === 'hidden') {
    return [t('scenario_get.artifact_hidden', { bytes: artifact.bytes })];
  }
  return [t('scenario_get.artifact_none')];
}

export function renderScenarioGet(data: ScenarioGetData, t: Translator): string {
  const s = data.scenario;
  const lines = [
    `${s.name} v${String(s.version)} [${s.id}]${s.is_active ? '' : ` (${t('scenario_get.inactive')})`}`,
  ];
  // the generator describes a scenario as "Generated from flow …": the source flow line says so
  if (s.description !== null && s.description !== '' && !GENERATED_FROM.test(s.description)) {
    lines.push(s.description);
  }
  lines.push(
    s.source_flow_id === null
      ? t('scenario_get.no_flow')
      : t('scenario_get.from_flow', {
          flow: s.source_flow_id,
          version: s.source_flow_version ?? 0,
        }),
  );
  if (s.generator_state === 'built_with_older_generator') {
    lines.push(t('scenario_get.older_generator'));
  }
  const check = s.self_check;
  if (check === null) {
    lines.push(t('scenario_get.check.none'));
  } else {
    const state = t(`scenario.check_state.${check.status}`);
    lines.push(
      check.version === s.version
        ? t('scenario_get.check', { state })
        : t('scenario_get.check_old', { state, checked: check.version, current: s.version }),
    );
    if (check.failure !== null) {
      const where = [
        check.failure.request_name,
        check.failure.http_status === null ? null : String(check.failure.http_status),
      ].filter((part): part is string => part !== null);
      lines.push(
        t('scenario_get.failure', {
          where: where.length === 0 ? t('scenario_get.none') : where.join(' '),
          message: check.failure.message,
        }),
      );
    }
    if (check.missing_slots.length > 0) {
      lines.push(t('scenario_get.missing_slots', { slots: check.missing_slots.join(', ') }));
    }
    if (check.repairs > 0) lines.push(t.plural('scenario_get.repairs', check.repairs));
    for (const note of check.notes) lines.push(`  ${note}`);
  }
  lines.push(
    s.slots.length === 0
      ? t('scenario_get.no_slots')
      : t.plural('scenario_get.slots', s.slots.length),
  );
  for (const slot of s.slots) lines.push(slotLine(slot, t));
  if (data.contract_state === 'unavailable') lines.push(t('scenario_get.contract_unavailable'));
  if (data.contract !== null) {
    const c = data.contract;
    lines.push(t('scenario_get.contract'));
    lines.push(`  ${t('scenario_get.contract.inputs', { names: list(c.required_inputs, t) })}`);
    lines.push(`  ${t('scenario_get.contract.exports', { names: list(c.exports, t) })}`);
    lines.push(`  ${t('scenario_get.contract.session', { names: list(c.session_vars, t) })}`);
  }
  const drift = data.drift;
  if (drift !== null) {
    if (drift.state === 'read') {
      lines.push(
        t('scenario_get.drift', {
          score: decimal(drift.score, 2, t.locale),
          checked: momentOf(drift.checked_at),
        }),
      );
    } else {
      lines.push(t(`scenario_get.drift.${drift.state}`));
    }
  }
  if (data.artifact !== null) lines.push(...artifactLines(data.artifact, t));
  return lines.join('\n');
}
