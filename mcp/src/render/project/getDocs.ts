// The view of `project_get_docs`: the metadata of one documentation (its title, version, counts,
// source), or one line per stored version. The specification document itself is never in the data.
// The texts arrive made one line and masked by the tool (`content` of tools/moduleCall.ts).

import type { Translator } from '../../context.js';

export type DocsKind = 'openapi' | 'asyncapi';

export interface DocsItem {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly description: string | null;
  /** Origin and path only. */
  readonly source_url: string | null;
  /** When it was stored, as the backend gave it. */
  readonly at: string;
  /** The OpenAPI or AsyncAPI number; null where the answer does not carry it. */
  readonly spec_version: string | null;
  readonly endpoints_count: number | null;
  readonly channels_count: number | null;
  readonly operations_count: number | null;
  readonly protocols: readonly string[];
  /** Flags of a version in the list; null elsewhere. */
  readonly is_active: boolean | null;
  readonly is_current: boolean | null;
  /** It is `ids.docs_id` of the state. */
  readonly selected: boolean;
}

export interface DocsData {
  readonly kind: DocsKind;
  readonly mode: 'active' | 'version' | 'versions';
  readonly project_id: string;
  /** The version of the shown documentation, of the current one for the list; null when none. */
  readonly version: string | null;
  /** How many documentations the data speaks of: the versions the project has, else 1 or 0. */
  readonly count: number;
  readonly shown: number;
  readonly current_id: string | null;
  readonly docs: DocsItem | null;
  readonly versions: readonly DocsItem[];
}

const KIND_NAME: Readonly<Record<DocsKind, string>> = {
  openapi: 'OpenAPI',
  asyncapi: 'AsyncAPI',
};

/** `2026-11-20` from an ISO date-time; null for anything else. */
function dayOf(at: string): string | null {
  return /^\d{4}-\d{2}-\d{2}/u.exec(at)?.[0] ?? null;
}

function countsOf(item: DocsItem, t: Translator): string[] {
  const parts: string[] = [];
  if (item.endpoints_count !== null) {
    parts.push(t.plural('project_get_docs.endpoints', item.endpoints_count));
  }
  if (item.channels_count !== null) {
    parts.push(t.plural('project_get_docs.channels', item.channels_count));
  }
  if (item.operations_count !== null) {
    parts.push(t.plural('project_get_docs.operations', item.operations_count));
  }
  return parts;
}

function flagsOf(flags: readonly (string | false)[]): string {
  const shown = flags.filter((flag): flag is string => flag !== false);
  return shown.length === 0 ? '' : ` (${shown.join(', ')})`;
}

function detailLines(data: DocsData, item: DocsItem, t: Translator): string[] {
  const flags = flagsOf([
    data.mode === 'active' && t('project_get_docs.flag.active'),
    item.selected && t('project_get_docs.flag.selected'),
  ]);
  const day = dayOf(item.at);
  const facts = [
    ...(item.spec_version === null ? [] : [`${KIND_NAME[data.kind]} ${item.spec_version}`]),
    ...countsOf(item, t),
    ...(day === null ? [] : [t('project_get_docs.uploaded', { day })]),
  ];
  const lines = [
    t('project_get_docs.header', {
      kind: KIND_NAME[data.kind],
      title: item.title,
      version: item.version,
      flags,
    }),
    `id: ${item.id}`,
  ];
  if (facts.length > 0) lines.push(facts.join(', '));
  if (item.protocols.length > 0) {
    lines.push(t('project_get_docs.protocols', { names: item.protocols.join(', ') }));
  }
  if (item.source_url !== null) lines.push(t('project_get_docs.source', { url: item.source_url }));
  if (item.description !== null && item.description !== '') lines.push(item.description);
  return lines;
}

function versionLine(item: DocsItem, index: number, t: Translator): string {
  const flags = flagsOf([
    item.is_active === true && t('project_get_docs.flag.active'),
    item.is_current === true && t('project_get_docs.flag.current'),
    item.selected && t('project_get_docs.flag.selected'),
  ]);
  const day = dayOf(item.at);
  const tail = [...countsOf(item, t), ...(day === null ? [] : [day]), item.id].join(', ');
  return `${String(index + 1)}. "${item.title}" v${item.version}${flags} ${tail}`;
}

export function renderGetDocs(data: DocsData, t: Translator): string {
  const kind = KIND_NAME[data.kind];
  if (data.mode === 'versions') {
    if (data.count === 0) return t('project_get_docs.none', { kind });
    const lines = [t.plural('project_get_docs.versions', data.count, { kind })];
    data.versions.forEach((item, index) => lines.push(versionLine(item, index, t)));
    if (data.shown < data.count) {
      lines.push(t('project_get_docs.more', { shown: data.shown, total: data.count }));
    }
    return lines.join('\n');
  }
  if (data.docs === null) return t('project_get_docs.none', { kind });
  return detailLines(data, data.docs, t).join('\n');
}
