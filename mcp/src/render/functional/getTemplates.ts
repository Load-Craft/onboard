// The view of `functional_get_templates`: the functional test templates of a documentation version,
// or one template with its assertions and runtime parameters. Names, descriptions, tags, parameter
// names and values are texts a person or a model wrote: they arrive in the data masked and made one
// line.

import type { Translator } from '../../context.js';
import { columns, keyValue, num } from '../primitives.js';

export interface TemplateRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly specId: string | null;
  readonly tags: readonly string[];
  readonly assertionsCount: number;
  readonly active: boolean;
  readonly updatedAt: string;
}

export interface TemplateAssertion {
  readonly type: string;
  readonly enabled: boolean;
  /** The plain parameters as `name=value` (at most 5). */
  readonly parameters: readonly string[];
}

export interface RuntimeParameter {
  readonly name: string;
  readonly type: string;
  readonly assertion: string;
  readonly description: string | null;
  readonly default: string | null;
  readonly values: readonly string[];
}

export interface TemplateDetail extends TemplateRow {
  readonly apiDescription: string | null;
  readonly endpoints: number;
  /** The blocks of the flow definition, when it has a list of them. */
  readonly blocks: number | null;
  readonly assertions: readonly TemplateAssertion[];
  readonly runtimeParameters: readonly RuntimeParameter[];
}

export interface TemplatesData {
  readonly docsId: string | null;
  readonly tags: readonly string[];
  readonly count: number;
  readonly shown: number;
  readonly limit: number;
  readonly items: readonly TemplateRow[];
  readonly template: TemplateDetail | null;
}

const day = (at: string): string => /^\d{4}-\d{2}-\d{2}/u.exec(at)?.[0] ?? at;

export function renderGetTemplates(data: TemplatesData, t: Translator): string {
  const one = data.template;
  if (one !== null) {
    const rows: [string, string][] = [
      [
        t('functional_get_templates.label.state'),
        t(one.active ? 'functional_get_templates.active' : 'functional_get_templates.inactive'),
      ],
      [t('functional_get_templates.label.endpoints'), num(one.endpoints, t.locale)],
    ];
    if (one.blocks !== null) {
      rows.push([t('functional_get_templates.label.blocks'), num(one.blocks, t.locale)]);
    }
    if (one.tags.length > 0) {
      rows.push([t('functional_get_templates.label.tags'), one.tags.join(', ')]);
    }
    if (one.description !== null) {
      rows.push([t('functional_get_templates.label.description'), one.description]);
    }
    if (one.apiDescription !== null) {
      rows.push([t('functional_get_templates.label.api'), one.apiDescription]);
    }
    const lines = [t('functional_get_templates.one', { name: one.name }), ...keyValue(rows)];
    if (one.assertions.length > 0) {
      lines.push(t.plural('functional_get_templates.assertions', one.assertionsCount));
      for (const assertion of one.assertions) {
        const off = assertion.enabled ? '' : ` (${t('functional_get_templates.off')})`;
        const params =
          assertion.parameters.length === 0 ? '' : `  ${assertion.parameters.join(' ')}`;
        lines.push(`  ${assertion.type}${off}${params}`);
      }
    }
    if (one.runtimeParameters.length > 0) {
      lines.push(t.plural('functional_get_templates.parameters', one.runtimeParameters.length));
      for (const parameter of one.runtimeParameters) {
        const hint = [
          parameter.type,
          parameter.default === null
            ? null
            : t('functional_get_templates.default', { value: parameter.default }),
          parameter.values.length === 0 ? null : parameter.values.join('|'),
        ]
          .filter((part): part is string => part !== null)
          .join(', ');
        lines.push(
          `  ${parameter.name} (${hint})${parameter.description === null ? '' : `: ${parameter.description}`}`,
        );
      }
    }
    return lines.join('\n');
  }
  if (data.count === 0) return t('functional_get_templates.none');
  const lines = [t.plural('functional_get_templates.header', data.count)];
  lines.push(
    ...columns(
      data.items.map((row) => [
        row.name,
        t.plural('functional_get_templates.assertions.count', row.assertionsCount),
        row.tags.join(', ') || '—',
        t(row.active ? 'functional_get_templates.active' : 'functional_get_templates.inactive'),
        day(row.updatedAt),
      ]),
    ).map((row) => `  ${row}`),
  );
  if (data.shown < data.count) {
    lines.push(t('functional_get_templates.more', { shown: data.shown, total: data.count }));
  }
  if (data.count >= data.limit) {
    lines.push(t('functional_get_templates.limit', { limit: data.limit }));
  }
  return lines.join('\n');
}
