// The view of `functional_compare_runs`: two functional runs compared block by block. A block that
// differs shows what changed: its status, the status code of the response, the shape of the response
// (the fields that appeared, disappeared or changed type) and its time. Block names, field paths and
// warnings are texts of the target or a person: they arrive in the data masked and made one line.

import type { Translator } from '../../context.js';
import { columns, num } from '../primitives.js';

export type Verdict =
  'same' | 'status_changed' | 'shape_changed' | 'timing_only' | 'only_in_a' | 'only_in_b' | 'other';

export interface Pair<T> {
  readonly run: T;
  readonly other: T;
}

export interface FieldChange {
  readonly path: string;
  readonly type: string;
  /** For a changed type: the type in the other run. */
  readonly to: string | null;
}

export interface BlockDiff {
  readonly id: string;
  readonly name: string | null;
  readonly verdict: Verdict;
  readonly status: Pair<string | null>;
  readonly httpStatus: Pair<number | null>;
  readonly durationMs: Pair<number | null>;
  /** The shape differences (at most 10 of each kind). */
  readonly appeared: readonly FieldChange[];
  readonly disappeared: readonly FieldChange[];
  readonly typeChanged: readonly FieldChange[];
}

export interface CompareData {
  /** The run asked about and the one it is compared with (UUIDs). */
  readonly run_id: string;
  readonly other: string;
  /** How many blocks differ (every verdict but `same`). */
  readonly changed: number;
  readonly same: number;
  readonly sameFlowVersions: boolean;
  readonly environments: Pair<string | null>;
  readonly warnings: readonly string[];
  readonly count: number;
  readonly shown: number;
  /** The blocks that differ first, then the same ones, at most 100. */
  readonly blocks: readonly BlockDiff[];
}

const WIDE = 1000;

function timing(pair: Pair<number | null>, t: Translator): string {
  if (pair.run === null || pair.other === null) return '—';
  const f = (v: number): string =>
    v >= WIDE ? `${num(Math.round(v), t.locale)}` : String(Math.round(v));
  return `${f(pair.run)} → ${f(pair.other)} ms`;
}

export function renderCompareRuns(data: CompareData, t: Translator): string {
  const lines = [
    t('functional_compare_runs.header', {
      run: data.run_id,
      other: data.other,
      changed: num(data.changed, t.locale),
      total: num(data.count, t.locale),
    }),
  ];
  if (!data.sameFlowVersions) lines.push(t('functional_compare_runs.versions'));
  if (data.environments.run !== data.environments.other) {
    lines.push(t('functional_compare_runs.environments'));
  }
  for (const warning of data.warnings)
    lines.push(t('functional_compare_runs.warning', { warning }));
  const differing = data.blocks.filter((block) => block.verdict !== 'same');
  if (differing.length === 0) {
    lines.push(t('functional_compare_runs.identical'));
    return lines.join('\n');
  }
  lines.push(
    ...columns(
      differing.map((block) => [
        block.name ?? block.id,
        t(`functional_compare_runs.verdict.${block.verdict}`),
        `${block.status.run ?? '—'} → ${block.status.other ?? '—'}`,
        `${block.httpStatus.run === null ? '—' : String(block.httpStatus.run)} → ${block.httpStatus.other === null ? '—' : String(block.httpStatus.other)}`,
        timing(block.durationMs, t),
      ]),
    ).map((row) => `  ${row}`),
  );
  for (const block of differing) {
    const parts: string[] = [];
    if (block.appeared.length > 0) {
      parts.push(
        t('functional_compare_runs.appeared', {
          fields: block.appeared.map((f) => `${f.path} (${f.type})`).join(', '),
        }),
      );
    }
    if (block.disappeared.length > 0) {
      parts.push(
        t('functional_compare_runs.disappeared', {
          fields: block.disappeared.map((f) => `${f.path} (${f.type})`).join(', '),
        }),
      );
    }
    if (block.typeChanged.length > 0) {
      parts.push(
        t('functional_compare_runs.type_changed', {
          fields: block.typeChanged.map((f) => `${f.path} (${f.type} → ${f.to ?? '?'})`).join(', '),
        }),
      );
    }
    if (parts.length > 0) lines.push(`  ${block.name ?? block.id}: ${parts.join('; ')}`);
  }
  if (data.shown < data.count) {
    lines.push(t('functional_compare_runs.more', { shown: data.shown, total: data.count }));
  }
  return lines.join('\n');
}
