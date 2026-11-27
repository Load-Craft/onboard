// The view of `scenario_set_composition_type`: the new test type, the one before, and the datasets that now
// need more rows. The names arrive made one line and masked by the tool (`content` of tools/moduleCall.ts).

import type { Translator } from '../../context.js';

export interface DataAdvice {
  /** The scenario of the member. */
  readonly scenario: string;
  readonly dataset: string;
  /** Rows the new type needs. */
  readonly required: number;
  /** Rows the dataset has. */
  readonly rows: number;
  /** How the dataset is iterated; the backend sizes it by that (peak concurrency, or rate and duration). */
  readonly strategy: string | null;
  /** Why the backend sized no rows for it, by name; null when it did. */
  readonly refusal: string | null;
}

/** What the log keeps for taking the change back. */
export type TypeUndo = 'kept' | 'no_previous' | 'unknown_previous' | 'none';

export interface SetCompositionTypeData {
  readonly project_id: string;
  readonly composition: { readonly id: string };
  /** The composition's name. */
  readonly name: string;
  readonly type: string;
  /** The type before; null when the composition had none. */
  readonly previous_type: string | null;
  readonly changed: boolean;
  /** How many datasets have fewer rows than the new type needs. */
  readonly short: number;
  readonly advice: readonly DataAdvice[];
  readonly undo: TypeUndo;
}

/** How the backend sizes a dataset, by its iteration strategy; null for one it does not size by a known rule. */
function basisOf(strategy: string | null, t: Translator): string | null {
  if (strategy === 'circular' || strategy === 'random') {
    return t('scenario_set_composition_type.basis_peak', { strategy });
  }
  if (strategy === 'queue' || strategy === 'shuffle') {
    return t('scenario_set_composition_type.basis_rate', { strategy });
  }
  return null;
}

export function renderSetCompositionType(data: SetCompositionTypeData, t: Translator): string {
  if (!data.changed) {
    return t('scenario_set_composition_type.unchanged', { name: data.name, type: data.type });
  }
  const lines = [
    data.previous_type === null
      ? t('scenario_set_composition_type.done_new', { name: data.name, type: data.type })
      : t('scenario_set_composition_type.done', {
          name: data.name,
          type: data.type,
          previous: data.previous_type,
        }),
  ];
  if (data.short === 0) {
    lines.push(t('scenario_set_composition_type.data_ok'));
  } else {
    for (const item of data.advice) {
      lines.push(
        t('scenario_set_composition_type.grow', {
          scenario: item.scenario,
          dataset: item.dataset,
          rows: item.rows,
          required: item.required,
        }),
      );
      const basis = basisOf(item.strategy, t);
      if (basis !== null) lines.push(`  ${basis}`);
      if (item.refusal !== null) {
        lines.push(`  ${t('scenario_set_composition_type.refusal', { reason: item.refusal })}`);
      }
    }
    if (data.advice.length < data.short) {
      lines.push(
        t('scenario_set_composition_type.more', { shown: data.advice.length, total: data.short }),
      );
    }
  }
  if (data.undo === 'no_previous') lines.push(t('scenario_set_composition_type.no_previous'));
  if (data.undo === 'unknown_previous')
    lines.push(t('scenario_set_composition_type.unknown_previous'));
  return lines.join('\n');
}
