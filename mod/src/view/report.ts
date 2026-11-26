/**
 * The report of `results_get_report` in color: the verdict and every threshold in the color of what the
 * server judged (green for a threshold that held, red for one that did not), then the run, the
 * counts, the times, the errors, the p95 of the slowest requests and the moment the p95 went over.
 *
 * The mod judges nothing. The verdict state and each `pass` come from the server; the color only
 * follows them. The wording of the numbers is the server's (`mcp/src/render/views/getReport.ts`,
 * the copy of `thresholdText`, `quantity`, `reasonText` and `duration`); `test/views.spec.ts`
 * compares the numbers with the golden texts. A report that carries a comparison with an earlier
 * run is left to the server's own drawing, which words it with care.
 */

import type { Translator } from '../../../mcp/src/context.js';
import {
  clock,
  decimal,
  inline,
  ms,
  num,
  visibleWidth,
} from '../../../mcp/src/render/primitives.js';
import { shape } from '../../../mcp/src/render/views/run.js';
import { PROFILE_TYPES, type Profile } from '../../../mcp/src/profiles/presets.js';
import { supports } from '../capabilities.js';
import { resultTexts } from '../i18n.js';
import {
  column,
  finite,
  isDict,
  list,
  row,
  str,
  text,
  type DrawContext,
  type ThemeColor,
  type TreeNode,
} from './tree.js';

/** Requests listed under the per-request p95; the server cuts at eight, the drawing at the same. */
const MAX_ENDPOINTS = 8;
const MAX_ERRORS = 5;
const NAME_LIMIT = 80;
const FAILURE_LIMIT = 200;
const LABEL_WIDTH = 15;
const HOUR_S = 3600;
const SECONDS_ONLY_BELOW_S = 90;
const SILENT_REASONS: ReadonlySet<string> = new Set(['sla_failed', 'result_has_errors']);

/** The color of a verdict state: the server's word, not the mod's. */
export function verdictColor(state: string): ThemeColor {
  switch (state) {
    case 'sla_passed':
      return 'success';
    case 'sla_failed':
    case 'run_failed':
    case 'invariants_violated':
      return 'error';
    case 'completed_with_errors':
    case 'sla_not_judged':
      return 'warning';
    default:
      return 'inactive';
  }
}

function trimmed(value: number, digits: number, locale: Translator['locale']): string {
  const out = decimal(value, digits, locale);
  const mark = locale === 'pl' ? ',' : '.';
  return out.includes(mark) ? out.replace(/0+$/u, '').replace(/[,.]$/u, '') : out;
}

function duration(seconds: number, t: Translator): string {
  if (seconds >= HOUR_S) {
    const hours = Math.floor(seconds / HOUR_S);
    const minutes = Math.round((seconds % HOUR_S) / 60);
    const h = t('profiles.dur.h', { n: num(hours, t.locale) });
    return minutes === 0 ? h : `${h} ${t('profiles.dur.min', { n: minutes })}`;
  }
  if (seconds < SECONDS_ONLY_BELOW_S) {
    return t('profiles.dur.s', {
      n: num(Math.max(1, Math.round(seconds)), t.locale),
    });
  }
  return t('profiles.dur.min', { n: num(Math.round(seconds / 60), t.locale) });
}

function metricName(threshold: Record<string, unknown>, t: Translator): string {
  switch (threshold['kind']) {
    case 'percentile':
      return `p${trimmed(finite(threshold['percentile']) ?? 0, 2, t.locale)}`;
    case 'stat': {
      const key = `report.threshold.stat.${str(threshold['stat']) ?? 'mean'}`;
      return t.has(key) ? t(key) : t('report.threshold.other');
    }
    case 'failed_percent':
      return t('report.threshold.failed');
    default: {
      const label = str(threshold['label']);
      return label === undefined || label === ''
        ? t('report.threshold.other')
        : inline(label, NAME_LIMIT);
    }
  }
}

function quantity(unit: string, value: number, t: Translator): string {
  switch (unit) {
    case 'ms':
      return ms(value, t.locale);
    case 'percent':
      return `${trimmed(value, 2, t.locale)}%`;
    case 'count':
      return num(value, t.locale);
    case 'requests_per_second':
      return t('report.unit.perSecond', { value: trimmed(value, 1, t.locale) });
    default:
      return trimmed(value, 2, t.locale);
  }
}

function thresholdText(threshold: Record<string, unknown>, pass: boolean, t: Translator): string {
  const mark = pass ? '✓' : '✕';
  const name = metricName(threshold, t);
  const value = finite(threshold['value']);
  if (value === undefined) return `${name} ${t('report.threshold.noValue')} ${mark}`;
  const unit = str(threshold['unit']) ?? '';
  const shown = quantity(unit, value, t);
  const limit = finite(threshold['limit']);
  if (limit === undefined) return `${name} ${shown} ${mark}`;
  const limitText = quantity(unit, limit, t);
  const limitTo = finite(threshold['limitTo']);
  if (limitTo !== undefined) {
    const range = t('report.threshold.range', {
      from: limitText,
      to: quantity(unit, limitTo, t),
    });
    return `${name} ${shown} ${range} ${mark}`;
  }
  const relation = value > limit ? '>' : value < limit ? '<' : '=';
  return `${name} ${shown} ${relation} ${limitText} ${mark}`;
}

function reasonText(code: string, t: Translator): string {
  const at = code.indexOf(':');
  const kind = at < 0 ? code : code.slice(0, at);
  const detail = at < 0 ? '' : inline(code.slice(at + 1), NAME_LIMIT);
  switch (kind) {
    case 'sla_exit_code_2_legacy':
    case 'invariants_not_evaluated':
    case 'no_verdict':
      return t(`report.reason.${kind}`);
    case 'invariant_violated':
      return t('report.reason.invariant_violated', { name: detail });
    case 'value_ledger_failed':
      return t('report.reason.value_ledger_failed', { variable: detail });
    case 'sla_refused':
      return t('report.reason.sla_refused', { reason: detail });
    default:
      return inline(code, NAME_LIMIT);
  }
}

/** The profile a run was started with, or `undefined` when the data do not describe one. */
function profileOf(value: Record<string, unknown> | undefined): Profile | undefined {
  const type = PROFILE_TYPES.find((known) => known === value?.['type']);
  const vusers = finite(value?.['vusers']);
  if (type === undefined || vusers === undefined) return undefined;
  const ramp = finite(value?.['ramp']);
  const hold = finite(value?.['hold']);
  return {
    type,
    vusers,
    ...(ramp === undefined ? {} : { ramp }),
    ...(hold === undefined ? {} : { hold }),
  };
}

const label = (name: string): TreeNode =>
  text(name + ' '.repeat(Math.max(0, LABEL_WIDTH - 1 - visibleWidth(name))), {
    dimColor: true,
  });

const field = (name: string, value: TreeNode): TreeNode => row([label(name), value], 1);

function errorLine(error: Record<string, unknown>, t: Translator): string {
  const status = finite(error['status']);
  const labelText = str(error['label']);
  const what =
    status === undefined
      ? inline(str(error['message']) ?? '?', NAME_LIMIT)
      : [String(status), ...(labelText === undefined ? [] : [inline(labelText)])].join(' ');
  const head = t('report.errors.entry', {
    what,
    count: num(finite(error['count']) ?? 0, t.locale),
  });
  const endpoint = str(error['endpoint']);
  return endpoint === undefined
    ? head
    : `${head} · ${t('report.errors.only', { endpoint: inline(endpoint, NAME_LIMIT) })}`;
}

export function report(data: unknown, context: DrawContext): TreeNode | undefined {
  try {
    if (!supports(context.surface, 'ToolResult')) return undefined;
    if (!isDict(data) || data['comparison'] !== undefined) return undefined;
    const verdict = data['verdict'];
    if (!isDict(verdict)) return undefined;
    const state = str(verdict['state']);
    if (state === undefined) return undefined;
    const t = resultTexts(context.locale);
    const name = t(`report.verdict.${state}`);
    if (!t.has(`report.verdict.${state}`)) return undefined;
    const reasons = list(verdict['reasons'])
      .map(String)
      .filter((code) => !SILENT_REASONS.has(code))
      .map((code) => reasonText(code, t));
    const lines: TreeNode[] = [
      field(
        t('report.label.verdict'),
        text(reasons.length === 0 ? name : `${name} · ${reasons.join('; ')}`, {
          color: verdictColor(state),
          bold: true,
        }),
      ),
    ];
    const failure = str(data['failure']);
    if (failure !== undefined) {
      lines.push(field(t('report.label.failure'), text(inline(failure, FAILURE_LIMIT))));
    }

    const thresholds = list(data['thresholds']).filter(isDict);
    const scoped = finite(data['scopedFailed']) ?? 0;
    if (thresholds.length > 0 || scoped > 0) {
      const cells: TreeNode[] = thresholds.map((threshold) => {
        const pass = threshold['pass'] === true;
        return text(thresholdText(threshold, pass, t), {
          color: pass ? 'success' : 'error',
        });
      });
      if (scoped > 0) {
        cells.push(
          text(t('report.threshold.scoped', { count: num(scoped, t.locale) }), {
            color: 'error',
          }),
        );
      }
      lines.push(field(t('report.label.thresholds'), row(cells, 2)));
    }

    const runData = isDict(data['run']) ? data['run'] : {};
    const capped = isDict(runData['capped']) ? runData['capped'] : undefined;
    if (capped !== undefined) {
      const from = finite(capped['from']);
      const to = finite(capped['to']);
      lines.push(
        field(
          t('report.label.note'),
          text(
            from === undefined || to === undefined
              ? t('report.capped.unknown')
              : t('report.capped', {
                  to: num(to, t.locale),
                  from: num(from, t.locale),
                }),
            { color: 'warning' },
          ),
        ),
      );
    }
    const durationS = finite(runData['durationS']);
    const planned = profileOf(isDict(runData['planned']) ? runData['planned'] : undefined);
    const runParts = [
      ...(durationS === undefined ? [] : [duration(durationS, t)]),
      ...(planned === undefined ? [] : [t('report.planned', { shape: shape(planned, t) })]),
    ];
    if (runParts.length > 0) lines.push(field(t('report.label.run'), text(runParts.join(' · '))));

    const requests = isDict(data['requests']) ? data['requests'] : {};
    const total = finite(requests['total']);
    if (total !== undefined) {
      const perSecond = finite(requests['perSecond']);
      const rate =
        perSecond === undefined
          ? []
          : [
              t('report.perSecond', {
                value: perSecond >= 10 ? num(perSecond, t.locale) : decimal(perSecond, 1, t.locale),
              }),
            ];
      lines.push(
        field(t('report.label.requests'), text([num(total, t.locale), ...rate].join(' · '))),
      );
    }

    const latency = isDict(data['latency']) ? data['latency'] : undefined;
    const p50 = finite(latency?.['p50']);
    const p95 = finite(latency?.['p95']);
    const p99 = finite(latency?.['p99']);
    if (p50 !== undefined && p95 !== undefined && p99 !== undefined) {
      const body = `p50 ${ms(p50, t.locale)} · p95 ${ms(p95, t.locale)} · p99 ${ms(p99, t.locale)}`;
      lines.push(
        field(
          t('report.label.latency'),
          text(latency?.['estimate'] === true ? `${body} ${t('report.estimate')}` : body),
        ),
      );
    }

    const errors = list(data['errors']).filter(isDict);
    const shownErrors = errors.slice(0, MAX_ERRORS);
    const moreErrors = errors.length - shownErrors.length + (finite(data['moreErrors']) ?? 0);
    const errorNodes = shownErrors.map((error) => text(errorLine(error, t), { color: 'error' }));
    if (moreErrors > 0) {
      errorNodes.push(
        text(t('status.more', { count: num(moreErrors, t.locale) }), {
          dimColor: true,
        }),
      );
    }
    if (data['errorsUnavailable'] === true) {
      errorNodes.push(text(t('report.errors.unavailable'), { dimColor: true }));
    }
    if (errorNodes.length > 0) lines.push(field(t('report.label.errors'), column(errorNodes)));

    const absent = str(data['seriesAbsent']);
    if (absent !== undefined) {
      const key = `report.series.${absent}`;
      if (t.has(key)) lines.push(text(t(key), { dimColor: true }));
    } else {
      const endpoints = list(data['endpoints']).filter(isDict).slice(0, MAX_ENDPOINTS);
      if (endpoints.length > 0) {
        const names = endpoints.map((endpoint) => inline(str(endpoint['name']) ?? '', NAME_LIMIT));
        const width = Math.max(...names.map((value) => visibleWidth(value)));
        lines.push(text(t('report.endpoints.header'), { dimColor: true }));
        endpoints.forEach((endpoint, index) => {
          const value = names[index] ?? '';
          lines.push(
            row(
              [
                text(value + ' '.repeat(Math.max(0, width - visibleWidth(value)))),
                text(ms(finite(endpoint['p95Estimate']) ?? Number.NaN, t.locale)),
              ],
              3,
            ),
          );
        });
        const more = finite(data['moreEndpoints']) ?? 0;
        if (more > 0) {
          lines.push(
            text(t('status.more', { count: num(more, t.locale) }), {
              dimColor: true,
            }),
          );
        }
      }
      const breach = isDict(data['breach']) ? data['breach'] : undefined;
      const offset = finite(breach?.['offsetS']);
      if (offset !== undefined) {
        lines.push(
          text(
            t(breach?.['sustained'] === true ? 'report.breach.sustained' : 'report.breach.brief', {
              at: clock(offset),
            }),
            { color: 'warning' },
          ),
        );
      }
    }
    return column(lines);
  } catch {
    return undefined;
  }
}
