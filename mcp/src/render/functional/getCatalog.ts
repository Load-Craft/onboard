// The view of `functional_get_catalog`: the global catalog of base test types, base validators or
// assertion types, as a list or one entry. Names, descriptions and categories are texts a person or a
// model wrote: they arrive in the data masked and made one line; prompt templates are never read.

import type { Translator } from '../../context.js';
import { columns, keyValue, num } from '../primitives.js';

export type CatalogKind = 'test_types' | 'validators' | 'assertion_types';

export interface CatalogRow {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly category: string | null;
  readonly active: boolean;
  readonly builtin: boolean;
  /** The kind of a validator (`assertion`, `ai_semantic`); null for the other catalogs. */
  readonly type: string | null;
}

export interface CatalogEntry extends CatalogRow {
  readonly description: string | null;
  /** The names of the parameters the entry takes (at most 20). */
  readonly parameters: readonly string[];
  readonly parameterCount: number;
  readonly hasPromptTemplate: boolean;
}

export interface CatalogData {
  readonly kind: CatalogKind;
  readonly view: 'list' | 'one';
  readonly count: number;
  readonly shown: number;
  readonly limit: number;
  /** The category the list was narrowed to; null when it was not. */
  readonly category: string | null;
  /** The categories the backend names for the catalog (at most 30). */
  readonly categories: readonly string[];
  readonly items: readonly CatalogRow[];
  readonly entry: CatalogEntry | null;
}

const flag = (on: boolean, key: string, t: Translator): string => (on ? t(key) : '');

export function renderGetCatalog(data: CatalogData, t: Translator): string {
  const one = data.entry;
  if (one !== null) {
    const rows: [string, string][] = [
      [t('functional_get_catalog.label.name'), one.name],
      [t('functional_get_catalog.label.category'), one.category ?? '—'],
      [
        t('functional_get_catalog.label.state'),
        [
          t(one.active ? 'functional_get_catalog.active' : 'functional_get_catalog.inactive'),
          flag(one.builtin, 'functional_get_catalog.builtin', t),
        ]
          .filter((part) => part !== '')
          .join(', '),
      ],
    ];
    if (one.type !== null) rows.push([t('functional_get_catalog.label.type'), one.type]);
    if (one.description !== null) {
      rows.push([t('functional_get_catalog.label.description'), one.description]);
    }
    if (one.parameterCount > 0) {
      rows.push([
        t('functional_get_catalog.label.parameters'),
        one.parameters.join(', ') +
          (one.parameters.length < one.parameterCount
            ? ` (+${num(one.parameterCount - one.parameters.length, t.locale)})`
            : ''),
      ]);
    }
    if (one.hasPromptTemplate) {
      rows.push([t('functional_get_catalog.label.prompt'), t('functional_get_catalog.prompt')]);
    }
    return [
      t('functional_get_catalog.one', {
        kind: t(`functional_get_catalog.kind.${data.kind}`),
        name: one.displayName,
      }),
      ...keyValue(rows),
    ].join('\n');
  }
  if (data.count === 0) {
    // an empty catalog of assertion types is a state of the server (its builtin types are seeded by a
    // separate call), and the names a person expects there (status_code, json_schema) are validators
    if (data.kind === 'assertion_types' && data.category === null) {
      return t('functional_get_catalog.none.assertion_types');
    }
    return t('functional_get_catalog.none', {
      kind: t(`functional_get_catalog.kind.${data.kind}`),
    });
  }
  const lines = [
    t.plural('functional_get_catalog.header', data.count, {
      kind: t(`functional_get_catalog.kind.${data.kind}`),
    }),
  ];
  lines.push(
    ...columns(
      data.items.map((row) => [
        row.name,
        row.category ?? '—',
        row.type ?? '',
        t(row.active ? 'functional_get_catalog.active' : 'functional_get_catalog.inactive'),
        flag(row.builtin, 'functional_get_catalog.builtin', t),
      ]),
    ).map((row) => `  ${row}`),
  );
  if (data.shown < data.count) {
    lines.push(t('functional_get_catalog.more', { shown: data.shown, total: data.count }));
  }
  if (data.categories.length > 0) {
    lines.push(t('functional_get_catalog.categories', { list: data.categories.join(', ') }));
  }
  return lines.join('\n');
}
