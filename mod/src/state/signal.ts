/**
 * Turns what the mod sees into a `Signal`: pure text handling, no `$`. The hook on `tool.call`
 * sees the model's view of a result, which is rendered text in the user's language, so nothing
 * here reads a view for facts. It takes only the language-free marks the server puts in it: the
 * tool's name, an operation handle (`<kind>:<id>`) and the `[code]` the first line of an error
 * starts with. Facts come from the data block of `process_get_status` (`parseDataBlock`).
 */

import type { Signal } from './types.js';

const TOOL_PREFIX = 'mcp__plugin_loadcraft_lc__';

/** Operation kinds a handle can name (the `process_wait` tool accepts the same list). */
const KINDS = [
  'setup_analysis',
  'refine',
  'batch_generation',
  'flow_generation',
  'scenario_generation',
  'self_check',
  'record_run',
  'test_run',
  'analysis',
  'account_provision',
];

// The id may contain `.`, `_` and `-`, but ends on a letter or digit: a full stop after a handle in a
// sentence is not part of it.
const HANDLE = new RegExp(
  `\\b(?:${KINDS.join('|')}):[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?`,
);
/** True when `value` is one handle and nothing else (`test_run:<id>`). */
export function isHandle(value: string): boolean {
  return new RegExp(`^${HANDLE.source}$`).test(value);
}

const ERROR_CODE = /^\[([a-z][a-z0-9_]*)\]/;

/** `mcp__plugin_loadcraft_lc__run_start` → `run_start`; `undefined` for any other tool. */
export function shortToolName(tool: unknown): string | undefined {
  return typeof tool === 'string' && tool.startsWith(TOOL_PREFIX)
    ? tool.slice(TOOL_PREFIX.length)
    : undefined;
}

/** The text of what `next(e)` resolved to: its `text`, else the text blocks of its `result`. */
export function resultText(result: unknown): string {
  if (typeof result !== 'object' || result === null) return '';
  const { text, result: raw } = result as { text?: unknown; result?: unknown };
  if (typeof text === 'string') return text;
  if (typeof raw === 'string') return raw;
  if (!Array.isArray(raw)) return '';
  return raw
    .map((block: unknown) =>
      typeof block === 'object' && block !== null && 'text' in block ? String(block.text) : '',
    )
    .join('\n');
}

/** The signal for one finished call of a LoadCraft tool; `undefined` for another tool. */
export function toolSignal(tool: unknown, result: unknown): Signal | undefined {
  const name = shortToolName(tool);
  if (name === undefined) return undefined;
  const body = resultText(result);
  const handle = HANDLE.exec(body)?.[0];
  const errorCode = ERROR_CODE.exec(body)?.[1];
  return {
    kind: 'tool',
    tool: name,
    ...(handle === undefined ? {} : { handle }),
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

/**
 * The JSON a `$.mcp.call` answer carries as its only text block (what `format: "data"` returns),
 * or `undefined` when the answer is an error or not one JSON value.
 */
export function parseDataBlock(answer: unknown): unknown {
  if (typeof answer !== 'object' || answer === null) return undefined;
  const { content, isError } = answer as { content?: unknown; isError?: unknown };
  if (isError === true || !Array.isArray(content)) return undefined;
  const [first] = content as unknown[];
  if (typeof first !== 'object' || first === null) return undefined;
  const body = (first as { text?: unknown }).text;
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * True when `next.origin` says that this mod's own `$` call raised a tool call (a hook of ours that
 * reads the status), and not the model: the plugin is named `loadcraft`, or `loadcraft@inline` /
 * `loadcraft#2` (the forms a load from a folder and a second registration give it). Anything else,
 * a missing origin or one of a shape not known included, is taken as the call of the model, so that
 * a surprise here costs a read, never the state.
 */
export function isFromThisMod(origin: unknown): boolean {
  if (typeof origin !== 'object' || origin === null) return false;
  const { plugin } = origin as { plugin?: unknown };
  return typeof plugin === 'string' && /^loadcraft(?:[@#][\w.-]+)?$/u.test(plugin);
}
