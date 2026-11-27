/**
 * The live line under a running `run_start` call: the time of the test, the numbers of the run and a
 * small chart of the requests per second, as one line of text. A pure function of one snapshot and
 * the series (no `$`, no clock, no exception). The wording is the server's (`runStart.progress.*`,
 * see view/status.ts), the numbers are the ones the snapshot holds, without any recalculation.
 *
 * The chart is made of block characters in a `Text`: no `Raster`, which this mod has not seen
 * draw on a terminal (mod/docs/mods-facts.md).
 */

import { sparkline } from '../series.js';
import { isTerminal, progressParts, type Locale, type OperationSnapshot } from './status.js';
import { inline } from '../../../mcp/src/render/primitives.js';
import { column, text, type TreeNode } from './tree.js';

const SEPARATOR = ' · ';
/** The chart is never wider than this, however wide the terminal is. */
export const MAX_CHART = 24;
/** A chart narrower than this says nothing, so it is left out. */
export const MIN_CHART = 3;

/**
 * `test 6:40 / 10:00 · 690 requests/s · p95≈ 910 ms · errors 0.6% ▁▂▄▆▇`, or `undefined` when there
 * is nothing to draw: no snapshot, an operation that is over, or one that is not a test run. The
 * chart takes the room the line leaves in `width` columns, and is left out when there are fewer
 * than `MIN_CHART`.
 */
export function progressTree(
  snapshot: OperationSnapshot | undefined,
  samples: readonly number[],
  locale: Locale,
  width: number,
): TreeNode | undefined {
  if (snapshot === undefined || snapshot.kind !== 'test_run' || isTerminal(snapshot)) {
    return undefined;
  }
  const line = progressParts(snapshot, locale).join(SEPARATOR);
  const room = width - line.length - 1;
  const chart = room < MIN_CHART ? '' : sparkline(samples, Math.min(MAX_CHART, room));
  return text(chart === '' ? line : `${line} ${chart}`, { wrap: 'truncate-end' });
}

/** What the hint of the row (`(ctrl+b to run in background)`) is cut to. */
const MAX_HINT = 80;

/**
 * The line with the hint of Claude Code's own row beneath it, dim, so that the way to send the call
 * to the background is not lost. No hint (or one that is not text) leaves the line alone.
 */
export function progressRow(line: TreeNode, hint: unknown): TreeNode {
  const shown = typeof hint === 'string' ? inline(hint, MAX_HINT) : '';
  return shown === ''
    ? line
    : column([line, text(shown, { dimColor: true, wrap: 'truncate-end' })]);
}
