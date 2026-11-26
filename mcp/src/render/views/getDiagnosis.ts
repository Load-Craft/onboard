// View of `results_analyze_run`: the verdict, the cause in a few lines, the step change, the errors with
// their counts, the evidence with its source, and the recommendation. A quotation is data from the
// customer's logs: it is drawn inside quotation marks and nothing in it is a command.

import type { Translator } from '../../context.js';
import { cleanQuote, type Confidence } from '../../api/analysis.js';
import { clock, inline, ms, num, wrap } from '../primitives.js';

export interface EvidenceSource {
  readonly kind: 'run' | 'mcp';
  /** Name of the telemetry source (`mcp`). */
  readonly label?: string;
  /** The telemetry tool whose answer holds the quote (`mcp`). */
  readonly tool?: string;
}

export interface EvidenceView {
  /** Verbatim from the material, cleaned of control characters, at most 120 characters. */
  readonly quote: string;
  readonly source: EvidenceSource;
  /** The time the telemetry covers (the whole test with a margin); null for a quote from the run. */
  readonly window: { readonly start: string; readonly end: string } | null;
}

export interface ErrorView {
  /** HTTP status; null for a group that is not a status (then `message` names it). */
  readonly status: number | null;
  readonly count: number;
  /** Set when exactly one endpoint failed. */
  readonly endpoint?: string;
  readonly message?: string;
}

export interface DiagnosisData {
  readonly verdict: string;
  readonly confidence: Confidence;
  readonly cause: { readonly endpoint?: string; readonly text: string };
  /** Only when the analysis found a step change in a response time. */
  readonly step?: {
    readonly offsetS: number;
    readonly endpoint: string;
    readonly beforeMs: number;
    readonly afterMs: number;
  };
  readonly errors: readonly ErrorView[];
  /** Error groups left out of `errors`. */
  readonly moreErrors?: number;
  /** The error groups could not be read, so `errors` says nothing. */
  readonly errorsUnavailable?: true;
  readonly evidence: readonly EvidenceView[];
  readonly recommendation?: string;
  readonly costUsd?: number;
  /** A stored analysis was returned; no new run was paid for. */
  readonly cached: boolean;
}

/**
 * Width of the text beside a label. The golden text (`mcp/test/golden/run1/12-results_analyze_run`)
 * breaks the cause after 50 characters and holds a 56-character quotation on one line.
 */
const VALUE_WIDTH = 56;
/** The label column: 14 characters and a space, as in every golden text with labels. */
const LABEL_WIDTH = 15;

const label = (text: string): string => text.padEnd(LABEL_WIDTH - 1) + ' ';
const indent = ' '.repeat(LABEL_WIDTH);

/** A label and its value wrapped under the value column. */
function field(name: string, value: string): string[] {
  const [first = '', ...rest] = wrap(value, VALUE_WIDTH);
  return [label(name) + first, ...rest.map((line) => indent + line)];
}

function errorLine(error: ErrorView, t: Translator): string {
  const what = error.status === null ? inline(error.message ?? '?') : String(error.status);
  const head = t('diagnosis.errors.entry', { status: what, count: num(error.count, t.locale) });
  return error.endpoint === undefined
    ? head
    : `${head} · ${t('diagnosis.errors.only', { endpoint: inline(error.endpoint) })}`;
}

function errorLines(data: DiagnosisData, t: Translator): string[] {
  const lines = data.errors.map((error) => errorLine(error, t));
  if (data.moreErrors !== undefined && data.moreErrors > 0) {
    lines.push(t('status.more', { count: num(data.moreErrors, t.locale) }));
  }
  if (data.errorsUnavailable === true) lines.push(t('diagnosis.errors.unavailable'));
  if (lines.length === 0) return [];
  const [first = '', ...rest] = lines;
  return [label(t('diagnosis.label.errors')) + first, ...rest.map((line) => indent + line)];
}

function sourceText(source: EvidenceSource, t: Translator): string {
  return source.kind === 'mcp'
    ? t('diagnosis.evidence.mcp', { label: inline(source.label ?? 'MCP') })
    : t('diagnosis.evidence.run');
}

/** One header per source, in the order the sources first appear, each with its quotations. */
function evidenceLines(evidence: readonly EvidenceView[], t: Translator): string[] {
  const groups = new Map<string, string[]>();
  for (const item of evidence) {
    const heading = t('diagnosis.evidence.header', { source: sourceText(item.source, t) });
    const quotes = groups.get(heading) ?? [];
    quotes.push(t('diagnosis.quote', { text: cleanQuote(item.quote) }));
    groups.set(heading, quotes);
  }
  return [...groups].flatMap(([heading, quotes]) => [
    heading,
    ...quotes.flatMap((quote) => wrap(quote, VALUE_WIDTH).map((line) => indent + line)),
  ]);
}

export function renderGetDiagnosis(data: DiagnosisData, t: Translator): string {
  const step =
    data.step === undefined
      ? []
      : field(
          t('diagnosis.label.step'),
          t('diagnosis.step', {
            at: `T+${clock(data.step.offsetS)}`,
            endpoint: inline(data.step.endpoint),
            before: num(data.step.beforeMs, t.locale),
            after: ms(data.step.afterMs, t.locale),
          }),
        );
  return [
    ...field(
      t('diagnosis.label.verdict'),
      `${inline(data.verdict)} · ${t(`diagnosis.confidence.${data.confidence}`)}`,
    ),
    ...field(t('diagnosis.label.cause'), inline(data.cause.text)),
    ...step,
    ...errorLines(data, t),
    ...evidenceLines(data.evidence, t),
    ...(data.recommendation === undefined
      ? []
      : field(t('diagnosis.label.recommendation'), inline(data.recommendation))),
    ...(data.cached ? [t('diagnosis.cached')] : []),
  ].join('\n');
}
