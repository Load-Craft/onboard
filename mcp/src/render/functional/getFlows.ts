// The view of `functional_get_flows`: the functional test flows (block graphs) of a documentation
// version, one flow with its blocks, or the stored versions of one flow. Names, descriptions, tags,
// block labels and change reasons are texts a person or a model wrote: they arrive in the data masked
// and made one line.

import type { Translator } from '../../context.js';
import { columns, keyValue, num } from '../primitives.js';

export interface FlowRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  /** The version of the documentation the flow was built on. */
  readonly version: string;
  readonly blocksCount: number;
  readonly active: boolean;
  readonly tags: readonly string[];
  readonly updatedAt: string;
}

export interface BlockRow {
  readonly id: string | null;
  readonly type: string | null;
  readonly label: string | null;
}

export interface FlowDetail extends FlowRow {
  readonly specId: string;
  readonly entryBlockId: string | null;
  readonly timeoutMs: number;
  readonly retryCount: number;
  readonly retryDelayMs: number;
  /** The first blocks (at most 40) with the plain facts of each; `blocksCount` says how many there are. */
  readonly blocks: readonly BlockRow[];
  readonly edges: number;
  /** The names of the flow's variables (at most 20). */
  readonly variables: readonly string[];
  readonly variableCount: number;
}

export interface VersionRow {
  readonly id: string;
  readonly version: string;
  readonly createdAt: string;
  readonly changeReason: string | null;
}

export interface FlowsData {
  readonly view: 'list' | 'versions';
  /** The documentation version the list was narrowed to, when one was. */
  readonly docsId: string | null;
  readonly count: number;
  readonly shown: number;
  readonly limit: number;
  readonly items: readonly FlowRow[];
  readonly flow: FlowDetail | null;
  /** The flow whose versions are listed. */
  readonly versionsOf: { readonly id: string; readonly name: string } | null;
  readonly versions: readonly VersionRow[];
}

const day = (at: string): string => /^\d{4}-\d{2}-\d{2}/u.exec(at)?.[0] ?? at;
const minute = (at: string): string =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.exec(at)?.[0].replace('T', ' ') ?? at;

export function renderGetFlows(data: FlowsData, t: Translator): string {
  if (data.view === 'versions' && data.versionsOf !== null) {
    if (data.versions.length === 0) {
      return t('functional_get_flows.versions.none', { name: data.versionsOf.name });
    }
    const lines = [
      t.plural('functional_get_flows.versions', data.versions.length, {
        name: data.versionsOf.name,
      }),
    ];
    lines.push(
      ...columns(
        data.versions.map((row) => [row.version, minute(row.createdAt), row.changeReason ?? '—']),
      ).map((row) => `  ${row}`),
    );
    return lines.join('\n');
  }
  const one = data.flow;
  if (one !== null) {
    const rows: [string, string][] = [
      [t('functional_get_flows.label.docs'), one.version],
      [t('functional_get_flows.label.blocks'), num(one.blocksCount, t.locale)],
      [t('functional_get_flows.label.edges'), num(one.edges, t.locale)],
      [
        t('functional_get_flows.label.state'),
        t(one.active ? 'functional_get_flows.active' : 'functional_get_flows.inactive'),
      ],
      [
        t('functional_get_flows.label.limits'),
        t('functional_get_flows.limits', {
          seconds: num(Math.round(one.timeoutMs / 1000), t.locale),
          retries: num(one.retryCount, t.locale),
          delay: num(one.retryDelayMs, t.locale),
        }),
      ],
    ];
    if (one.tags.length > 0) rows.push([t('functional_get_flows.label.tags'), one.tags.join(', ')]);
    if (one.variables.length > 0) {
      rows.push([t('functional_get_flows.label.variables'), one.variables.join(', ')]);
    }
    if (one.description !== null) {
      rows.push([t('functional_get_flows.label.description'), one.description]);
    }
    const lines = [t('functional_get_flows.one', { name: one.name }), ...keyValue(rows)];
    if (one.blocks.length > 0) {
      lines.push(t('functional_get_flows.blocks'));
      lines.push(
        ...columns(
          one.blocks.map((block, index) => [
            String(index + 1),
            block.type ?? '—',
            block.label ?? block.id ?? '—',
          ]),
          { align: ['right', 'left', 'left'] },
        ).map((row) => `  ${row}`),
      );
      if (one.blocks.length < one.blocksCount) {
        lines.push(
          t('functional_get_flows.blocks.more', {
            shown: one.blocks.length,
            total: one.blocksCount,
          }),
        );
      }
    }
    return lines.join('\n');
  }
  if (data.count === 0) return t('functional_get_flows.none');
  const lines = [t.plural('functional_get_flows.header', data.count)];
  lines.push(
    ...columns(
      data.items.map((row) => [
        row.name,
        row.version,
        t.plural('functional_get_flows.blocks.count', row.blocksCount),
        t(row.active ? 'functional_get_flows.active' : 'functional_get_flows.inactive'),
        day(row.updatedAt),
      ]),
    ).map((row) => `  ${row}`),
  );
  if (data.shown < data.count) {
    lines.push(t('functional_get_flows.more', { shown: data.shown, total: data.count }));
  }
  if (data.count >= data.limit) lines.push(t('functional_get_flows.limit', { limit: data.limit }));
  return lines.join('\n');
}
