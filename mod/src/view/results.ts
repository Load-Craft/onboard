/**
 * Which drawing belongs to which tool, and the row a LoadCraft tool call gets in the transcript.
 * Pure: the hooks in `register.ts` ask here and draw what comes back.
 */

import { supports } from '../capabilities.js';
import { diagnosis } from './diagnosis.js';
import { outline } from './outline.js';
import { report } from './report.js';
import { split } from './split.js';
import { toolLabel } from './toolLabel.js';
import { row, text, type DrawContext, type TreeNode } from './tree.js';

type Drawing = (data: unknown, context: DrawContext) => TreeNode | undefined;

/** The drawing of the result of each tool that has one, by the tool's short name. */
const DRAWINGS: Readonly<Record<string, Drawing>> = {
  flows_generate_from_suggestions: outline,
  flows_generate_from_endpoints: outline,
  flows_generate_from_har: outline,
  flows_get: outline,
  scenario_suggest_split: split,
  scenario_generate: split,
  results_get_report: report,
  results_analyze_run: diagnosis,
};

/** The drawing of a result, or `undefined` for a tool without one or data it cannot draw. */
export function drawResult(
  tool: string,
  data: unknown,
  context: DrawContext,
): TreeNode | undefined {
  const drawing = Object.hasOwn(DRAWINGS, tool) ? DRAWINGS[tool] : undefined;
  return drawing?.(data, context);
}

export interface ToolRowState {
  readonly surface: string;
  readonly isRunning: boolean;
  readonly isErrored: boolean;
  /** The view that draws a row in full (ctrl+o, `--verbose`): it keeps the default row. */
  readonly isExpanded: boolean;
}

/**
 * The compact row of a LoadCraft tool call: the label, then `…` while it runs and `✕` when it
 * ended in an error. `undefined` (Claude Code's own row) for another tool, an expanded view or a
 * surface that does not draw tool rows.
 */
export function toolRow(tool: unknown, state: ToolRowState): TreeNode | undefined {
  const label = toolLabel(tool);
  if (label === undefined || state.isExpanded || !supports(state.surface, 'ToolUse')) {
    return undefined;
  }
  const marks: TreeNode[] = [];
  if (state.isRunning) marks.push(text('…', { dimColor: true }));
  if (state.isErrored) marks.push(text('✕', { color: 'error', bold: true }));
  return row([text(label, { bold: true }), ...marks], 1);
}
