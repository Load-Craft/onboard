// View of `flows_migrate_docs`: nothing to move; the preview (per flow: the steps that match the target
// docs version, differ or lost their endpoint, the value differences with the ids to adopt, the
// checks the target no longer satisfies, the endpoints the flow drops, the scenarios that go stale,
// a refusal); the consent card of the migration (the fields of the catalog card, in its order); and
// the result (per flow: migrated from which version to which, the values adopted, the version that
// undoes it, or the refusal). Text of the backend (names, paths, messages, values) passes `inline()`.

import type { Translator } from '../../context.js';
import { inline, VIEW_WIDTH, wrap } from '../primitives.js';

/** A docs version as a person tells two uploads apart: the version, the day of the upload, the id. */
export interface DocsVersionView {
  readonly id: string;
  readonly version: string | null;
  readonly createdAt: string | null;
}

export type RefusalCode =
  | 'flow_not_found'
  | 'not_pinned'
  | 'already_on_target'
  | 'source_spec_missing'
  | 'unmatched_steps'
  | 'lint_failed';

export type ValueKind =
  'example_changed' | 'example_removed' | 'not_in_enum' | 'param_removed' | 'required_added';

export interface ValueView {
  readonly id: string;
  readonly step: string;
  readonly location: 'body' | 'form' | 'query';
  readonly field: string;
  readonly kind: ValueKind;
  readonly action: 'set' | 'remove' | 'add';
  readonly adoptable: boolean;
  /** JSON of the value in the step, and of the value the target documents; absent when none. */
  readonly from?: string;
  readonly to?: string;
}

export interface FlowPlanView {
  readonly name: string;
  /** Version of the flow the plan was computed on. */
  readonly version: number | null;
  /** `info.version` of the docs version the flow is pinned to. */
  readonly source: string | null;
  /** `code` is one of `RefusalCode`; a code a newer server adds is shown as it is. */
  readonly refusal?: { readonly code: string; readonly message: string };
  readonly needsAllowUnmatched: boolean;
  readonly counts?: {
    readonly total: number;
    readonly matched: number;
    readonly changed: number;
    readonly unmatched: number;
  };
  readonly unmatched: readonly {
    readonly step: string;
    readonly request: string;
    readonly reason: 'unbound' | 'endpoint_removed' | null;
  }[];
  readonly values: readonly ValueView[];
  readonly checks: readonly {
    readonly step: string;
    readonly selector: string;
    readonly variable: string | null;
  }[];
  readonly dropped: readonly string[];
  readonly scenarios: readonly string[];
}

export interface FlowResultView extends FlowPlanView {
  readonly outcome: 'migrated' | 'refused';
  readonly previousVersion: number | null;
  readonly currentVersion: number | null;
  readonly adopted: number;
}

export type AdoptChoice =
  | { readonly kind: 'none' }
  | { readonly kind: 'all' }
  | { readonly kind: 'picked'; readonly count: number };

export type MigrateDocsData =
  | { readonly kind: 'nothing'; readonly target: DocsVersionView }
  | {
      readonly kind: 'card';
      /** Flows the migration would move (the `{n}` of the card title). */
      readonly n: number;
      readonly flows: readonly string[];
      readonly target: DocsVersionView;
      readonly current: DocsVersionView | null;
      readonly adopt: AdoptChoice;
      readonly allowUnmatched: boolean;
      /** Flows of the project on an older docs version. */
      readonly outdated: number;
      /** What `confirm` takes after the yes: the token of exactly this card. */
      readonly token: string;
      /** Why a confirm got this card instead of the write: no card, an expired or replaced one, other arguments. */
      readonly renewed?: 'missing' | 'expired' | 'token' | 'changed';
    }
  | {
      readonly kind: 'preview';
      readonly target: DocsVersionView;
      readonly flows: readonly FlowPlanView[];
      readonly migratable: number;
      readonly refused: number;
    }
  | {
      readonly kind: 'migrated';
      readonly target: DocsVersionView;
      /** Flows sent, flows migrated, and the steps of the migrated flows by status. */
      readonly n: number;
      readonly count: number;
      readonly matched: number;
      readonly changed: number;
      readonly unmatched: number;
      readonly flows: readonly FlowResultView[];
      /** The list of flows could not be read after the write: the warning follows the results. */
      readonly listNotRefreshed?: true;
    };

const NAME_LIMIT = 60;
const TEXT_LIMIT = 160;
const VALUE_LIMIT = 60;
const ID_SHOWN = 8;
/** A value id: flow, versions, step, place and field. */
const ID_LIMIT = 300;
/** Rows of one list of a flow (values, steps) before "and N more". */
const ROWS = 12;
const INDENT = '  ';

/** `2.16.0 (2026-11-26, 3e766196)`: uploads may share `info.version`. */
export function docsVersionText(version: DocsVersionView): string {
  const day = version.createdAt === null ? undefined : inline(version.createdAt.slice(0, 10), 10);
  const id = inline(version.id.slice(0, ID_SHOWN), ID_SHOWN);
  const named = version.version === null ? id : inline(version.version, NAME_LIMIT);
  const detail = [day, version.version === null ? undefined : id].filter(
    (part): part is string => part !== undefined && part !== '',
  );
  return detail.length === 0 ? named : `${named} (${detail.join(', ')})`;
}

function indented(text: string, depth = 1): string[] {
  const lead = INDENT.repeat(depth);
  return wrap(text, VIEW_WIDTH - lead.length, INDENT.length).map((line) => lead + line);
}

function capped<T>(items: readonly T[], draw: (item: T) => string[], t: Translator): string[] {
  const shown = items.slice(0, ROWS).flatMap(draw);
  const rest = items.length - Math.min(items.length, ROWS);
  return rest > 0 ? [...shown, ...indented(t('migrateDocs.more', { count: rest }), 2)] : shown;
}

function refusalText(refusal: NonNullable<FlowPlanView['refusal']>, t: Translator): string {
  const key = `migrateDocs.refusal.${refusal.code}`;
  const reason = t.has(key) ? t(key) : inline(refusal.code, 64);
  const message = inline(refusal.message, TEXT_LIMIT);
  return message === '' ? reason : `${reason} — ${message}`;
}

function countsText(counts: NonNullable<FlowPlanView['counts']>, t: Translator): string {
  return t('migrateDocs.counts', {
    steps: t.plural('migrateDocs.steps', counts.total),
    matched: counts.matched,
    changed: counts.changed,
    unmatched: counts.unmatched,
  });
}

function valueLine(value: ValueView, t: Translator): string[] {
  const field = `${inline(value.step, NAME_LIMIT)} · ${inline(value.location, 8)}.${inline(value.field, NAME_LIMIT)}`;
  const from = value.from === undefined ? '—' : inline(value.from, VALUE_LIMIT);
  const to =
    value.action === 'remove'
      ? t('migrateDocs.value.removed')
      : value.to === undefined
        ? '—'
        : inline(value.to, VALUE_LIMIT);
  const kind = t(`migrateDocs.kind.${value.kind}`);
  const line = indented(`${t('migrateDocs.value')}  ${field}  ${from} → ${to} (${kind})`);
  // the id goes on a line of its own, never wrapped: it is copied into adopt_value_ids as it is
  return value.adoptable
    ? [...line, `${INDENT.repeat(2)}${t('migrateDocs.value.id')} ${inline(value.id, ID_LIMIT)}`]
    : [...line, ...indented(t('migrateDocs.value.notAdoptable'), 2)];
}

/** The lists under the head line of one flow: steps, values, checks, endpoints, scenarios. */
function detailLines(flow: FlowPlanView, t: Translator, staleKey: string): string[] {
  const steps = capped(
    flow.unmatched,
    (step) =>
      indented(
        `${t('migrateDocs.unmatched')}  ${inline(step.step, NAME_LIMIT)} · ${inline(step.request, TEXT_LIMIT)} (${t(
          `migrateDocs.reason.${step.reason ?? 'unbound'}`,
        )})`,
      ),
    t,
  );
  const values = capped(flow.values, (value) => valueLine(value, t), t);
  const checks = capped(
    flow.checks,
    (check) =>
      indented(
        t('migrateDocs.check', {
          step: inline(check.step, NAME_LIMIT),
          selector: inline(check.selector, TEXT_LIMIT),
          variable: check.variable === null ? '—' : inline(check.variable, NAME_LIMIT),
        }),
      ),
    t,
  );
  const dropped =
    flow.dropped.length === 0
      ? []
      : indented(
          t('migrateDocs.dropped', {
            endpoints: flow.dropped.map((item) => inline(item, TEXT_LIMIT)).join(', '),
          }),
        );
  const scenarios =
    flow.scenarios.length === 0
      ? []
      : indented(
          t(staleKey, { names: flow.scenarios.map((name) => inline(name, NAME_LIMIT)).join(', ') }),
        );
  return [...steps, ...values, ...checks, ...dropped, ...scenarios];
}

function planLines(flow: FlowPlanView, target: DocsVersionView, t: Translator): string[] {
  const name = inline(flow.name, NAME_LIMIT);
  if (flow.refusal !== undefined) {
    return wrap(
      `${name}  ${t('migrateDocs.refused', { reason: refusalText(flow.refusal, t) })}`,
      VIEW_WIDTH,
      2,
    );
  }
  const head = [
    flow.version === null ? undefined : `v${String(flow.version)}`,
    `${flow.source === null ? '—' : inline(flow.source, NAME_LIMIT)} → ${
      target.version === null ? '—' : inline(target.version, NAME_LIMIT)
    }`,
    flow.counts === undefined ? undefined : countsText(flow.counts, t),
  ].filter((part): part is string => part !== undefined);
  return [
    ...wrap(`${name}  ${head.join(' · ')}`, VIEW_WIDTH, 2),
    ...(flow.needsAllowUnmatched ? indented(t('migrateDocs.needsAllowUnmatched')) : []),
    ...detailLines(flow, t, 'migrateDocs.staleIf'),
  ];
}

function previewText(data: Extract<MigrateDocsData, { kind: 'preview' }>, t: Translator): string {
  const head = t('migrateDocs.preview.head', {
    flows: t.plural('migrateDocs.flows', data.flows.length),
    target: docsVersionText(data.target),
  });
  const next: string[] = [];
  if (data.migratable > 0) next.push(t('migrateDocs.preview.next'));
  if (data.flows.some((flow) => flow.refusal === undefined && flow.needsAllowUnmatched)) {
    next.push(t('migrateDocs.preview.allowUnmatched'));
  }
  if (data.migratable === 0) next.push(t('migrateDocs.preview.nothing'));
  return [
    ...wrap(head, VIEW_WIDTH, 2),
    ...data.flows.flatMap((flow) => planLines(flow, data.target, t)),
    ...next.flatMap((line) => wrap(`→ ${line}`, VIEW_WIDTH, 2)),
  ].join('\n');
}

function adoptText(adopt: AdoptChoice, t: Translator): string {
  return adopt.kind === 'picked'
    ? t.plural('migrateDocs.card.picked', adopt.count)
    : t(`migrateDocs.card.adopt.${adopt.kind}`);
}

function cardText(data: Extract<MigrateDocsData, { kind: 'card' }>, t: Translator): string {
  const names = data.flows.map((name) => inline(name, NAME_LIMIT)).join(', ');
  const rows: [string, string][] = [
    [t('migrateDocs.card.flows'), names],
    [t('migrateDocs.card.target'), docsVersionText(data.target)],
    [t('migrateDocs.card.adopt'), adoptText(data.adopt, t)],
    [
      t('migrateDocs.card.allowUnmatched'),
      data.allowUnmatched ? t('migrateDocs.card.yes') : t('migrateDocs.card.no'),
    ],
    [t('migrateDocs.card.docs'), data.current === null ? '—' : docsVersionText(data.current)],
    [t('migrateDocs.card.outdated'), String(data.outdated)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const body = rows.flatMap(([label, value]) => {
    const lead = `${INDENT}${label.padEnd(width)}${INDENT}`;
    const [first = '', ...rest] = wrap(value, VIEW_WIDTH - lead.length);
    return [lead + first, ...rest.map((line) => ' '.repeat(lead.length) + line)];
  });
  return [
    ...(data.renewed === undefined
      ? []
      : wrap(t(`migrateDocs.card.renewed.${data.renewed}`), VIEW_WIDTH, 2)),
    t.plural('migrateDocs.card.title', data.n),
    ...body,
    ...wrap(t('migrateDocs.card.effect'), VIEW_WIDTH, 2),
    ...wrap(`→ ${t('migrateDocs.card.next', { token: inline(data.token, 64) })}`, VIEW_WIDTH, 2),
  ].join('\n');
}

function resultLines(flow: FlowResultView, t: Translator): string[] {
  const name = inline(flow.name, NAME_LIMIT);
  if (flow.outcome === 'refused' || flow.refusal !== undefined) {
    const reason =
      flow.refusal === undefined ? t('migrateDocs.refusal.unknown') : refusalText(flow.refusal, t);
    return wrap(`${name}  ${t('migrateDocs.refused', { reason })}`, VIEW_WIDTH, 2);
  }
  const head = [
    flow.previousVersion === null || flow.currentVersion === null
      ? undefined
      : `v${String(flow.previousVersion)} → v${String(flow.currentVersion)}`,
    flow.adopted > 0 ? t.plural('migrateDocs.adopted', flow.adopted) : undefined,
    flow.previousVersion === null
      ? undefined
      : t('migrateDocs.undo', { version: flow.previousVersion }),
  ].filter((part): part is string => part !== undefined);
  return [
    ...wrap(`${name}  ${head.join(' · ')}`, VIEW_WIDTH, 2),
    ...(flow.counts === undefined ? [] : indented(countsText(flow.counts, t))),
    ...detailLines({ ...flow, values: [] }, t, 'migrateDocs.stale'),
  ];
}

function migratedText(data: Extract<MigrateDocsData, { kind: 'migrated' }>, t: Translator): string {
  const head = t('migrateDocs.migrated.head', {
    count: data.count,
    flows: t.plural('migrateDocs.flows', data.n),
    target: docsVersionText(data.target),
    matched: data.matched,
    changed: data.changed,
    unmatched: data.unmatched,
  });
  const stale = data.flows.some((flow) => flow.outcome === 'migrated' && flow.scenarios.length > 0);
  const refused = data.flows.some((flow) => flow.outcome === 'refused');
  const next = [
    ...(stale ? [t('migrateDocs.migrated.rebuild')] : []),
    ...(refused ? [t('migrateDocs.migrated.refused')] : []),
  ];
  return [
    ...wrap(head, VIEW_WIDTH, 2),
    ...data.flows.flatMap((flow) => resultLines(flow, t)),
    ...(data.count > 0 ? wrap(t('migrateDocs.migrated.undo'), VIEW_WIDTH, 2) : []),
    ...(data.listNotRefreshed === true
      ? wrap(t('migrateDocs.migrated.notRefreshed'), VIEW_WIDTH, 2)
      : []),
    ...next.flatMap((line) => wrap(`→ ${line}`, VIEW_WIDTH, 2)),
  ].join('\n');
}

export function renderMigrateDocs(data: MigrateDocsData, t: Translator): string {
  switch (data.kind) {
    case 'nothing':
      return wrap(
        t('migrateDocs.nothing', { target: docsVersionText(data.target) }),
        VIEW_WIDTH,
        2,
      ).join('\n');
    case 'card':
      return cardText(data, t);
    case 'preview':
      return previewText(data, t);
    case 'migrated':
      return migratedText(data, t);
  }
}
