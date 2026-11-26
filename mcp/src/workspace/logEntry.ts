// One entry of the log of calls (process.log[] / process.reads[] in the state file), built by the
// registration layer after every call of a tool: the summary of the arguments and of the result
// from the tool's log template in the catalog, the effect and consent level of its catalog entry,
// the code of a failure, the link and the handle of the outcome, and the way to undo a write.
// Every text passes the secret scope of the call before it is cut to its limit.

import { randomBytes } from 'node:crypto';

import * as z from 'zod';

import {
  CURRENT_KIND,
  CURRENT_TO_TOOLS,
  LOG_META,
  type CurrentToolName,
  type LogMeta,
  type LogMetaUndo,
  type ToolName,
} from '../catalog.generated.js';
import type { SecretScope } from '../secret.js';
import type { recordCall } from './processState.js';

/** The entry as `recordCall` takes it. */
export type LogEntryInput = Parameters<typeof recordCall>[1]['entry'];

type Args = Readonly<Record<string, unknown>>;

function isCurrentName(name: string): name is CurrentToolName {
  return Object.hasOwn(CURRENT_TO_TOOLS, name);
}

function isToolName(name: string): name is ToolName {
  return Object.hasOwn(LOG_META, name);
}

/**
 * The way a split tool of today took, read from its arguments the way the tool itself reads them
 * and, where the arguments do not decide it, from its result. The answer only counts when it is one
 * of the tool's ways in the migration map of the catalog. Empty since the splits of the tools that
 * needed it are done; a split tool without an entry logs under its main way.
 */
const WAY_OF_CALL: Partial<
  Record<CurrentToolName, (args: Args, data: Args | undefined) => ToolName | undefined>
> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The catalog tool whose log metadata an entry uses: for today's name, the way the call took among
 * its ways in the migration map (by its arguments and, when given, the data of its result), else the
 * main way (element [0]); a helper file of the map (kind `helper`) is not a tool. A tool that already carries its
 * catalog name keeps it; a name in neither gets no entry.
 */
export function logToolOf(tool: string, args: unknown, data?: unknown): ToolName | undefined {
  if (isCurrentName(tool)) {
    if (CURRENT_KIND[tool] === 'helper') return undefined;
    const ways: readonly ToolName[] = CURRENT_TO_TOOLS[tool];
    const chosen = WAY_OF_CALL[tool]?.(
      isRecord(args) ? args : {},
      isRecord(data) ? data : undefined,
    );
    return chosen !== undefined && ways.includes(chosen) ? chosen : CURRENT_TO_TOOLS[tool][0];
  }
  // a start whose result asks for consent (a protected environment, a clamped load) started
  // nothing: the call planned
  if (tool === 'run_start' && isRecord(data) && data.needsConfirmation === true) return PLANNING;
  return isToolName(tool) ? tool : undefined;
}

/** The tool whose entry a call that only planned a run uses. */
const PLANNING: ToolName = 'run_plan';

/** Limits of the entry's texts (the LogEntry schema of the state file). */
const LIMIT = { summary: 200, value: 120, pair: 40, handle: 160, note: 160 } as const;
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*(?:\|[A-Za-z_][A-Za-z0-9_]*)*)\}/g;
const CODE_SHAPE = /^[a-z][a-z0-9_]{0,63}$/;
const Url = z.url();

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

type Value = string | number | boolean;

function isValue(value: unknown): value is Value {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function shown(value: unknown): Value | undefined {
  if (isValue(value)) return value;
  if (Array.isArray(value)) {
    return value.every(isValue) ? value.map(String).join(', ') : value.length;
  }
  return undefined;
}

/**
 * Values a template may name: the fields of each source and of the objects one level down (an
 * outer field wins over a nested one, an earlier source over a later one). A list of plain values
 * is joined, a list of objects counts its items.
 */
export function templateValues(...sources: readonly unknown[]): Map<string, Value> {
  const values = new Map<string, Value>();
  const take = (record: Record<string, unknown>): void => {
    for (const [key, raw] of Object.entries(record)) {
      const value = shown(raw);
      if (value !== undefined && !values.has(key)) values.set(key, value);
    }
  };
  const records = sources.filter(isRecord);
  for (const record of records) take(record);
  for (const record of records) {
    for (const inner of Object.values(record)) if (isRecord(inner)) take(inner);
  }
  return values;
}

function isValueMap(
  values: ReadonlyMap<string, Value> | Args,
): values is ReadonlyMap<string, Value> {
  return values instanceof Map;
}

const isSet = (value: Value | undefined): boolean =>
  value !== undefined && value !== false && value !== 0 && value !== '';

/**
 * `{name}` takes the value of `name`; `{a|b}` prints the first alternative whose value is set and
 * not false. Undefined when a slot has no value: the caller then summarises the source instead.
 */
export function fillTemplate(
  template: string,
  values: ReadonlyMap<string, Value> | Args,
): string | undefined {
  const map: ReadonlyMap<string, Value> = isValueMap(values) ? values : templateValues(values);
  let complete = true;
  const text = template.replace(PLACEHOLDER, (_slot, inner: string) => {
    const names = inner.split('|');
    const value = map.get(inner);
    const found =
      names.length > 1
        ? names.find((name) => isSet(map.get(name)))
        : value === undefined
          ? undefined
          : cut(String(value), LIMIT.value);
    if (found === undefined) complete = false;
    return found ?? '';
  });
  return complete ? text : undefined;
}

/**
 * `key=value, …` of a record: plain values, joined lists of plain values, the count of a list of
 * objects, and the plain fields of an object one level down (`account.slot=buyer`).
 */
export function pairsOf(source: unknown): string {
  if (!isRecord(source)) return '';
  const pairs: string[] = [];
  const add = (key: string, raw: unknown): void => {
    const value =
      Array.isArray(raw) && !raw.every(isValue) ? `[${String(raw.length)}]` : shown(raw);
    if (value !== undefined) pairs.push(`${key}=${cut(String(value), LIMIT.pair)}`);
  };
  for (const [key, raw] of Object.entries(source)) {
    if (isRecord(raw)) {
      for (const [inner, value] of Object.entries(raw)) add(`${key}.${inner}`, value);
    } else {
      add(key, raw);
    }
  }
  return pairs.join(', ');
}

/** The template filled, or a summary of the source when a slot has no value. */
function summary(
  template: string,
  values: ReadonlyMap<string, Value>,
  source: unknown,
  empty: string,
): string {
  const filled = fillTemplate(template, values);
  if (filled !== undefined) return filled;
  const pairs = pairsOf(source);
  return pairs === '' ? empty : pairs;
}

/** What the call ended with, as the registration layer saw it. */
export type CallEnd =
  | {
      readonly kind: 'done' | 'running';
      readonly data: unknown;
      readonly link?: string;
      readonly handle?: string;
    }
  | { readonly kind: 'error'; readonly code: string; readonly message: string }
  | { readonly kind: 'cancelled' };

export interface LogEntryCall {
  /** The name the tool was called by. */
  readonly tool: string;
  /** The catalog tool whose metadata the entry uses (`logToolOf`). */
  readonly catalogTool: ToolName;
  readonly args: unknown;
  readonly end: CallEnd;
  /** Start of the call (epoch ms) and its duration. */
  readonly startedAt: number;
  readonly ms: number;
  readonly secrets: Pick<SecretScope, 'scrub' | 'scrubDeep'>;
  /** The tool declares `from_panel` in its input (`declaresFromPanel`). */
  readonly fromPanel?: boolean;
  /** Id source; random by default. */
  readonly newId?: () => string;
  /**
   * Arguments of the undo the tool gave with its update (`log.undo_args`, e.g. the previous values):
   * the first undo way of the catalog takes them, instead of reading them from the result.
   */
  readonly undoArgs?: Readonly<Record<string, unknown>>;
  /** Values the tool gave for the templates of the entry (`log.values` of its update). */
  readonly values?: Readonly<Record<string, string | number | boolean>>;
}

type Effect = LogEntryInput['effect'];
const EFFECTS: readonly Effect[] = ['read', 'write', 'costly', 'destructive'];

/** `read+secret` → `read`: the secret axis does not change the effect. */
export function effectOf(meta: LogMeta): Effect {
  const base = meta.class.split('+')[0];
  return EFFECTS.find((effect) => effect === base) ?? 'write';
}

const KIND_IN_HOW = /\bkind=([a-z_]+)/;
const idsOf = (items: readonly unknown[]): string[] =>
  items.filter((item): item is string => typeof item === 'string' && item !== '');

/**
 * Arguments of one undo way, read from what the call returned; undefined when the result does not
 * name what to undo (the entry then has no undo, which says the call cannot be undone from here).
 */
function undoArgsOf(way: LogMetaUndo, end: CallEnd): Record<string, unknown> | undefined {
  if (end.kind !== 'done' && end.kind !== 'running') return undefined;
  const data = isRecord(end.data) ? end.data : {};
  switch (way.tool) {
    case 'project_delete': {
      const kind = KIND_IN_HOW.exec(way.how)?.[1];
      const [id] = idsOf([isRecord(data.project) ? data.project.id : undefined]);
      return kind === 'project' && id !== undefined ? { kind, ids: [id] } : undefined;
    }
    case 'flows_delete': {
      // outlines of the flows the call saved (generation, or a walk in the backend browser)
      const outlines = [data.built, data.saved].flatMap((list): unknown[] =>
        Array.isArray(list) ? (list as unknown[]) : [],
      );
      const ids = idsOf(
        outlines.map((outline) => (isRecord(outline) ? outline.flowId : undefined)),
      );
      return ids.length > 0 ? { kind: 'flow', ids } : undefined;
    }
    case 'process_cancel':
      return end.kind === 'running' && end.handle !== undefined
        ? { handle: end.handle }
        : undefined;
    default:
      return undefined;
  }
}

/** The call found the object instead of creating it: undoing a creation would delete what was there. */
function reusedSomething(end: CallEnd): boolean {
  if (end.kind !== 'done' && end.kind !== 'running') return false;
  const values = templateValues(end.data);
  return (
    values.get('reused') === true ||
    values.get('adopted') === true ||
    values.get('revision') === true ||
    values.get('composition') === 'updated'
  );
}

/**
 * The first undo way of the catalog whose arguments the tool or the result gives (none for a reused
 * object).
 */
function undoOf(
  meta: LogMeta,
  end: CallEnd,
  given?: Readonly<Record<string, unknown>>,
): LogEntryInput['undo'] {
  const [first] = meta.undo;
  if (given !== undefined && first !== undefined) {
    return {
      tool: first.tool,
      args: { ...given },
      level: first.level,
      note: cut(first.how, LIMIT.note),
    };
  }
  const reused = reusedSomething(end);
  for (const way of meta.undo) {
    if (reused && way.for === 'create') continue;
    const args = undoArgsOf(way, end);
    if (args !== undefined) {
      return { tool: way.tool, args, level: way.level, note: cut(way.how, LIMIT.note) };
    }
  }
  return undefined;
}

/**
 * The server does not know the mod: it knows only the argument `from_panel`, which the mod sets and
 * its `tool.call` hook refuses when the model sets it. A tool that does not declare the argument in
 * its input (`declared`) never gets a panel call: the key is ignored there. Every other call is the
 * model's.
 */
export function originOf(args: unknown, declared: boolean): 'panel' | 'model' {
  return declared && isRecord(args) && args['from_panel'] === true ? 'panel' : 'model';
}

/** Whether the input schema of a tool has the field `from_panel`. */
export function declaresFromPanel(input: unknown): boolean {
  return isRecord(input) && isRecord(input['shape']) && 'from_panel' in input['shape'];
}

/** The entry of one call; every text is masked by the scope of the call, then cut to its limit. */
export function buildLogEntry(call: LogEntryCall): LogEntryInput {
  const { end, secrets } = call;
  const meta = LOG_META[call.catalogTool];
  const effect = effectOf(meta);
  const masked = (text: string): string => cut(secrets.scrub(text), LIMIT.summary);
  const args = summary(
    meta.log.args,
    templateValues(call.args, call.values),
    call.args,
    'no arguments',
  );
  const result =
    end.kind === 'error'
      ? end.message
      : end.kind === 'cancelled'
        ? 'cancelled'
        : end.kind === 'running'
          ? `running: ${end.handle ?? 'operation'}`
          : summary(
              meta.log.result,
              templateValues(end.data, call.args, call.values),
              end.data,
              'done',
            );
  const status = end.kind === 'error' ? 'error' : end.kind === 'cancelled' ? 'cancelled' : 'ok';
  const link = end.kind === 'done' || end.kind === 'running' ? secrets.scrub(end.link ?? '') : '';
  const handle = end.kind === 'done' || end.kind === 'running' ? end.handle : undefined;
  const undo = status === 'ok' && effect !== 'read' ? undoOf(meta, end, call.undoArgs) : undefined;
  const newId = call.newId ?? ((): string => randomBytes(4).toString('hex'));
  return {
    id: `l-${newId()}`,
    at: new Date(call.startedAt).toISOString(),
    ms: Math.max(0, Math.round(call.ms)),
    module: meta.module,
    tool: cut(call.tool, 64),
    level: meta.level,
    effect,
    origin: originOf(call.args, call.fromPanel === true),
    args: masked(args),
    result: masked(result),
    status,
    ...(end.kind === 'error'
      ? { error_code: CODE_SHAPE.test(end.code) ? end.code : 'unknown' }
      : {}),
    ...(link !== '' && Url.safeParse(link).success ? { link } : {}),
    ...(handle === undefined ? {} : { handle: cut(secrets.scrub(handle), LIMIT.handle) }),
    has_detail: false,
    // the arguments of an undo come from the result: masked like every other value of the entry
    ...(undo === undefined ? {} : { undo: secrets.scrubDeep(undo) }),
  };
}
