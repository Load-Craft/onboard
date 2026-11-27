/**
 * The diagnosis of `results_analyze_run`: the verdict and how sure the analysis is, the cause, the step
 * change, the errors, the evidence and the recommendation. Evidence is data from the customer's
 * logs: each quotation is drawn inside quotation marks, as plain text, never as anything the
 * mod acts on. The wording is the server's (`mcp/src/render/views/getDiagnosis.ts`).
 */

import type { Translator } from '../../../mcp/src/context.js';
import { clock, inline, ms, num, visibleWidth } from '../../../mcp/src/render/primitives.js';
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

const LABEL_WIDTH = 15;
const MAX_ERRORS = 5;
const MAX_EVIDENCE = 12;
/** The server cuts a quotation at 120 characters; so does the drawing, whatever it is given. */
const QUOTE_LIMIT = 120;

/** The color of the verdict word the analysis gave: only the two it can give say anything. */
function verdictColor(verdict: string): ThemeColor | undefined {
  if (verdict === 'fail') return 'error';
  if (verdict === 'pass') return 'success';
  return undefined;
}

const label = (name: string): TreeNode =>
  text(name + ' '.repeat(Math.max(0, LABEL_WIDTH - 1 - visibleWidth(name))), {
    dimColor: true,
  });

const field = (name: string, value: TreeNode): TreeNode => row([label(name), value], 1);

function errorLine(error: Record<string, unknown>, t: Translator): string {
  const status = finite(error['status']);
  const what = status === undefined ? inline(str(error['message']) ?? '?') : String(status);
  const head = t('diagnosis.errors.entry', {
    status: what,
    count: num(finite(error['count']) ?? 0, t.locale),
  });
  const endpoint = str(error['endpoint']);
  return endpoint === undefined
    ? head
    : `${head} · ${t('diagnosis.errors.only', { endpoint: inline(endpoint) })}`;
}

function sourceText(source: unknown, t: Translator): string {
  const kind = isDict(source) ? source['kind'] : undefined;
  return kind === 'mcp'
    ? t('diagnosis.evidence.mcp', {
        label: inline(isDict(source) ? (str(source['label']) ?? 'MCP') : 'MCP'),
      })
    : t('diagnosis.evidence.run');
}

export function diagnosis(data: unknown, context: DrawContext): TreeNode | undefined {
  try {
    if (!supports(context.surface, 'ToolResult')) return undefined;
    if (!isDict(data)) return undefined;
    const verdict = str(data['verdict']);
    const confidence = str(data['confidence']);
    const cause = isDict(data['cause']) ? str(data['cause']['text']) : undefined;
    if (verdict === undefined || confidence === undefined || cause === undefined) return undefined;
    const t = resultTexts(context.locale);
    const confidenceKey = `diagnosis.confidence.${confidence}`;
    if (!t.has(confidenceKey)) return undefined;
    const color = verdictColor(verdict);

    const lines: TreeNode[] = [
      field(
        t('diagnosis.label.verdict'),
        row(
          [
            text(inline(verdict), {
              ...(color === undefined ? {} : { color }),
              bold: true,
            }),
            text('·', { dimColor: true }),
            text(t(confidenceKey), { dimColor: true }),
          ],
          1,
        ),
      ),
      field(t('diagnosis.label.cause'), text(inline(cause))),
    ];

    const step = isDict(data['step']) ? data['step'] : undefined;
    const offset = finite(step?.['offsetS']);
    const endpoint = str(step?.['endpoint']);
    const before = finite(step?.['beforeMs']);
    const after = finite(step?.['afterMs']);
    if (
      offset !== undefined &&
      endpoint !== undefined &&
      before !== undefined &&
      after !== undefined
    ) {
      lines.push(
        field(
          t('diagnosis.label.step'),
          text(
            t('diagnosis.step', {
              at: `T+${clock(offset)}`,
              endpoint: inline(endpoint),
              before: num(before, t.locale),
              after: ms(after, t.locale),
            }),
          ),
        ),
      );
    }

    const errors = list(data['errors']).filter(isDict);
    const shown = errors.slice(0, MAX_ERRORS);
    const errorNodes = shown.map((error) => text(errorLine(error, t), { color: 'error' }));
    const more = errors.length - shown.length + (finite(data['moreErrors']) ?? 0);
    if (more > 0) {
      errorNodes.push(
        text(t('status.more', { count: num(more, t.locale) }), {
          dimColor: true,
        }),
      );
    }
    if (data['errorsUnavailable'] === true) {
      errorNodes.push(text(t('diagnosis.errors.unavailable'), { dimColor: true }));
    }
    if (errorNodes.length > 0) {
      lines.push(field(t('diagnosis.label.errors'), column(errorNodes)));
    }

    // One header per source, in the order the sources first appear, each with its quotations.
    const groups = new Map<string, string[]>();
    for (const item of list(data['evidence']).filter(isDict).slice(0, MAX_EVIDENCE)) {
      const quote = str(item['quote']);
      if (quote === undefined) continue;
      const heading = t('diagnosis.evidence.header', {
        source: sourceText(item['source'], t),
      });
      const quotes = groups.get(heading) ?? [];
      quotes.push(t('diagnosis.quote', { text: inline(quote, QUOTE_LIMIT) }));
      groups.set(heading, quotes);
    }
    for (const [heading, quotes] of groups) {
      lines.push(
        text(heading, { dimColor: true }),
        ...quotes.map((quote) => row([text(' '.repeat(LABEL_WIDTH - 2)), text(quote)], 1)),
      );
    }

    const recommendation = str(data['recommendation']);
    if (recommendation !== undefined) {
      lines.push(field(t('diagnosis.label.recommendation'), text(inline(recommendation))));
    }
    if (data['cached'] === true) lines.push(text(t('diagnosis.cached'), { dimColor: true }));
    return column(lines);
  } catch {
    return undefined;
  }
}
