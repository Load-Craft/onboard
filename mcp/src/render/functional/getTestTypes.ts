// The view of `functional_get_test_types`: the project's test types, one line each, or one test type
// in full, or the values that count as success. Names, descriptions and outcomes are texts a person or
// a model wrote: they arrive in the data masked and made one line.

import type { Translator } from '../../context.js';
import { columns, keyValue, num } from '../primitives.js';

export interface TestTypeRow {
  readonly id: string;
  /** The name the project uses (custom or the base type's). */
  readonly name: string;
  readonly displayName: string;
  readonly category: string | null;
  readonly enabled: boolean;
  readonly priority: number;
  readonly defaultCount: number;
  /** The name of the base type it is made from; null for a custom type. */
  readonly base: string | null;
  readonly expectedOutcome: string | null;
}

export interface TestTypeDetail extends TestTypeRow {
  readonly description: string | null;
  readonly examples: number;
  readonly pollTimeoutMs: number | null;
  readonly pollCompletion: readonly string[];
}

export interface OutcomeCandidate {
  readonly value: string;
  readonly source: 'observed' | 'spec_enum' | 'other';
  readonly field: string | null;
}

export interface TestTypesData {
  readonly project_id: string;
  readonly view: 'list' | 'expected_outcomes';
  /** The test types the backend returned (1 for one asked), and how many the data lists. */
  readonly count: number;
  readonly shown: number;
  readonly items: readonly TestTypeRow[];
  /** Set when one test type was asked for. */
  readonly testType: TestTypeDetail | null;
  /** Set by the view `expected_outcomes`. */
  readonly outcomes: {
    readonly statusField: string | null;
    readonly candidates: readonly OutcomeCandidate[];
  } | null;
}

export function renderGetTestTypes(data: TestTypesData, t: Translator): string {
  if (data.outcomes !== null) {
    const { candidates, statusField } = data.outcomes;
    if (candidates.length === 0) return t('functional_get_test_types.outcomes.none');
    const lines = [t.plural('functional_get_test_types.outcomes', candidates.length)];
    if (statusField !== null) {
      lines.push(t('functional_get_test_types.outcomes.field', { field: statusField }));
    }
    lines.push(
      ...candidates.map(
        (candidate) =>
          `  ${candidate.value}  (${t(`functional_get_test_types.source.${candidate.source}`)})`,
      ),
    );
    return lines.join('\n');
  }
  const one = data.testType;
  if (one !== null) {
    const rows: [string, string][] = [
      [t('functional_get_test_types.label.name'), one.name],
      [t('functional_get_test_types.label.category'), one.category ?? '—'],
      [
        t('functional_get_test_types.label.state'),
        t(one.enabled ? 'functional_get_test_types.enabled' : 'functional_get_test_types.disabled'),
      ],
      [t('functional_get_test_types.label.priority'), num(one.priority, t.locale)],
      [t('functional_get_test_types.label.count'), num(one.defaultCount, t.locale)],
      [
        t('functional_get_test_types.label.base'),
        one.base ?? t('functional_get_test_types.custom'),
      ],
      [t('functional_get_test_types.label.outcome'), one.expectedOutcome ?? '—'],
    ];
    if (one.description !== null) {
      rows.push([t('functional_get_test_types.label.description'), one.description]);
    }
    if (one.pollTimeoutMs !== null) {
      rows.push([
        t('functional_get_test_types.label.poll'),
        t('functional_get_test_types.poll', {
          seconds: num(Math.round(one.pollTimeoutMs / 1000), t.locale),
          values: one.pollCompletion.join(', '),
        }),
      ]);
    }
    return [t('functional_get_test_types.one', { name: one.displayName }), ...keyValue(rows)].join(
      '\n',
    );
  }
  if (data.count === 0) return t('functional_get_test_types.none');
  const lines = [t.plural('functional_get_test_types.header', data.count)];
  lines.push(
    ...columns(
      data.items.map((row) => [
        String(row.priority),
        row.name,
        row.category ?? '—',
        t(row.enabled ? 'functional_get_test_types.enabled' : 'functional_get_test_types.disabled'),
        row.base ?? t('functional_get_test_types.custom'),
      ]),
      { align: ['right', 'left', 'left', 'left', 'left'] },
    ).map((row) => `  ${row}`),
  );
  if (data.shown < data.count) {
    lines.push(t('functional_get_test_types.more', { shown: data.shown, total: data.count }));
  }
  return lines.join('\n');
}
