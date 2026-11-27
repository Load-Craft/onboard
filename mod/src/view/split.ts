/**
 * The traffic split of `scenario_suggest_split` as bars, one row per flow: its name, its percent and a
 * bar of full blocks. Text only (`Svg` is not used), so every surface that draws a result draws it.
 * The percents are the server's; the bar is the same one the server's view draws.
 */

import { bar, inline, num, visibleWidth } from '../../../mcp/src/render/primitives.js';
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
  type TreeNode,
} from './tree.js';

/** Blocks of a full (100%) bar, as in the server's view. */
const BAR_WIDTH = 20;
/** Flows drawn; the rest is `+N`. */
export const MAX_FLOWS = 40;
const SHARE_WIDTH = 4;

interface Share {
  readonly flow: string;
  readonly percent: number;
}

/** The split of the proposal of phase 1 (`proposal`) or of the composition of phase 2 (`split`). */
function sharesOf(
  data: unknown,
): { shares: Share[]; equal: boolean; proposal: boolean; name?: string } | undefined {
  if (!isDict(data)) return undefined;
  const source = Array.isArray(data['proposal'])
    ? data['proposal']
    : Array.isArray(data['split'])
      ? data['split']
      : undefined;
  if (source === undefined) return undefined;
  const shares: Share[] = [];
  for (const item of list(source)) {
    if (!isDict(item)) return undefined;
    const flow = str(item['flow']);
    const percent = finite(item['percent']);
    if (flow === undefined || percent === undefined) return undefined;
    shares.push({ flow: inline(flow), percent });
  }
  const name = str(data['name']);
  return {
    shares,
    equal: data['source'] === 'equal_fallback',
    proposal: Array.isArray(data['proposal']),
    ...(name === undefined ? {} : { name: inline(name) }),
  };
}

export function split(data: unknown, context: DrawContext): TreeNode | undefined {
  try {
    if (!supports(context.surface, 'ToolResult')) return undefined;
    const found = sharesOf(data);
    if (found === undefined || found.shares.length === 0) return undefined;
    const t = resultTexts(context.locale);
    const shown = found.shares.slice(0, MAX_FLOWS);
    const nameWidth = Math.min(
      Math.max(...shown.map((share) => visibleWidth(share.flow))),
      Math.max(8, context.width - BAR_WIDTH - SHARE_WIDTH - 6),
    );
    const rows = shown.map((share) =>
      row([
        text(share.flow + ' '.repeat(Math.max(0, nameWidth - visibleWidth(share.flow))), {
          wrap: 'truncate-end',
        }),
        text(`${String(share.percent).padStart(SHARE_WIDTH - 1)}%`),
        text(bar(share.percent / 100, BAR_WIDTH), { color: 'claude' }),
      ]),
    );
    const more = found.shares.length - shown.length;
    return column([
      ...(found.proposal
        ? [text(t('buildScenario.title'), { bold: true })]
        : found.name === undefined
          ? []
          : [text(found.name, { bold: true })]),
      ...rows,
      ...(more > 0
        ? [
            text(t('status.more', { count: num(more, t.locale) }), {
              dimColor: true,
            }),
          ]
        : []),
      ...(found.equal ? [text(t('buildScenario.equalFallback'), { dimColor: true })] : []),
    ]);
  } catch {
    return undefined;
  }
}
