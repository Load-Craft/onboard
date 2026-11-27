// The view of `functional_get_runs`: the project's functional runs, newest first, one line each, or
// one run in full. A run is named by its UUID, which the later reads (results, comparison) take.
// Template names, error messages and the names of runtime parameters are texts a person or the target
// wrote: they arrive in the data masked and made one line.

import type { Translator } from '../../context.js';
import { columns, keyValue, num } from '../primitives.js';

export type FunctionalStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface FunctionalRunRow {
  readonly id: string;
  readonly status: FunctionalStatus;
  readonly type: 'adhoc' | 'template';
  readonly templateId: string | null;
  readonly templateName: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly durationMs: number;
  readonly flows: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly completed: number;
  };
  readonly validations: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
  };
  readonly environmentId: string | null;
}

export interface FunctionalRunDetail extends FunctionalRunRow {
  readonly environmentName: string | null;
  readonly errorMessage: string | null;
  readonly triggeredBy: string | null;
  /** The names of the runtime parameters the run was given (values are not read). */
  readonly runtimeParams: readonly string[];
  readonly flowVersions: number;
}

export interface FunctionalRunsData {
  readonly view: 'list' | 'one' | 'by_template';
  /** The runs the backend counts for the filters, and how many the data lists. */
  readonly count: number;
  readonly shown: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly FunctionalRunRow[];
  readonly run: FunctionalRunDetail | null;
}

const minute = (at: string): string =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.exec(at)?.[0].replace('T', ' ') ?? at;

const outcome = (row: FunctionalRunRow, t: Translator): string =>
  t('functional_get_runs.outcome', {
    passed: num(row.flows.passed, t.locale),
    total: num(row.flows.total, t.locale),
    failed: num(row.validations.failed, t.locale),
  });

export function renderGetRuns(data: FunctionalRunsData, t: Translator): string {
  const one = data.run;
  if (one !== null) {
    const rows: [string, string][] = [
      [t('functional_get_runs.label.type'), t(`functional_get_runs.type.${one.type}`)],
    ];
    if (one.templateName !== null)
      rows.push([t('functional_get_runs.label.template'), one.templateName]);
    if (one.environmentName !== null)
      rows.push([t('functional_get_runs.label.environment'), one.environmentName]);
    rows.push([t('functional_get_runs.label.created'), minute(one.createdAt)]);
    if (one.startedAt !== null)
      rows.push([t('functional_get_runs.label.started'), minute(one.startedAt)]);
    rows.push([
      t('functional_get_runs.label.lasted'),
      `${num(Math.round(one.durationMs / 1000), t.locale)} s`,
    ]);
    rows.push([
      t('functional_get_runs.label.flows'),
      t('functional_get_runs.flows', {
        passed: num(one.flows.passed, t.locale),
        failed: num(one.flows.failed, t.locale),
        total: num(one.flows.total, t.locale),
      }),
    ]);
    rows.push([
      t('functional_get_runs.label.validations'),
      t('functional_get_runs.validations', {
        passed: num(one.validations.passed, t.locale),
        failed: num(one.validations.failed, t.locale),
        total: num(one.validations.total, t.locale),
      }),
    ]);
    if (one.runtimeParams.length > 0) {
      rows.push([t('functional_get_runs.label.params'), one.runtimeParams.join(', ')]);
    }
    if (one.errorMessage !== null)
      rows.push([t('functional_get_runs.label.error'), one.errorMessage]);
    return [
      t('functional_get_runs.one', {
        id: one.id,
        status: t(`functional_get_runs.status.${one.status}`),
      }),
      ...keyValue(rows),
    ].join('\n');
  }
  if (data.count === 0) return t('functional_get_runs.none');
  const lines = [t.plural('functional_get_runs.header', data.count)];
  lines.push(
    ...columns(
      data.items.map((row) => [
        row.id,
        minute(row.createdAt),
        t(`functional_get_runs.status.${row.status}`),
        row.templateName ?? t(`functional_get_runs.type.${row.type}`),
        outcome(row, t),
      ]),
    ).map((row) => `  ${row}`),
  );
  if (data.shown < data.count) {
    lines.push(
      t('functional_get_runs.more', {
        shown: data.shown,
        total: data.count,
        next: data.offset + data.items.length,
      }),
    );
  }
  return lines.join('\n');
}
