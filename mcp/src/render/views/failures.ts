// Views of `results_get_errors` and `results_get_traces`: the error groups of a run with their
// counts, and the requests of a run, a failed one in full (step, method and address, status, the
// names of its headers, its bodies). Every text came from the target or the run and was masked on
// the way in (`tools/results/failures.ts`); here it is put on one line and cut. The block of one request is
// shared with the self-check view, which shows the answer of each attempt.

import type { Translator } from '../../context.js';
import { decimal, inline, ms, num, VIEW_WIDTH, wrap } from '../primitives.js';

/** One error group as the view draws it (`RunErrorGroup` of `tools/results/failures.ts`). */
export interface ErrorGroupView {
  readonly hash: string;
  readonly status: number | null;
  readonly message: string;
  readonly count: number;
  readonly percent: number | null;
  readonly endpoints: readonly string[];
  readonly kind: string | null;
  readonly source: string;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly console: readonly { readonly message: string; readonly count: number }[];
}

export interface ErrorsData {
  /** The short handle of the run (`e-1a2b3c4d`). */
  readonly run: string;
  /** Asked for one group by its hash: the view shows its detail. */
  readonly one: boolean;
  readonly groups: readonly ErrorGroupView[];
  readonly seriesSource: string;
  readonly retention: string | null;
}

/**
 * A body as the result carries it: shown masked (`cut` when the result limit cut it), hidden whole
 * because the mask does not read its format, or left out because the result reached its limit.
 */
export type BodyView =
  | { readonly kind: 'shown'; readonly text: string; readonly bytes: number; readonly cut: boolean }
  | { readonly kind: 'hidden'; readonly type: string | null; readonly bytes: number }
  | { readonly kind: 'omitted'; readonly bytes: number };

/** One recorded request, masked (`RecordedRequest` of `tools/results/failures.ts`). */
export interface RequestView {
  readonly traceId: string;
  readonly step: string | null;
  readonly method: string | null;
  readonly url: string | null;
  readonly status: number | null;
  readonly failed: boolean;
  readonly durationMs: number;
  readonly startTime: string | null;
  readonly error: string | null;
  readonly requestHeaders: readonly string[];
  readonly responseHeaders: readonly string[];
  readonly requestBody: BodyView | null;
  readonly responseBody: BodyView | null;
}

export interface TraceRowView {
  readonly id: string;
  readonly name: string;
  readonly method: string | null;
  readonly status: number | null;
  readonly durationMs: number;
}

export interface TracesData {
  readonly run: string;
  /** `failed`: the failed requests in full; `all`: every request, one line each; `one`: one trace. */
  readonly mode: 'failed' | 'all' | 'one';
  /** How many requests the result holds (`requests` or `rows`). */
  readonly count: number;
  /** The most the backend was asked for: a full page may not be all of them. */
  readonly limit: number;
  readonly maxLimit: number;
  readonly requests: readonly RequestView[];
  readonly rows: readonly TraceRowView[];
}

/** The longest body the text shows; the `data` format carries more of it, masked the same way. */
export const TEXT_BODY_LIMIT = 2048;
/** The longest body one request of a list carries in the data; a single trace carries it whole. */
export const DATA_BODY_LIMIT = 4096;
/** Body text the whole data result carries at most; the bodies after it are left out. */
export const DATA_BODIES_LIMIT = 65_536;
/** Body text the whole text result shows at most; the bodies after it are named, not shown. */
export const TEXT_BODIES_LIMIT = 32_768;
/** The longest answer a line of the self-check shows. */
export const SHORT_BODY_LIMIT = 160;
const MESSAGE_LIMIT = 300;
const ENDPOINTS_SHOWN = 5;
const INDENT = 2;

const SERIES_PRESENT = 'prometheus';
const SERIES_NOTES: ReadonlySet<string> = new Set([
  'absent_retention',
  'absent_unmeasured',
  'metrics_backend_unreachable',
]);

const mark = (failed: boolean): string => (failed ? '✕' : '✓');

/** Quotation marks that could close the frame around a quoted body. */
const QUOTE_MARKS = /[„“”«»]/gu;

/**
 * A body of the target or of the test as a quotation: on one line, cut to `limit`, its quotation
 * marks made plain, inside the frame the diagnosis puts around a quote, so it reads as data.
 */
export function quotedBody(text: string, limit: number, t: Translator): string {
  return t('diagnosis.quote', { text: inline(text, limit).replace(QUOTE_MARKS, '"') });
}

/** A body hidden whole or left out, in words: why, its type and its size. */
export function unshownBody(body: BodyView, t: Translator, trace?: string): string {
  if (body.kind === 'hidden') {
    return t('failures.body.hidden', {
      type: body.type === null ? t('failures.body.noType') : inline(body.type, 60),
      bytes: num(body.bytes, t.locale),
    });
  }
  return t('failures.body.omitted', {
    bytes: num(body.bytes, t.locale),
    trace: trace === undefined ? '' : inline(trace),
  });
}

function statusText(status: number | null, t: Translator): string {
  return status === null ? t('failures.request.unknown') : String(status);
}

function kindText(group: ErrorGroupView, t: Translator): string {
  if (group.status !== null) return t('failures.kind.http_status', { status: group.status });
  const key = `failures.kind.${group.kind ?? 'other'}`;
  return t.has(key) ? t(key) : t('failures.kind.other');
}

function endpointsText(endpoints: readonly string[]): string {
  const shown = endpoints.slice(0, ENDPOINTS_SHOWN).map((endpoint) => inline(endpoint, 80));
  const more = endpoints.length - shown.length;
  return [...shown, ...(more > 0 ? [`+${String(more)}`] : [])].join(', ');
}

function groupRow(group: ErrorGroupView, t: Translator): string {
  const head = t('failures.errors.row', {
    hash: inline(group.hash, 60),
    count: num(group.count, t.locale),
    what: kindText(group, t),
    endpoints: endpointsText(group.endpoints),
  });
  return group.percent === null
    ? head
    : `${head} · ${t('failures.errors.share', { percent: decimal(group.percent, 1, t.locale) })}`;
}

function groupDetail(group: ErrorGroupView, t: Translator): string[] {
  const lines = [
    t('failures.errors.message', { message: inline(group.message, MESSAGE_LIMIT) }),
    ...(group.source === '' ? [] : [t('failures.errors.source', { source: inline(group.source) })]),
    ...(group.firstSeen === null || group.lastSeen === null
      ? []
      : [
          t('failures.errors.seen', {
            first: inline(group.firstSeen),
            last: inline(group.lastSeen),
          }),
        ]),
    ...group.console.map((line) =>
      t('failures.errors.console', {
        count: num(line.count, t.locale),
        message: inline(line.message, MESSAGE_LIMIT),
      }),
    ),
  ];
  return lines.flatMap((line) => wrap(line, VIEW_WIDTH - INDENT, INDENT).map((l) => `  ${l}`));
}

function seriesNote(data: ErrorsData, t: Translator): string[] {
  if (data.seriesSource === SERIES_PRESENT || !SERIES_NOTES.has(data.seriesSource)) return [];
  return wrap(
    t(`failures.series.${data.seriesSource}`, { retention: inline(data.retention ?? '?') }),
  );
}

export function renderErrors(data: ErrorsData, t: Translator): string {
  const run = inline(data.run);
  if (data.groups.length === 0) {
    return [t('failures.errors.none', { run }), ...seriesNote(data, t)].join('\n');
  }
  const lines = data.one
    ? data.groups.flatMap((group) => [
        ...wrap(groupRow(group, t), VIEW_WIDTH, 4),
        ...groupDetail(group, t),
      ])
    : [
        t('failures.errors.header', {
          run,
          groups: t.plural('failures.groups', data.groups.length),
        }),
        ...data.groups.flatMap((group) => wrap(groupRow(group, t), VIEW_WIDTH, 4)),
      ];
  return [...lines, ...seriesNote(data, t), ...wrap(t('failures.errors.next', { run }))].join('\n');
}

// ---- one request --------------------------------------------------------------------------------

function namesText(names: readonly string[], t: Translator): string {
  return names.length === 0
    ? t('failures.request.noHeaders')
    : names.map((name) => inline(name, 80)).join(', ');
}

/** Body characters the text may still show; spent body by body, in order. */
interface TextBudget {
  left: number;
}

function bodyText(body: BodyView | null, t: Translator, trace: string, budget: TextBudget): string {
  if (body === null) return t('failures.request.noBody');
  if (body.kind !== 'shown') return unshownBody(body, t, trace);
  if (budget.left <= 0) return unshownBody({ kind: 'omitted', bytes: body.bytes }, t, trace);
  const limit = Math.min(TEXT_BODY_LIMIT, budget.left);
  budget.left -= Math.min(body.text.length, limit);
  return quotedBody(body.text, limit, t);
}

/** A line of the block, wrapped under the indent of the block. */
function indented(text: string, indent: number): string[] {
  const pad = ' '.repeat(indent);
  return wrap(text, VIEW_WIDTH - indent, INDENT).map((line) => `${pad}${line}`);
}

/** The head line of a request: `✕ POST https://… → 400 · 85 ms`. */
function requestHead(request: RequestView, t: Translator): string {
  const target = [request.method ?? '', request.url ?? ''].filter((part) => part !== '').join(' ');
  return `${mark(request.failed)} ${inline(target, 300)} → ${statusText(request.status, t)} · ${ms(
    request.durationMs,
    t.locale,
  )}`;
}

/** Whether a body of the request was cut, by the text view or by the limit of the data. */
export function cutsBody(request: RequestView): boolean {
  return [request.requestBody, request.responseBody].some(
    (body) =>
      body !== null &&
      body.kind === 'shown' &&
      (body.cut || inline(body.text).length > TEXT_BODY_LIMIT),
  );
}

/** The whole block of one request: what was sent and what came back, masked. */
export function requestLines(
  request: RequestView,
  t: Translator,
  budget: TextBudget = { left: TEXT_BODIES_LIMIT },
): string[] {
  return [
    ...wrap(requestHead(request, t), VIEW_WIDTH, 4),
    ...indented(
      [
        ...(request.step === null
          ? []
          : [t('failures.request.step', { step: inline(request.step, 120) })]),
        t('failures.request.trace', { trace: inline(request.traceId) }),
      ].join(' · '),
      INDENT,
    ),
    ...(request.error === null
      ? []
      : indented(
          t('failures.request.error', { error: inline(request.error, MESSAGE_LIMIT) }),
          INDENT,
        )),
    ...indented(
      t('failures.request.requestHeaders', { names: namesText(request.requestHeaders, t) }),
      INDENT,
    ),
    ...indented(
      t('failures.request.responseHeaders', { names: namesText(request.responseHeaders, t) }),
      INDENT,
    ),
    ...indented(
      t('failures.request.requestBody', {
        body: bodyText(request.requestBody, t, request.traceId, budget),
      }),
      INDENT,
    ),
    ...indented(
      t('failures.request.responseBody', {
        body: bodyText(request.responseBody, t, request.traceId, budget),
      }),
      INDENT,
    ),
  ];
}

function traceRow(row: TraceRowView, t: Translator): string {
  const failed = row.status !== null && row.status >= 400;
  return [
    `${mark(failed)} ${statusText(row.status, t)}`,
    ms(row.durationMs, t.locale),
    inline(row.name, 120),
    inline(row.id),
  ].join(' · ');
}

export function renderTraces(data: TracesData, t: Translator): string {
  const run = inline(data.run);
  if (data.count === 0) {
    return wrap(
      t(data.mode === 'all' ? 'failures.traces.none.all' : 'failures.traces.none.failed', { run }),
    ).join('\n');
  }
  const budget: TextBudget = { left: TEXT_BODIES_LIMIT };
  if (data.mode === 'one') {
    return data.requests.flatMap((request) => requestLines(request, t, budget)).join('\n');
  }
  const shown = t.plural('common.requests', data.count);
  const more =
    data.count >= data.limit
      ? wrap(t('failures.traces.more', { limit: data.limit, max: data.maxLimit }))
      : [];
  if (data.mode === 'all') {
    const first = data.rows[0];
    return [
      t('failures.traces.header.all', { run, shown }),
      ...data.rows.map((row) => `  ${traceRow(row, t)}`),
      ...more,
      ...(first === undefined
        ? []
        : wrap(t('failures.traces.next.one', { trace: inline(first.id) }))),
    ].join('\n');
  }
  const cut = data.requests.some(cutsBody)
    ? wrap(t('failures.traces.cut', { limit: TEXT_BODY_LIMIT, dataLimit: DATA_BODY_LIMIT }))
    : [];
  return [
    t('failures.traces.header.failed', { run, shown }),
    ...data.requests.flatMap((request) => requestLines(request, t, budget)),
    ...more,
    ...cut,
    ...wrap(t('failures.traces.checksOn2xx')),
  ].join('\n');
}
