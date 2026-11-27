// The view of `functional_get_validators`: the project's validators, one in full, the catalog
// validators that fit the project, or how strictly a load run enforces each kind. Names, reasons,
// prompts and level names are texts a person or a model wrote: they arrive in the data masked and
// made one line.

import type { Translator } from '../../context.js';
import { columns, keyValue, num } from '../primitives.js';

export interface ValidatorRow {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly category: string | null;
  /** `assertion`, `ai_semantic`, or the word the backend gave. */
  readonly type: string;
  readonly enabled: boolean;
  readonly priority: number;
  /** The name of the catalog validator it is made from; null for a custom one. */
  readonly base: string | null;
}

export interface ValidatorDetail extends ValidatorRow {
  readonly description: string | null;
  readonly engine: string | null;
  readonly scope: string | null;
  readonly needsReview: boolean;
  readonly autoConfigReason: string | null;
  readonly evaluatedAfterRun: boolean;
  /** How many parameters the validator takes, with their names (at most 20). */
  readonly parameters: readonly string[];
  readonly hasAiPrompt: boolean;
}

export interface ApplicableItem {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly type: string;
  readonly applicable: boolean;
  readonly reason: string;
  readonly activation: string;
  readonly requiresProfileFlags: readonly string[];
}

export interface ApplicableGroup {
  readonly group: string;
  readonly items: readonly ApplicableItem[];
}

export interface ValidatorsData {
  readonly project_id: string;
  readonly view: 'list' | 'applicable' | 'gatling_enforcement';
  /** The validators the backend returned (1 for one asked), or the catalog validators of `applicable`. */
  readonly count: number;
  readonly shown: number;
  readonly items: readonly ValidatorRow[];
  readonly validator: ValidatorDetail | null;
  readonly applicable: {
    readonly total: number;
    readonly applicableTotal: number;
    readonly groups: readonly ApplicableGroup[];
  } | null;
  readonly enforcement: {
    readonly defaultLevel: string;
    readonly levels: readonly { readonly kind: string; readonly level: string }[];
    readonly levelCount: number;
  } | null;
}

const enabledOf = (enabled: boolean, t: Translator): string =>
  t(enabled ? 'functional_get_validators.enabled' : 'functional_get_validators.disabled');

export function renderGetValidators(data: ValidatorsData, t: Translator): string {
  if (data.enforcement !== null) {
    const { defaultLevel, levels, levelCount } = data.enforcement;
    const lines = [t('functional_get_validators.enforcement', { level: defaultLevel })];
    lines.push(...levels.map((entry) => `  ${entry.kind}: ${entry.level}`));
    if (levels.length < levelCount) {
      lines.push(
        t('functional_get_validators.enforcement.more', {
          shown: levels.length,
          total: levelCount,
        }),
      );
    }
    return lines.join('\n');
  }
  if (data.applicable !== null) {
    const { applicable } = data;
    if (applicable.groups.length === 0) return t('functional_get_validators.applicable.none');
    const lines = [
      t('functional_get_validators.applicable', {
        applicable: num(applicable.applicableTotal, t.locale),
        total: num(applicable.total, t.locale),
      }),
    ];
    for (const group of applicable.groups) {
      lines.push(`${group.group}:`);
      for (const item of group.items) {
        const state = t(
          item.applicable
            ? 'functional_get_validators.applicable.yes'
            : 'functional_get_validators.applicable.no',
        );
        lines.push(`  ${item.name}  ${state}: ${item.reason}`);
      }
    }
    return lines.join('\n');
  }
  const one = data.validator;
  if (one !== null) {
    const rows: [string, string][] = [
      [t('functional_get_validators.label.name'), one.name],
      [t('functional_get_validators.label.type'), one.type],
      [t('functional_get_validators.label.category'), one.category ?? '—'],
      [t('functional_get_validators.label.state'), enabledOf(one.enabled, t)],
      [t('functional_get_validators.label.priority'), num(one.priority, t.locale)],
      [
        t('functional_get_validators.label.base'),
        one.base ?? t('functional_get_validators.custom'),
      ],
    ];
    if (one.scope !== null) rows.push([t('functional_get_validators.label.scope'), one.scope]);
    if (one.engine !== null) rows.push([t('functional_get_validators.label.engine'), one.engine]);
    if (one.description !== null) {
      rows.push([t('functional_get_validators.label.description'), one.description]);
    }
    if (one.parameters.length > 0) {
      rows.push([t('functional_get_validators.label.parameters'), one.parameters.join(', ')]);
    }
    if (one.needsReview) {
      rows.push([
        t('functional_get_validators.label.review'),
        one.autoConfigReason ?? t('functional_get_validators.review.yes'),
      ]);
    }
    return [t('functional_get_validators.one', { name: one.displayName }), ...keyValue(rows)].join(
      '\n',
    );
  }
  if (data.count === 0) return t('functional_get_validators.none');
  const lines = [t.plural('functional_get_validators.header', data.count)];
  lines.push(
    ...columns(
      data.items.map((row) => [
        String(row.priority),
        row.name,
        row.category ?? '—',
        row.type,
        enabledOf(row.enabled, t),
        row.base ?? t('functional_get_validators.custom'),
      ]),
      { align: ['right', 'left', 'left', 'left', 'left', 'left'] },
    ).map((row) => `  ${row}`),
  );
  if (data.shown < data.count) {
    lines.push(t('functional_get_validators.more', { shown: data.shown, total: data.count }));
  }
  return lines.join('\n');
}
