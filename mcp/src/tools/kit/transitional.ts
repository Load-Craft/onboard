// The shared blocks of module tools, in their transitional form (docs/tool-recipe.md, mode B): thin
// functions over today's `moduleCall.ts` and `moduleState.ts`, under the names the final blocks of
// `src/tools/kit/` will have. A module tool imports them from here and from nowhere else. When
// `src/tools/kit/index.ts` exists, the imports change to it and this file is deleted. A block a
// tool needs and this file lacks is a reason to stop and ask, never a helper written in a module.

import type { ToolContext, Translator } from '../../context.js';
import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { inline } from '../../render/primitives.js';
import { content, type CallContext } from '../moduleCall.js';

export { settleAll } from '../../http/operation.js';
export type { Card, CardView, ConsentCardData, Unchanged } from './consent.js';
export {
  callBackend,
  callBackendFor,
  type BodyOf,
  type CallContext,
  type QueryOf,
} from '../moduleCall.js';
export { projectIdOf } from '../moduleState.js';
export { runIdArgument, runOf } from '../results/run.js';
export {
  defineOperationKind,
  encodeHandle,
  maxWaitInput,
  MAX_CALL_WAIT_S,
  operationId,
  renderOperation,
  startOperation,
  type OperationContext,
  type OperationPlan,
} from './operation.js';

// ---- text ------------------------------------------------------------------------------------

/** The longest text of each kind a view shows. */
export const LIMITS = {
  word: 40,
  label: 80,
  name: 120,
  sentence: 300,
  url: 300,
  artifact: 6000,
} as const;

/** A text the application under test, its users or a model wrote: masked, one line, cut. */
export function thirdParty(ctx: CallContext, text: string, max: number): string {
  return content(ctx, text, max);
}

/** `thirdParty`, or null for a missing or empty text. */
export function thirdPartyOrNull(
  ctx: CallContext,
  text: string | null | undefined,
  max: number,
): string | null {
  return text === null || text === undefined || text === '' ? null : content(ctx, text, max);
}

/** Prose of LoadCraft's own contract (API documentation, a question of the generator). */
export function ownDoc(ctx: CallContext, text: string, max: number): string {
  return content(ctx, text, max, { documentation: true });
}

const WORD = /^[a-z][a-z_-]{0,31}[0-9]{0,2}$/u;

/** A word of the contract's vocabulary (a status, a type) as it is; any other value masked. */
export function kind(ctx: CallContext, value: string): string {
  return WORD.test(value) ? value : content(ctx, value, LIMITS.word);
}

/** `kind`, or null for a missing or empty value. */
export function kindOrNull(ctx: CallContext, value: string | null | undefined): string | null {
  return value === null || value === undefined || value === '' ? null : kind(ctx, value);
}

/** An address of the project's configuration: origin and path only (no credentials, query or fragment). */
export function address(ctx: CallContext, raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const url = new URL(raw);
    const path = url.pathname === '/' ? '' : url.pathname;
    return content(ctx, `${url.origin}${path}`, LIMITS.url);
  } catch {
    return content(ctx, raw.split(/[?#]/u)[0] ?? '', LIMITS.url);
  }
}

// ---- arguments and objects ---------------------------------------------------------------------

/** Refuses the call before any request: the arguments do not fit together (`ruleKey` of the dictionary). */
export function refuseRule(ruleKey: string, params: Readonly<Record<string, string>> = {}): never {
  throw new ToolError('invalid_arguments', { params: { ...params, rule: ruleKey } });
}

function stateAt(ctx: Pick<ToolContext, 'state'>, path: string): unknown {
  let current: unknown = ctx.state.process();
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Readonly<Record<string, unknown>>)[key];
  }
  return current;
}

/**
 * An argument that names an object: the value given, else the one the process state holds at
 * `path` (a text, or the only distinct text of a list or a record). None or several:
 * `missing_argument` naming the argument.
 */
export function refId(
  ctx: Pick<ToolContext, 'state'>,
  name: string,
  given: string | undefined,
  path: string,
): string {
  if (given !== undefined) return given;
  const kept = stateAt(ctx, path);
  const values: readonly unknown[] =
    typeof kept === 'string'
      ? [kept]
      : Array.isArray(kept)
        ? (kept as readonly unknown[])
        : typeof kept === 'object' && kept !== null
          ? Object.values(kept)
          : [];
  const known = [...new Set(values.filter((value): value is string => typeof value === 'string'))];
  const [only] = known;
  if (known.length === 1 && only !== undefined) return only;
  throw new ToolError('missing_argument', { params: { name } });
}

/** `refId` for an argument the tool can work without: undefined instead of `missing_argument`. */
export function refIdOrNone(
  ctx: Pick<ToolContext, 'state'>,
  name: string,
  given: string | undefined,
  path: string,
): string | undefined {
  try {
    return refId(ctx, name, given, path);
  } catch (error) {
    if (error instanceof ToolError && error.code === 'missing_argument') return undefined;
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Whether a value an argument took is a UUID (else it is a name). */
export function isUuid(value: string): boolean {
  return UUID.test(value.trim());
}

/** The handle of a load run, as a view shows it: `e-` and the first eight digits of its UUID. */
export function runHandle(runId: string): string {
  return `e-${runId.slice(0, 8).toLowerCase()}`;
}

/**
 * The one item whose id or name is `input` (a name in any letter case). None: `not_found` with the
 * names there are. Several: `ambiguous` with the candidates. `kindText` is the word for the object
 * in the language of the call (a dictionary text, `ctx.t('<tool_name>.kind')`).
 */
export function pickNamed<T extends { readonly id: string; readonly name: string }>(
  ctx: Pick<ToolContext, 'secrets' | 't'>,
  kindText: string,
  input: string,
  items: readonly T[],
): T {
  const same = (a: string, b: string): boolean =>
    a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();
  const wanted = input.trim();
  const found = items.filter((item) => same(item.id, wanted) || same(item.name, wanted));
  const [only] = found;
  if (found.length === 1 && only !== undefined) return only;
  const shown = inline(wanted, LIMITS.name);
  const quotedNames = (list: readonly T[]): string =>
    list
      .slice(0, 10)
      .map((item) => `"${content(ctx, item.name, LIMITS.name)}"`)
      .join(', ');
  if (found.length > 1) {
    throw new ToolError('ambiguous', {
      params: { kind: kindText, name: shown, candidates: quotedNames(found) },
    });
  }
  const sentence =
    items.length === 0
      ? ctx.t('resolve.notFound.empty', { kind: kindText, name: shown })
      : ctx.t('resolve.notFound', { kind: kindText, name: shown, names: quotedNames(items) });
  throw new ToolError('not_found', { message: sentence, params: { available: ` ${sentence}` } });
}

// ---- auxiliary reads and include[] -------------------------------------------------------------

/** A part of a result that comes from an auxiliary read or from `include[]`. */
export type Part<T> =
  | { readonly state: 'skipped' }
  | { readonly state: 'none' }
  | { readonly state: 'unavailable'; readonly status: number }
  | { readonly state: 'read'; readonly value: T };

/**
 * An auxiliary read: an API error leaves the rest of the result (404: `none`, any other status:
 * `unavailable`). A 401 and an error that is no API answer end the call.
 */
export async function optionalRead<T>(read: () => Promise<T>): Promise<Part<T>> {
  try {
    return { state: 'read', value: await read() };
  } catch (error) {
    if (!(error instanceof LoadcraftApiError) || error.status === 401) throw error;
    return error.status === 404
      ? { state: 'none' }
      : { state: 'unavailable', status: error.status };
  }
}

export interface Includes<K extends string> {
  has(key: K): boolean;
  /** `skipped` when the call did not ask for the part; `optionalRead` otherwise. */
  part<T>(key: K, read: () => Promise<T>): Promise<Part<T>>;
}

export function includes<K extends string>(given: readonly K[] | undefined): Includes<K> {
  const asked = new Set<K>(given ?? []);
  return {
    has: (key) => asked.has(key),
    part: (key, read) =>
      asked.has(key) ? optionalRead(read) : Promise.resolve({ state: 'skipped' as const }),
  };
}

export function mapPart<T, U>(part: Part<T>, map: (value: T) => U): Part<U> {
  return part.state === 'read' ? { state: 'read', value: map(part.value) } : part;
}

// ---- lists -------------------------------------------------------------------------------------

/** A page of a list: one shape for every list a tool returns. */
export interface Page<T> {
  /** Items that match the filter (all without one). */
  readonly count: number;
  /** Items the data carries. */
  readonly shown: number;
  /** Items the backend returned. */
  readonly fetched: number;
  /** Items the backend holds; null when it does not say. */
  readonly total: number | null;
  readonly query: string | null;
  readonly items: readonly T[];
}

export function page<W, T>(
  fetched: readonly W[],
  options: {
    readonly limit: number;
    readonly total?: number | null;
    readonly query?: string | undefined;
    /** What `query` filters by (any letter case). */
    readonly nameOf?: (item: W) => string;
    /** Called only for the items shown. */
    readonly map: (item: W) => T;
  },
): Page<T> {
  const needle = options.query?.normalize('NFC').toLowerCase();
  const nameOf = options.nameOf;
  const matching =
    needle === undefined || nameOf === undefined
      ? fetched
      : fetched.filter((item) => nameOf(item).normalize('NFC').toLowerCase().includes(needle));
  const items = matching.slice(0, options.limit).map(options.map);
  return {
    count: matching.length,
    shown: items.length,
    fetched: fetched.length,
    total: options.total ?? null,
    query: options.query ?? null,
    items,
  };
}

/** How many to ask the backend for: `limit`, or the backend's maximum when the plugin filters. */
export function backendLimit(limit: number, query: string | undefined, backendMax: number): number {
  return query === undefined ? Math.min(limit, backendMax) : backendMax;
}

// ---- formats (a view imports these) --------------------------------------------------------------

const ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?/u;

/** `2026-11-26`: a calendar fact (joined, created). A value that is no ISO instant is shown as `?`. */
export function day(at: string): string {
  return ISO.exec(at)?.[1] ?? '?';
}

/** `2026-11-26 14:05Z`: an event (start, check, version), in UTC. */
export function minute(at: string): string {
  const match = ISO.exec(at);
  return match === null ? '?' : `${match[1] ?? ''} ${match[2] ?? ''}Z`;
}

/**
 * The lines of a part in each of its states: nothing when it was not asked for, one line when the
 * object has none or the read failed (keys `<module>.part.none`, `<module>.part.unavailable`),
 * else the label and the lines of the value, indented.
 */
export function partLines<T>(
  t: Translator,
  module: string,
  label: string,
  part: Part<T>,
  lines: (value: T) => readonly string[],
): string[] {
  if (part.state === 'skipped') return [];
  if (part.state === 'none') return [`${label}: ${t(`${module}.part.none`)}`];
  if (part.state === 'unavailable') {
    return [`${label}: ${t(`${module}.part.unavailable`, { status: part.status })}`];
  }
  return [`${label}:`, ...lines(part.value).map((line) => `  ${line}`)];
}

/** `"name"`: a third party's name is always quoted in a view. */
export function quoted(name: string): string {
  return `"${name}"`;
}

/** `[8f14e45f-…]`: the id of an object, where the next tool needs it. */
export function idTag(id: string): string {
  return `[${id}]`;
}

// ---- writes with an undo -------------------------------------------------------------------------

/** `offered`: the log keeps the way back; `withheld`: a previous value holds a secret; `none`: nothing changed. */
export type UndoState = 'offered' | 'withheld' | 'none';

export interface Change<B, A> {
  /** The fields the write changed; empty when the values were already as given (nothing sent). */
  readonly changed: readonly string[];
  readonly undo: UndoState;
  readonly before: B;
  /** The answer of the write; null when nothing was sent. */
  readonly after: A | null;
  /** For `update.log.undo_args`; undefined when no undo is kept. */
  readonly undoArgs: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Sets scalar fields of one object: reads it, sends only the fields that differ, and keeps the
 * previous values as the arguments of the undo (not when one of them holds a secret).
 */
export async function applyChange<B, P extends Readonly<Record<string, unknown>>, A>(
  ctx: Pick<ToolContext, 'secrets'>,
  options: {
    readonly read: () => Promise<B>;
    /** The same fields as the arguments, as the object holds them now. */
    readonly current: (before: B) => P;
    readonly wanted: { readonly [K in keyof P]?: P[K] | undefined };
    readonly send: (changed: Partial<P>, before: B) => Promise<A>;
    /** Default: the previous values of the changed fields, under the argument names. */
    readonly undoArgs?: (
      before: B,
      changed: readonly (keyof P & string)[],
    ) => Readonly<Record<string, unknown>>;
  },
): Promise<Change<B, A>> {
  const before = await options.read();
  const current = options.current(before);
  const changed = (Object.keys(options.wanted) as (keyof P & string)[]).filter(
    (key) => options.wanted[key] !== undefined && options.wanted[key] !== current[key],
  );
  if (changed.length === 0) {
    return { changed, undo: 'none', before, after: null, undoArgs: undefined };
  }
  const fields: Partial<P> = {};
  for (const key of changed) {
    const value = options.wanted[key];
    if (value !== undefined) fields[key] = value;
  }
  const after = await options.send(fields, before);
  const undoArgs =
    options.undoArgs?.(before, changed) ??
    Object.fromEntries(changed.map((key) => [key, current[key]]));
  // A previous value is the object's own text. The mask reads it first, so a secret it holds only
  // by its shape is known to the scope before the check; kept unread it would reach the state file.
  for (const value of Object.values(undoArgs)) {
    if (typeof value === 'string') content(ctx, value);
  }
  const clean = !ctx.secrets.containsSecret(undoArgs);
  return {
    changed,
    undo: clean ? 'offered' : 'withheld',
    before,
    after,
    undoArgs: clean ? undoArgs : undefined,
  };
}
