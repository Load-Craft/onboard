// Names and texts from the backend in the data of a result, as the model, the view and the state get
// them (FIX-76): every string under a key that names something (`name`, `label`, `dataset`, …) or
// says something (`text`, `failure`, `recommendation`) passes `content()`: masked by shape, its
// secrets registered, one line. The shape stays: a string stays a string, a list of strings a list.
// What a later call sends back as it is (`args` of a next step, ids, handles, slot keys) is never
// touched, so a choice the model copies from the data still works.

import type { ToolContext } from '../context.js';
import type { ToolOutcome } from '../outcome.js';
import { content } from './moduleCall.js';

/** Keys whose string (or list of strings) is a name or a text of a third party. */
const SHOWN_KEYS: ReadonlySet<string> = new Set([
  'name',
  'names',
  'label',
  'labels',
  'dataset',
  'datasets',
  'usedBy',
  'target',
  'environment',
  'scenario',
  'flow',
  'stepLabel',
  'text',
  'failure',
  'recommendation',
  'cause',
  'note',
  'operation',
]);

/**
 * Subtrees never masked here: what a later call sends back unchanged (`args` of a next step, the
 * token of a card, handles, links), and bodies the tool already masked whole and cut to its own
 * limits (`requestBody`, `responseBody`: their `text` is not one line).
 */
const KEPT_KEYS: ReadonlySet<string> = new Set([
  'args',
  'confirm',
  'handle',
  'link',
  'links',
  'requestBody',
  'responseBody',
  'body',
]);

const LIMIT = 300;

function shown(ctx: Pick<ToolContext, 'secrets'>, value: unknown, depth: number): unknown {
  if (depth > 12) return value;
  if (Array.isArray(value)) return value.map((item) => shown(ctx, item, depth + 1));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (KEPT_KEYS.has(key)) out[key] = inner;
    else if (SHOWN_KEYS.has(key) && typeof inner === 'string')
      out[key] = content(ctx, inner, LIMIT);
    else if (
      SHOWN_KEYS.has(key) &&
      Array.isArray(inner) &&
      inner.every((item) => typeof item === 'string')
    ) {
      out[key] = inner.map((item: string) => content(ctx, item, LIMIT));
    } else out[key] = shown(ctx, inner, depth + 1);
  }
  return out;
}

/** The data with every name and text of a third party masked; the rest as it is. */
export function shownNames<T>(ctx: Pick<ToolContext, 'secrets'>, data: T): T {
  return shown(ctx, data, 0) as T;
}

/** A finished outcome with its data passed through `shownNames`; an unfinished one as it is. */
export function withShownNames<D>(
  ctx: Pick<ToolContext, 'secrets'>,
  outcome: ToolOutcome<D>,
): ToolOutcome<D> {
  return outcome.status === 'done' ? { ...outcome, data: shownNames(ctx, outcome.data) } : outcome;
}
