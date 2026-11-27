/**
 * The bars of the operations in progress, as plain data (a tree of `Text` and `Box`, see tree.ts):
 * `scenario generation ████████░░░░ 60% 2/2 1:12 · scenario 2/2 · Cart: Generating feeder data...`.
 * Pure functions of the rows, the time and the width: no `$`, no clock (the time comes in), no
 * exception.
 *
 * A row that has a percent draws it as a filled bar. A row that has none draws a block that moves
 * along the bar, one cell a second (the frame comes from the time, so the drawing is the same for
 * the same second); the block is slow and never blinks. This build of Claude Code gives a mod no
 * signal for "reduce motion", so the movement is that gentle on purpose, and the timer behind it
 * runs only while a bar is on screen.
 *
 * Colours are theme keys (`success`, `inactive`, `error` for an operation that failed), so the bar
 * follows a light or a dark theme.
 */

import { clock, inline } from '../../../mcp/src/render/primitives.js';
import type { Locale } from '../i18n.js';
import type { BarEnd, BarRow, ModBars } from '../state/types.js';
import type { Tree } from './band.js';
import { kindLabel } from './status.js';
import {
  row as rowOf,
  text,
  column,
  type ThemeColor,
  type TreeNode,
  type TreeText,
} from './tree.js';

const FILLED = '█';
const EMPTY = '░';
/** Cells of a full-size bar; narrower rooms get fewer, and below `MIN_BAR` the bar is left out. */
export const BAR_CELLS = 12;
export const MIN_BAR = 6;
/** Cells of the block that moves along an indeterminate bar. */
const BLOCK = 3;
/** Below this many columns a stage no longer fits next to the numbers. */
const MIN_STAGE = 12;
const SEPARATOR = ' · ';

interface Words {
  readonly finished: string;
  readonly failed: string;
  readonly cancelled: string;
  readonly more: (count: number) => string;
  readonly tools: Readonly<Record<string, string>>;
}

const WORDS: Readonly<Record<Locale, Words>> = {
  en: {
    finished: 'finished',
    failed: 'failed',
    cancelled: 'cancelled',
    more: (count) => `+${String(count)} more`,
    tools: {
      project_import_docs: 'API documentation',
      project_analyze_setup: 'project analysis',
      flows_suggest_journeys: 'path proposals',
      flows_generate_from_suggestions: 'flow building',
      flows_generate_from_endpoints: 'flow building',
      flows_generate_from_har: 'flow building',
      flows_describe_journeys: 'flows from a description',
      flows_record_journeys: 'flows from a description',
      flows_import_har: 'recording import',
      scenario_suggest_split: 'traffic split',
      scenario_generate: 'scenario generation',
      data_suggest_actions: 'data suggestion',
      data_create_dataset: 'dataset',
      data_create_accounts: 'account creation',
      scenario_check_self: 'data check',
      run_start: 'test',
      results_analyze_run: 'diagnosis',
      process_wait: 'operation',
    },
  },
  pl: {
    finished: 'zakończone',
    failed: 'nie powiodło się',
    cancelled: 'anulowane',
    more: (count) => `+${String(count)} więcej`,
    tools: {
      project_import_docs: 'dokumentacja API',
      project_analyze_setup: 'analiza projektu',
      flows_suggest_journeys: 'propozycje ścieżek',
      flows_generate_from_suggestions: 'budowa flowów',
      flows_generate_from_endpoints: 'budowa flowów',
      flows_generate_from_har: 'budowa flowów',
      flows_describe_journeys: 'flowy z opisu',
      flows_record_journeys: 'flowy z opisu',
      flows_import_har: 'import nagrania',
      scenario_suggest_split: 'podział ruchu',
      scenario_generate: 'generowanie scenariuszy',
      data_suggest_actions: 'propozycja danych',
      data_create_dataset: 'zbiór danych',
      data_create_accounts: 'zakładanie kont',
      scenario_check_self: 'sprawdzenie danych',
      run_start: 'test',
      results_analyze_run: 'diagnoza',
      process_wait: 'operacja',
    },
  },
};

/** What the bar is about: the kind of operation when the row follows one, else the tool. */
export function barLabel(row: BarRow, locale: Locale): string {
  if (row.kind !== undefined) return kindLabel(row.kind, locale);
  return WORDS[locale].tools[row.tool] ?? inline(row.tool, 40).replace(/_/gu, ' ');
}

/**
 * The cells of the bar: `filled` of `cells` are full. A row without a percent has a block of
 * `BLOCK` cells that goes to the right and back as `frame` counts up.
 */
export function barCells(
  percent: number | undefined,
  cells: number,
  frame: number,
): { readonly filled: string; readonly empty: string } {
  if (percent !== undefined) {
    const full = Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)));
    return { filled: FILLED.repeat(full), empty: EMPTY.repeat(cells - full) };
  }
  const block = Math.min(BLOCK, cells);
  const travel = cells - block;
  const phase = travel === 0 ? 0 : Math.abs(frame) % (2 * travel);
  const at = phase <= travel ? phase : 2 * travel - phase;
  return {
    filled: '',
    empty: `${EMPTY.repeat(at)}${FILLED.repeat(block)}${EMPTY.repeat(cells - block - at)}`,
  };
}

export interface BarContext {
  readonly locale: Locale;
  /** Epoch milliseconds now, on the clock the rows were stamped with. */
  readonly now: number;
  /** Columns the line may use. */
  readonly width: number;
}

/** The frame of the moving block: one per second. */
export const frameOf = (now: number): number => Math.floor(now / 1000);

const dim = (content: string): TreeText => text(content, { dimColor: true });

/** The word and the colour of a finished bar: an operation that failed is not drawn as one that ended well. */
function finishedLook(
  end: BarEnd | undefined,
  words: Words,
): { readonly word: string; readonly color: ThemeColor } {
  switch (end) {
    case 'failed':
      return { word: words.failed, color: 'error' };
    case 'cancelled':
      return { word: words.cancelled, color: 'inactive' };
    case 'done':
    case undefined:
      return { word: words.finished, color: 'success' };
  }
}

/**
 * One line for a bar: the label, the bar, the percent, the counter, the time since the start and,
 * when there is room, the stage (cut, never wrapped). A finished bar is full and says how its
 * operation ended (`end`): failed in the colour of an error, cancelled dimmed, else finished.
 */
export function barLine(
  row: BarRow,
  context: BarContext,
  options: {
    readonly finished?: boolean;
    readonly end?: BarEnd;
    readonly stage?: boolean;
  } = {},
): TreeNode {
  const { locale, now, width } = context;
  const finished = options.finished === true;
  const look = finishedLook(options.end, WORDS[locale]);
  const label = barLabel(row, locale);
  const percent = finished ? 100 : row.percent;
  const elapsed = clock(Math.max(0, Math.round((now - row.startedAt) / 1000)));
  const counter =
    row.n !== undefined && row.m !== undefined ? `${String(row.n)}/${String(row.m)}` : '';
  const tail = finished
    ? look.word
    : [percent === undefined ? '' : `${String(percent)}%`, counter, elapsed]
        .filter((part) => part !== '')
        .join(' ');
  // label + space + bar + space + tail
  const room = width - [...label].length - [...tail].length - 2;
  const cells = Math.min(BAR_CELLS, room);
  const parts: TreeNode[] = [text(label, { bold: true })];
  let used = [...label].length;
  if (cells >= MIN_BAR) {
    const { filled, empty } = barCells(percent, cells, frameOf(now));
    parts.push(text(' '));
    if (filled !== '') parts.push(text(filled, { color: finished ? look.color : 'success' }));
    parts.push(
      text(
        empty,
        finished
          ? { color: look.color }
          : percent === undefined
            ? { color: 'success' }
            : { color: 'inactive' },
      ),
    );
    used += 1 + cells;
  }
  parts.push(text(` ${tail}`, finished ? { dimColor: true } : {}));
  used += 1 + [...tail].length;
  const stageRoom = width - used - [...SEPARATOR].length;
  if (options.stage === true && !finished && stageRoom >= MIN_STAGE) {
    parts.push(dim(`${SEPARATOR}${inline(row.stage, stageRoom)}`));
  }
  return rowOf(parts, 0);
}

/**
 * The bars for the band above the prompt: one line each, the oldest first, the finished ones after
 * them, at most `limit` lines (the rest is counted in a last dim line).
 */
export function barsBand(bars: ModBars, context: BarContext, limit = 3): TreeNode[] {
  const lines: { readonly row: BarRow; readonly finished: boolean; readonly end?: BarEnd }[] = [
    ...bars.rows.map((row) => ({ row, finished: false })),
    ...bars.finished
      .filter(({ until }) => until > context.now)
      .map(({ row, end }) => ({ row, finished: true, ...(end === undefined ? {} : { end }) })),
  ];
  const shown = lines
    .slice(0, limit)
    .map(({ row, finished, end }) =>
      barLine(row, context, { finished, stage: true, ...(end === undefined ? {} : { end }) }),
    );
  const hidden = lines.length - shown.length;
  return hidden > 0 ? [...shown, dim(WORDS[context.locale].more(hidden))] : shown;
}

/** A bar for the panel: the line, and the stage under it in full (cut to the width). */
export function barBlock(
  row: BarRow,
  context: BarContext,
  finished = false,
  end?: BarEnd,
): TreeNode {
  const line = barLine(row, context, { finished, ...(end === undefined ? {} : { end }) });
  return finished
    ? line
    : column([line, dim(inline(row.stage, Math.max(MIN_STAGE, context.width)))]);
}

/** The bars of the panel: every bar with its stage, the finished ones last. */
export function barsBlock(bars: ModBars, context: BarContext): TreeNode[] {
  return [
    ...bars.rows.map((row) => barBlock(row, context)),
    ...bars.finished
      .filter(({ until }) => until > context.now)
      .map(({ row, end }) => barBlock(row, context, true, end)),
  ];
}

/**
 * A drawing as the plain tree the band returns (band.ts): the same Box and Text, with `weight` for
 * what a drawing calls `bold`.
 */
export function plainOf(node: TreeNode): Tree {
  if (node.type === 'Text') {
    const { bold, ...rest } = node.props;
    return {
      type: 'Text',
      props: { ...rest, ...(bold === true ? { weight: 'bold' } : {}) },
      children: [...node.children],
    };
  }
  return {
    type: 'Box',
    props: { ...node.props },
    children: node.children.map(plainOf),
  };
}
