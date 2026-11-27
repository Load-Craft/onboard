// The view of `project_get_apimap`: one line per area with its prefix, how many operations it
// holds and the first of them. The texts arrive made one line and masked by the tool (`content` of
// tools/moduleCall.ts); the view adds no text of the backend of its own.

import type { Translator } from '../../context.js';

export interface AreaItem {
  readonly name: string;
  readonly prefix: string;
  readonly operations_count: number;
  /** The first operations as `METHOD /path`. */
  readonly operations: readonly string[];
  /** The area has a sign-in endpoint. */
  readonly sign_in: boolean;
  /** How many operations of the area issue a token. */
  readonly token_operations: number;
}

export interface ApimapData {
  readonly project_id: string;
  readonly title: string | null;
  readonly area_rule: 'detected' | 'manual';
  readonly total_operations: number;
  /** How many areas the map has. */
  readonly areas: number;
  readonly shown: number;
  readonly items: readonly AreaItem[];
  /** How many operations are under no area. */
  readonly outside_area: number;
  /** The saved area prefixes; null when none are saved. */
  readonly saved_prefixes: readonly string[] | null;
  /** Saved prefixes no operation is under. */
  readonly empty_prefixes: readonly string[];
  readonly whole_api_chars: number;
}

function areaLine(item: AreaItem, index: number, t: Translator): string {
  const more = item.operations_count - item.operations.length;
  const sample =
    item.operations.length === 0
      ? ''
      : `: ${item.operations.join(', ')}${more > 0 ? ` ${t('project_get_apimap.more_operations', { count: more })}` : ''}`;
  const sign = item.sign_in ? ` ${t('project_get_apimap.sign_in')}` : '';
  // An area of the whole API has neither a name nor a prefix: it says so instead of two blanks.
  const label = [item.name, item.prefix === '' ? t('project_get_apimap.no_prefix') : item.prefix]
    .filter((part) => part !== '')
    .join(' ');
  return `${String(index + 1)}. ${label}${sign} — ${t.plural('project_get_apimap.operations', item.operations_count)}${sample}`;
}

export function renderGetApimap(data: ApimapData, t: Translator): string {
  const lines = [
    t.plural('project_get_apimap.header', data.areas, {
      title: data.title ?? '-',
      rule: t(`project_get_apimap.rule.${data.area_rule}`),
      operations: data.total_operations,
    }),
  ];
  data.items.forEach((item, index) => lines.push(areaLine(item, index, t)));
  if (data.shown < data.areas) {
    lines.push(t('project_get_apimap.more', { shown: data.shown, total: data.areas }));
  }
  if (data.outside_area > 0) {
    lines.push(t.plural('project_get_apimap.outside', data.outside_area));
  }
  if (data.empty_prefixes.length > 0) {
    lines.push(
      t('project_get_apimap.empty_prefixes', { prefixes: data.empty_prefixes.join(', ') }),
    );
  }
  return lines.join('\n');
}
