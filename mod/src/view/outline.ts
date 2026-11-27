/**
 * The outline of a flow as a table, for the results of the `flows_generate_*` tools and `flows_get`:
 * one row per step, the HTTP method in a color of its own, the variables a step uses and produces
 * beside it.
 *
 * The rows say what the server's own view says (`mcp/src/render/views/flowOutline.ts`, the copy of
 * the notes in `row`, `pauseNotes` and `requestNotes`); nothing is counted here. A flow longer
 * than `MAX_ROWS` rows ends in `+N` and the drawing stays inside the limits of a tree.
 */

import type { Translator } from '../../../mcp/src/context.js';
import { decimal, num, visibleWidth } from '../../../mcp/src/render/primitives.js';
import { supports } from '../capabilities.js';
import { resultTexts } from '../i18n.js';
import {
  column,
  finite,
  isDict,
  list,
  row,
  short,
  str,
  text,
  type DrawContext,
  type ThemeColor,
  type TreeNode,
} from './tree.js';

/** Rows drawn for all the flows of one result together. */
export const MAX_ROWS = 120;
/** The step column of the server's view is at least this wide. */
const WHERE_WIDTH = 21;
const INDENT = '  ';
const NOTES_MIN_WIDTH = 12;
/**
 * The number, the method and an expected status of a step are short by nature; a longer value (data
 * the mod does not control) is cut, so it cannot widen every row of the table.
 */
const CELL_LIMIT = 16;
/** A path or a block name is cut here; the column is narrower still on most screens. */
const WHERE_LIMIT = 200;
/**
 * The notes of a step (the names it uses and produces, its statuses) are cut here, so that the
 * longest table (`MAX_ROWS` rows) stays well inside the characters Claude Code draws in one tree.
 */
const NOTES_LIMIT = 300;
/** A flow name or a variable name is cut here. */
const NAME_LIMIT = 80;
/** Flows drawn at most; the rest is counted in one line. */
const MAX_FLOWS = 40;

const METHOD_COLORS: Readonly<Record<string, ThemeColor>> = {
  GET: 'success',
  POST: 'suggestion',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'error',
};

/** The color of a method; a pause and a block that is no request stay in the dim color. */
export function methodColor(method: string): ThemeColor {
  return Object.hasOwn(METHOD_COLORS, method) ? (METHOD_COLORS[method] ?? 'inactive') : 'inactive';
}

interface Step {
  readonly num: string;
  readonly method: string;
  readonly where: string;
  readonly notes: string;
}

/**
 * The names, comma-separated, as the server's view lists them. The list stops once it is longer
 * than the notes can show (`NOTES_LIMIT`), and each name is cut at `NAME_LIMIT`: a step with very
 * many or very long names costs the drawing no more than a step the notes can show in full.
 */
function joined(names: readonly unknown[]): string {
  const parts: string[] = [];
  let length = 0;
  for (const name of names) {
    if (length > NOTES_LIMIT) break;
    const part = short(String(name), NAME_LIMIT);
    parts.push(part);
    length += part.length + 2;
  }
  return parts.join(', ');
}

const seconds = (milliseconds: number, t: Translator): string => {
  const value = milliseconds / 1000;
  return decimal(value, Number.isInteger(value) ? 0 : 1, t.locale);
};

function pauseText(
  pause: Record<string, unknown>,
  t: Translator,
): { where: string; notes: string } {
  const min = finite(pause['minMs']) ?? 0;
  const max = finite(pause['maxMs']) ?? 0;
  const where =
    min === max
      ? t('flow.outline.exact', { value: seconds(min, t) })
      : t('flow.outline.range', { min: seconds(min, t), max: seconds(max, t) });
  const source = str(pause['source']) ?? 'unknown';
  const sourceKey = `flow.outline.source.${source}`;
  const sourceWord = t.has(sourceKey) ? t(sourceKey) : t('flow.outline.source.unknown');
  const actionClass = str(pause['actionClass']);
  const classKey = `flow.outline.class.${actionClass ?? ''}`;
  const person =
    source === 'machine_wait' || actionClass === undefined || actionClass === 'api_call'
      ? undefined
      : t.has(classKey)
        ? t(classKey)
        : undefined;
  return {
    where,
    notes:
      person === undefined
        ? sourceWord
        : t('flow.outline.sourceClass', { source: sourceWord, class: person }),
  };
}

function requestNotes(step: Record<string, unknown>, t: Translator): string {
  const uses = list(step['uses']);
  const produces = list(step['produces']);
  const statuses = list(step['expectedStatuses']);
  const notes: string[] = [];
  if (uses.length > 0) notes.push(t('flow.outline.uses', { names: joined(uses) }));
  if (produces.length > 0) notes.push(t('flow.outline.produces', { names: joined(produces) }));
  if (statuses.length > 0) {
    notes.push(
      t('flow.outline.statuses', {
        statuses: statuses
          .slice(0, NOTES_LIMIT / 4)
          .map((status) => short(String(status), CELL_LIMIT))
          .join(' · '),
      }),
    );
  }
  return notes.join(' · ');
}

function stepOf(raw: unknown, t: Translator): Step | undefined {
  if (!isDict(raw)) return undefined;
  const given = str(raw['num']);
  const kind = str(raw['kind']);
  if (given === undefined || kind === undefined) return undefined;
  const num = short(given, CELL_LIMIT);
  const indent = INDENT.repeat(Math.min(finite(raw['depth']) ?? 0, 8));
  if (kind === 'pause') {
    const { where, notes } = pauseText(isDict(raw['pause']) ? raw['pause'] : {}, t);
    return { num, method: 'PAUSE', where: indent + where, notes };
  }
  const method = short(
    kind === 'request' ? (str(raw['method']) ?? '') : (str(raw['blockType']) ?? '').toUpperCase(),
    CELL_LIMIT,
  );
  const where = short(
    kind === 'request' ? (str(raw['path']) ?? '') : (str(raw['name']) ?? ''),
    WHERE_LIMIT,
  );
  return { num, method, where: indent + where, notes: short(requestNotes(raw, t), NOTES_LIMIT) };
}

const padEnd = (value: string, width: number): string =>
  value + ' '.repeat(Math.max(0, width - visibleWidth(value)));
const padStart = (value: string, width: number): string =>
  ' '.repeat(Math.max(0, width - visibleWidth(value))) + value;

function header(flow: Record<string, unknown>, t: Translator): string | undefined {
  const name = str(flow['name']);
  const steps = finite(flow['stepCount']);
  const requests = finite(flow['requestCount']);
  const pauses = finite(flow['pauseCount']);
  if (name === undefined || steps === undefined) return undefined;
  if (requests === undefined || pauses === undefined) {
    return t('flow.outline.line', {
      name: short(name, NAME_LIMIT),
      steps: t.plural('common.steps', steps),
    });
  }
  return t('flow.outline.header', {
    name: short(name, NAME_LIMIT),
    steps: t.plural('common.steps', steps),
    requests: t.plural('common.requests', requests),
    pauses: t.plural('common.pauses', pauses),
  });
}

function flowNode(
  flow: Record<string, unknown>,
  t: Translator,
  budget: number,
  context: DrawContext,
): { tree: TreeNode; rows: number } | undefined {
  const head = header(flow, t);
  if (head === undefined) return undefined;
  // Only the steps that can be drawn are read: the rest is counted, not laid out.
  const raws = list(flow['steps']);
  const shown = raws
    .slice(0, Math.max(0, budget))
    .map((raw) => stepOf(raw, t))
    .filter((step): step is Step => step !== undefined);
  const numWidth = Math.max(0, ...shown.map((step) => visibleWidth(step.num)));
  const methodWidth = Math.max(0, ...shown.map((step) => visibleWidth(step.method)));
  const whereWidth = Math.min(
    Math.max(WHERE_WIDTH, ...shown.map((step) => visibleWidth(step.where))),
    Math.max(WHERE_WIDTH, context.width - numWidth - methodWidth - NOTES_MIN_WIDTH - 6),
  );
  const rows = shown.map((step) =>
    row([
      text(padStart(step.num, numWidth), { dimColor: true }),
      text(padEnd(step.method, methodWidth), {
        color: methodColor(step.method),
        bold: true,
      }),
      text(padEnd(step.where, whereWidth), { wrap: 'truncate-end' }),
      text(step.notes, { dimColor: true, wrap: 'truncate-end' }),
    ]),
  );
  // Steps the server left out (`truncated`) and steps cut here are both "more": the count is the
  // server's own `stepCount` minus the rows drawn.
  const total = finite(flow['stepCount']) ?? raws.length;
  const more = Math.max(0, total - shown.length);
  const tail =
    more > 0
      ? [
          text(t('status.more', { count: num(more, t.locale) }), {
            dimColor: true,
          }),
        ]
      : [];
  return {
    tree: column([text(head, { bold: true }), ...rows, ...tail]),
    rows: shown.length,
  };
}

/**
 * The flows of a `flows_generate_*` result (`built`) or the one flow of a `flows_get` result
 * (`outline`).
 */
function flowsOf(data: unknown): readonly Record<string, unknown>[] | undefined {
  if (!isDict(data)) return undefined;
  const source = Array.isArray(data['built'])
    ? data['built']
    : isDict(data['outline'])
      ? [data['outline']]
      : undefined;
  if (source === undefined) return undefined;
  return source.filter(isDict);
}

/**
 * The drawing of the flows in `data`, or `undefined` when the data are not flows (empty, cut off,
 * of an unknown shape) or the surface draws nothing of ours.
 */
export function outline(data: unknown, context: DrawContext): TreeNode | undefined {
  try {
    if (!supports(context.surface, 'ToolResult')) return undefined;
    const flows = flowsOf(data);
    if (flows === undefined || flows.length === 0) return undefined;
    const t = resultTexts(context.locale);
    let budget = MAX_ROWS;
    const nodes: TreeNode[] = [];
    for (const flow of flows.slice(0, MAX_FLOWS)) {
      const drawn = flowNode(flow, t, budget, context);
      if (drawn === undefined) return undefined;
      nodes.push(drawn.tree);
      budget -= drawn.rows;
    }
    const more = flows.length - MAX_FLOWS;
    if (more > 0) {
      nodes.push(text(t('status.more', { count: num(more, t.locale) }), { dimColor: true }));
    }
    return column(nodes);
  } catch {
    return undefined;
  }
}
