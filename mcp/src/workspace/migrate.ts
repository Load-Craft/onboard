// Migration of loadcraft/.cache/state.json from schema 1 (cache sections only) to schema 3 (process state plus
// cache sections). A pure function over the parsed file: the cache calls it when it reads a schema 1 file, and
// the reducer calls it (through the cache) in front of the first write, so a file left by an older plugin
// version is never refused and never loses what it held.
//
// What happens to each section of schema 1:
// - `suggestions`, `harSessions`, `drafts`: carried over, each entry stamped with an ISO `savedAt` instead of
//   milliseconds; a section over its limit keeps its newest entries (the reducer drops the expired ones on the
//   next write). An entry whose time cannot be shown goes to `legacy`.
// - `operations`: a handle (`<kind>:<id>`) of a kind the plugin knows gets a row in `process[_new].operations`
//   (the key under which a process waits for its project, until the plugin moves it under the project) and
//   its payload (the `saved` data `process_wait` resumes from) goes to `opPayloads`. A series of account provisioning
//   (`provision:<dataset id>` with `{baseline, count}`) goes to `accountSeries` under the dataset id. Any other
//   key of the section goes to `legacy.operations`.
// - `runLoads`: to `runLoads`, keyed by the run id (the old `execution_id` field becomes `run_id`).
// - `progress`: dropped. Its rows are bars of calls that were running: an open row is stale after minutes, a
//   closed one after half an hour, and the next call writes them again.
// - a section of another name, or one that is not a record of `{ savedAt, value }`: kept under `legacy`.
// Keys of the cache sections never start with `@`; a key that does is stored with that character percent-encoded.
import * as z from 'zod';
import { LIMITS, Process, MODULES, NEW_KEY, type State } from './processState.js';

export const STATE_SCHEMA = 3;

/** The key a cache section stores `key` under: a leading `@` (forbidden by the schema) or `%` is percent-encoded. */
export const encodeKey = (key: string): string =>
  key.startsWith('@') ? `%40${key.slice(1)}` : key.startsWith('%') ? `%25${key.slice(1)}` : key;
/** The reverse of `encodeKey`. */
export const decodeKey = (stored: string): string =>
  stored.startsWith('%40')
    ? `@${stored.slice(3)}`
    : stored.startsWith('%25')
      ? `%${stored.slice(3)}`
      : stored;

/** The module a long operation belongs to, for each kind the old `wait` knew. */
export const OPERATION_MODULE = {
  setup_analysis: 'project',
  refine: 'flows',
  batch_generation: 'flows',
  flow_generation: 'flows',
  har_generation: 'flows',
  har_split: 'flows',
  record_run: 'flows',
  scenario_generation: 'scenario',
  self_check: 'scenario',
  test_run: 'run',
  analysis: 'results',
  account_provision: 'data',
} as const satisfies Record<string, (typeof MODULES)[number]>;

const entrySchema = z.object({ savedAt: z.number(), value: z.unknown() });
/** The key prefix the series of account provisioning had in the `operations` section of schema 1. */
const SERIES_PREFIX = 'provision:';
const seriesValue = z.strictObject({
  baseline: z.number().int().min(0),
  count: z.number().int().min(0),
});
const operationValue = z.object({ kind: z.string(), id: z.string(), startedAt: z.number() });
const runLoadValue = z.object({
  execution_id: z.string().min(1).max(64),
  requested_vu: z.number().int().min(0),
  effective_vu: z.number().int().min(0),
});
export type StoredEntry = z.infer<typeof entrySchema>;
type Json = Record<string, unknown>;
type Row = Process['operations'][number];

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** ISO time of a millisecond stamp; undefined for one a Date cannot show. */
export function isoOf(ms: number): string | undefined {
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : undefined;
}

export function isKnownKind(kind: string): kind is keyof typeof OPERATION_MODULE {
  return Object.hasOwn(OPERATION_MODULE, kind);
}

/** True for a key of the form `<kind>:<id>` of a kind the plugin knows: its payload lives in `opPayloads`. */
export const isHandleKey = (key: string): boolean => {
  const at = key.indexOf(':');
  return at > 0 && isKnownKind(key.slice(0, at)) && key.length <= 160;
};

/** The row of the process for a stored operation entry; undefined for a key that is not a handle of a known kind. */
export function operationRow(handle: string, entry: unknown, tool?: string): Row | undefined {
  const parsed = entrySchema.safeParse(entry);
  if (!parsed.success) return undefined;
  const value = operationValue.safeParse(parsed.data.value);
  if (!value.success) return undefined;
  const { kind, id, startedAt } = value.data;
  if (!isKnownKind(kind) || handle !== `${kind}:${id}` || handle.length > 160) return undefined;
  const started = isoOf(startedAt);
  const saved = isoOf(parsed.data.savedAt);
  if (started === undefined || saved === undefined) return undefined;
  return {
    handle,
    kind,
    module: OPERATION_MODULE[kind],
    tool: (tool ?? kind).slice(0, 64),
    status: 'running',
    started_at: started,
    updated_at: saved,
  };
}

/** A process with nothing in it yet, under a key of State (`_new` or a project id). */
export function newProcess(key: string, now: string): Process {
  return Process.parse({
    rev: 0,
    updated_at: now,
    step: 'project',
    ids: key === NEW_KEY ? {} : { project_id: key },
    steps: Object.fromEntries(MODULES.map((module) => [module, {}])),
  });
}

function section(value: unknown): Record<string, StoredEntry> | undefined {
  if (value === undefined) return {};
  if (!isRecord(value)) return undefined;
  const out: Record<string, StoredEntry> = {};
  for (const [key, entry] of Object.entries(value)) {
    const parsed = entrySchema.safeParse(entry);
    if (!parsed.success) return undefined;
    out[key] = entry as StoredEntry;
  }
  return out;
}

export interface MigrateOptions {
  /** Masks registered secrets in what goes to `legacy`; the sections are masked by the writer. */
  scrubDeep?: <T>(value: T) => T;
}

const KNOWN = [
  'schema',
  'suggestions',
  'harSessions',
  'drafts',
  'operations',
  'runLoads',
  'progress',
];

type IsoEntry = { savedAt: string; value: unknown };

/** The newest `max` entries of a section (by `savedAt`), as the schema caps it. */
const newestOf = <V extends { savedAt: string }>(
  entries: Record<string, V>,
  max: number,
): Record<string, V> =>
  Object.fromEntries(
    Object.entries(entries)
      .sort(([, a], [, b]) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
      .slice(0, max),
  );

const CONTENT_SECTIONS = [
  ['suggestions', LIMITS.suggestions.max],
  ['harSessions', LIMITS.harSessions.max],
  ['drafts', LIMITS.drafts.max],
] as const;
const isoEntry = z.strictObject({ savedAt: z.iso.datetime(), value: z.unknown() });

/**
 * A schema 3 file written before the content sections carried ISO times, made to fit the schema in place:
 * an entry of `suggestions`, `harSessions` or `drafts` with `savedAt` in milliseconds gets the ISO time, a
 * series of account provisioning left in `drafts` (`provision:<dataset id>`) moves to `accountSeries`, an
 * entry of any other shape goes to `legacy.<section>`, and a section over its limit keeps its newest entries.
 * A file already in that shape comes back as the same object, so the call stays idempotent.
 */
function tolerateSchema3(input: Json, options: MigrateOptions): Json {
  let changed = false;
  const moved: Json = {};
  const next: Json = { ...input };
  const series: Record<string, unknown> = isRecord(input['accountSeries'])
    ? { ...input['accountSeries'] }
    : {};
  for (const [name, max] of CONTENT_SECTIONS) {
    const section = input[name];
    if (section === undefined) continue;
    if (!isRecord(section)) {
      moved[name] = section;
      Reflect.deleteProperty(next, name);
      changed = true;
      continue;
    }
    const kept: Record<string, IsoEntry> = {};
    for (const [key, entry] of Object.entries(section)) {
      if (isoEntry.safeParse(entry).success) {
        kept[key] = entry as IsoEntry;
        continue;
      }
      changed = true;
      const old = entrySchema.safeParse(entry);
      const saved = old.success ? isoOf(old.data.savedAt) : undefined;
      const value = old.success ? seriesValue.safeParse(old.data.value) : undefined;
      const dataset = key.startsWith(SERIES_PREFIX) ? key.slice(SERIES_PREFIX.length) : '';
      if (
        old.success &&
        saved !== undefined &&
        name === 'drafts' &&
        dataset !== '' &&
        value?.success
      ) {
        series[dataset] = { savedAt: saved, value: value.data };
      } else if (old.success && saved !== undefined && !key.startsWith('@')) {
        kept[key] = { savedAt: saved, value: old.data.value };
      } else {
        moved[name] = { ...(isRecord(moved[name]) ? moved[name] : {}), [key]: entry };
      }
    }
    const capped = newestOf(kept, max);
    if (Object.keys(capped).length !== Object.keys(kept).length) changed = true;
    next[name] = capped;
  }
  if (!changed) return input;
  next['accountSeries'] = series;
  if (Object.keys(moved).length > 0) {
    const masked = options.scrubDeep === undefined ? moved : options.scrubDeep(moved);
    const earlier = isRecord(input['legacy']) ? input['legacy'] : {};
    const merged: Json = { ...earlier };
    for (const [name, entries] of Object.entries(masked)) {
      merged[name] =
        isRecord(earlier[name]) && isRecord(entries) ? { ...earlier[name], ...entries } : entries;
    }
    next['legacy'] = merged;
  }
  return next;
}

/**
 * Schema 1 file (parsed JSON) -> the same file in schema 3 as a plain object. A schema 3 file comes back as
 * it is (or, when an earlier version wrote its content sections, fitted to the schema: `tolerateSchema3`),
 * so the call is idempotent. Undefined for anything that is neither (the caller refuses it).
 */
export function migrateState(input: unknown, options: MigrateOptions = {}): Json | undefined {
  if (!isRecord(input)) return undefined;
  if (input['schema'] === STATE_SCHEMA) return tolerateSchema3(input, options);
  if (input['schema'] !== 1) return undefined;

  const legacy: Json = {};
  for (const [field, value] of Object.entries(input)) {
    if (!KNOWN.includes(field)) legacy[field] = value;
  }
  const take = (name: string): Record<string, StoredEntry> => {
    const checked = section(input[name]);
    if (checked === undefined) {
      legacy[name] = input[name];
      return {};
    }
    return checked;
  };
  const toLegacy = (name: string, key: string, entry: unknown): void => {
    const earlier = (legacy[name] ?? {}) as Json;
    legacy[name] = { ...earlier, [key]: entry };
  };
  // An entry of a content section in the shape of schema 3: ISO savedAt, the key encoded.
  const stamped = (name: string, max: number): Record<string, IsoEntry> => {
    const out: Record<string, IsoEntry> = {};
    for (const [key, entry] of Object.entries(take(name))) {
      const saved = isoOf(entry.savedAt);
      const at = encodeKey(key);
      if (saved === undefined || at === '' || at.length > 160) toLegacy(name, key, entry);
      else out[at] = { savedAt: saved, value: entry.value };
    }
    return newestOf(out, max);
  };
  const suggestions = stamped('suggestions', LIMITS.suggestions.max);
  const harSessions = stamped('harSessions', LIMITS.harSessions.max);
  const operations = take('operations');
  const runLoads = take('runLoads');
  take('progress');

  const drafts = stamped('drafts', LIMITS.drafts.max);
  const series: Record<string, { savedAt: string; value: z.infer<typeof seriesValue> }> = {};
  const rows: Row[] = []; // the tool that started a migrated operation is not known: the kind stands in
  const opPayloads: Record<string, { savedAt: string; value: unknown }> = {};
  for (const [handle, entry] of Object.entries(operations)) {
    const row = operationRow(handle, entry);
    if (row !== undefined) {
      rows.push(row);
      opPayloads[handle] = { savedAt: row.updated_at, value: entry.value };
      continue;
    }
    const dataset = handle.startsWith(SERIES_PREFIX)
      ? encodeKey(handle.slice(SERIES_PREFIX.length))
      : '';
    const value = seriesValue.safeParse(entry.value);
    const saved = isoOf(entry.savedAt);
    if (dataset !== '' && dataset.length <= 160 && value.success && saved !== undefined) {
      series[dataset] = { savedAt: saved, value: value.data };
    } else {
      // neither an operation of a known kind nor a series of account provisioning: kept, not lost
      toLegacy('operations', handle, entry);
    }
  }
  const kept = rows.slice(-LIMITS.operations);
  const keptHandles = new Set(kept.map((row) => row.handle));
  for (const handle of Object.keys(opPayloads)) {
    if (!keptHandles.has(handle)) Reflect.deleteProperty(opPayloads, handle);
  }

  const loads: Record<string, { savedAt: string; value: Json }> = {};
  for (const [id, entry] of Object.entries(runLoads)) {
    const value = runLoadValue.safeParse(entry.value);
    const saved = isoOf(entry.savedAt);
    if (
      !value.success ||
      saved === undefined ||
      id.startsWith('@') ||
      id.length > 160 ||
      id === ''
    ) {
      toLegacy('runLoads', id, entry);
      continue;
    }
    loads[id] = {
      savedAt: saved,
      value: {
        run_id: value.data.execution_id,
        requested_vu: value.data.requested_vu,
        effective_vu: value.data.effective_vu,
      },
    };
  }
  const newest = Object.entries(loads)
    .sort(([, a], [, b]) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
    .slice(0, LIMITS.run_loads);

  const process: Record<string, Process> = {};
  if (kept.length > 0) {
    const latest =
      kept
        .map((row) => row.updated_at)
        .sort()
        .at(-1) ??
      kept[0]?.updated_at ??
      '';
    process[NEW_KEY] = { ...newProcess(NEW_KEY, latest), operations: kept };
  }
  const scrubbed = options.scrubDeep === undefined ? legacy : options.scrubDeep(legacy);
  const next: Json = {
    schema: STATE_SCHEMA,
    process,
    suggestions,
    harSessions,
    drafts,
    accountSeries: newestOf(series, LIMITS.account_series.max),
    opPayloads,
    runLoads: Object.fromEntries(newest),
  };
  if (Object.keys(scrubbed).length > 0) next['legacy'] = scrubbed;
  return next satisfies Partial<Record<keyof State | 'legacy', unknown>>;
}
