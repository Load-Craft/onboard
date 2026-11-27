// The view of `functional_get_results`: the results of a functional run as a summary with one line
// per flow, the flows alone, one flow result (the validations that failed and the blocks), or the
// captured HTTP log. Everything the target or a person wrote (messages, expected and actual values,
// addresses, bodies) arrives in the data masked and made one line; a body the mask cannot read is
// hidden whole (its type and size only), and header values are never read.

import type { Translator } from '../../context.js';
import { columns, keyValue, num } from '../primitives.js';

export interface FlowResultRow {
  readonly id: string;
  readonly flowId: string;
  readonly flowVersion: number;
  readonly testType: string;
  readonly status: string;
  readonly durationMs: number;
  readonly validations: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
  };
  readonly errorMessage: string | null;
}

export interface FailedValidation {
  readonly validator: string;
  readonly type: string | null;
  readonly message: string | null;
  readonly expected: string | null;
  readonly actual: string | null;
  readonly reasoning: string | null;
}

export interface BlockRow {
  readonly name: string;
  readonly type: string;
  readonly status: string;
  readonly method: string | null;
  readonly url: string | null;
  readonly httpStatus: number | null;
  readonly durationMs: number;
  readonly errorMessage: string | null;
  readonly assertionMessage: string | null;
}

export interface FlowResultDetail extends FlowResultRow {
  readonly startedAt: string | null;
  readonly failedValidations: readonly FailedValidation[];
  readonly failedValidationCount: number;
  readonly blocks: readonly BlockRow[];
  readonly blockCount: number;
}

/** A body of the HTTP log: its masked text, or only its type and size when the mask cannot read it. */
export type LogBody =
  | { readonly kind: 'shown'; readonly text: string }
  | { readonly kind: 'hidden'; readonly type: string | null; readonly bytes: number };

export interface LogLine {
  readonly seq: number;
  readonly logType: string;
  readonly level: string | null;
  readonly method: string | null;
  readonly url: string | null;
  readonly statusCode: number | null;
  readonly durationMs: number | null;
  readonly block: string | null;
  readonly message: string | null;
  /** The names of the headers, never their values. */
  readonly headerNames: readonly string[];
  readonly requestBody: LogBody | null;
  readonly responseBody: LogBody | null;
}

export interface RunFigures {
  readonly id: string;
  readonly status: string;
  readonly durationMs: number;
  readonly flows: { readonly total: number; readonly passed: number; readonly failed: number };
  readonly validations: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
  };
  readonly errorMessage: string | null;
}

export interface ResultsData {
  readonly run_id: string;
  readonly view: 'summary' | 'flows' | 'one' | 'http_log';
  /** What the log entry counts: flows passed and failed, validations of one result, or requests ok and failed. */
  readonly passed: number;
  readonly failed: number;
  readonly count: number;
  readonly shown: number;
  readonly run: RunFigures | null;
  readonly flows: readonly FlowResultRow[];
  readonly result: FlowResultDetail | null;
  readonly log: readonly LogLine[];
}

export function renderGetResults(data: ResultsData, t: Translator): string {
  if (data.view === 'http_log') {
    if (data.log.length === 0) return t('functional_get_results.log.none', { run: data.run_id });
    const lines = [t.plural('functional_get_results.log', data.count, { run: data.run_id })];
    for (const entry of data.log) {
      const where = [entry.method, entry.url].filter((part) => part !== null).join(' ');
      const status = entry.statusCode === null ? '' : ` → ${String(entry.statusCode)}`;
      const took =
        entry.durationMs === null ? '' : ` (${num(Math.round(entry.durationMs), t.locale)} ms)`;
      const head = where === '' ? (entry.message ?? entry.logType) : `${where}${status}${took}`;
      lines.push(`${String(entry.seq)}. [${entry.logType}] ${head}`);
      if (entry.block !== null)
        lines.push(`    ${t('functional_get_results.log.block', { block: entry.block })}`);
      for (const [label, body] of [
        ['request', entry.requestBody],
        ['response', entry.responseBody],
      ] as const) {
        if (body === null) continue;
        lines.push(
          body.kind === 'shown'
            ? `    ${t(`functional_get_results.log.${label}`)}: ${body.text}`
            : `    ${t(`functional_get_results.log.${label}`)}: ${t(
                'functional_get_results.log.hidden',
                {
                  type: body.type ?? '?',
                  bytes: num(body.bytes, t.locale),
                },
              )}`,
        );
      }
    }
    if (data.shown < data.count) {
      lines.push(t('functional_get_results.more', { shown: data.shown, total: data.count }));
    }
    lines.push(t('functional_get_results.log.footer'));
    return lines.join('\n');
  }
  const one = data.result;
  if (one !== null) {
    const rows: [string, string][] = [
      [t('functional_get_results.label.test_type'), one.testType],
      [t('functional_get_results.label.status'), one.status],
      [
        t('functional_get_results.label.validations'),
        t('functional_get_results.validations', {
          passed: num(one.validations.passed, t.locale),
          failed: num(one.validations.failed, t.locale),
          total: num(one.validations.total, t.locale),
        }),
      ],
      [t('functional_get_results.label.lasted'), `${num(Math.round(one.durationMs), t.locale)} ms`],
    ];
    if (one.errorMessage !== null)
      rows.push([t('functional_get_results.label.error'), one.errorMessage]);
    const lines = [
      t('functional_get_results.one', { id: one.id, flow: one.flowId }),
      ...keyValue(rows),
    ];
    if (one.failedValidations.length > 0) {
      lines.push(t.plural('functional_get_results.failed', one.failedValidationCount));
      for (const item of one.failedValidations) {
        lines.push(`  ${item.validator}${item.message === null ? '' : `: ${item.message}`}`);
        if (item.expected !== null || item.actual !== null) {
          lines.push(
            `    ${t('functional_get_results.expected_actual', { expected: item.expected ?? '—', actual: item.actual ?? '—' })}`,
          );
        }
        if (item.reasoning !== null) lines.push(`    ${item.reasoning}`);
      }
    }
    if (one.blocks.length > 0) {
      lines.push(t.plural('functional_get_results.blocks', one.blockCount));
      lines.push(
        ...columns(
          one.blocks.map((block) => [
            block.name,
            block.type,
            block.status,
            block.httpStatus === null
              ? '—'
              : `${block.method ?? ''} ${String(block.httpStatus)}`.trim(),
            `${num(Math.round(block.durationMs), t.locale)} ms`,
          ]),
        ).map((row) => `  ${row}`),
      );
      for (const block of one.blocks) {
        const why = block.errorMessage ?? block.assertionMessage;
        if (why !== null && block.status === 'failed') {
          lines.push(`  ${block.name}: ${why}`);
        }
      }
      if (one.blocks.length < one.blockCount) {
        lines.push(
          t('functional_get_results.more', { shown: one.blocks.length, total: one.blockCount }),
        );
      }
    }
    return lines.join('\n');
  }
  const lines: string[] = [];
  if (data.run !== null) {
    const { run } = data;
    lines.push(
      t('functional_get_results.header', {
        id: run.id,
        status: run.status,
        passed: num(run.flows.passed, t.locale),
        total: num(run.flows.total, t.locale),
        failed: num(run.validations.failed, t.locale),
      }),
    );
    if (run.errorMessage !== null)
      lines.push(t('functional_get_results.run_error', { error: run.errorMessage }));
  }
  if (data.flows.length === 0) {
    lines.push(t('functional_get_results.flows.none'));
    return lines.join('\n');
  }
  lines.push(t.plural('functional_get_results.flows', data.count));
  lines.push(
    ...columns(
      data.flows.map((row) => [
        row.id,
        row.testType,
        row.status,
        t('functional_get_results.flow_validations', {
          passed: num(row.validations.passed, t.locale),
          total: num(row.validations.total, t.locale),
        }),
        `${num(Math.round(row.durationMs), t.locale)} ms`,
      ]),
    ).map((row) => `  ${row}`),
  );
  for (const row of data.flows.filter((flow) => flow.errorMessage !== null).slice(0, 5)) {
    lines.push(
      t('functional_get_results.flow_error', { id: row.id, error: row.errorMessage ?? '' }),
    );
  }
  if (data.shown < data.count) {
    lines.push(t('functional_get_results.more', { shown: data.shown, total: data.count }));
  }
  return lines.join('\n');
}
